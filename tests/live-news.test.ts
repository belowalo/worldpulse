import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  articlesMentioningCountry,
  buildLiveEvents,
  classifyLiveHeadline,
} from "@/lib/live-news";
import type {
  LiveNewsPayload,
  MapNewsPayload,
} from "@/lib/types";

const payload: LiveNewsPayload = {
  countryName: "Canada",
  scope: "country",
  generatedAt: "2026-07-25T00:00:00.000Z",
  refreshAfterSeconds: 600,
  provider: "Test RSS",
  articles: [
    {
      id: "one",
      title: "Canada wildfire response expands across western provinces",
      url: "https://example.com/one",
      publisherName: "Reuters",
      publisherUrl: "https://reuters.com",
      publishedAt: "2026-07-24T23:00:00.000Z",
    },
    {
      id: "two",
      title: "Western Canada expands response to major wildfires",
      url: "https://example.org/two",
      publisherName: "Associated Press",
      publisherUrl: "https://apnews.com",
      publishedAt: "2026-07-24T22:30:00.000Z",
    },
  ],
};

describe("live news normalization", () => {
  it("classifies representative live headlines", () => {
    expect(classifyLiveHeadline("Parliament approves new election rules")).toBe(
      "Politics",
    );
    expect(classifyLiveHeadline("Wildfire response expands")).toBe(
      "Weather and disasters",
    );
    expect(
      classifyLiveHeadline(
        "「MUSIC AWARDS JAPAN 2026 アニソンスペシャル」放送決定！",
      ),
    ).toBe("Culture and entertainment");
    expect(classifyLiveHeadline("Government announces new tariffs")).toBe(
      "Economy",
    );
    expect(
      classifyLiveHeadline(
        "Trump issues 50% tariffs on Canada ahead of Gordie Howe Bridge opening",
      ),
    ).toBe("Economy");
    expect(
      classifyLiveHeadline(
        "Canada marks Gordie Howe bridge opening after trade war deepens",
      ),
    ).toBe("Economy");
    expect(
      classifyLiveHeadline(
        "China, Philippine coastguard vessels clash in South China Sea",
      ),
    ).toBe("Conflict and security");
    expect(
      classifyLiveHeadline("Rebel uprising grows into a nationwide revolution"),
    ).toBe("Conflict and security");
  });

  it.each([
    ["Court convicts former mayor in corruption trial", "Crime and justice"],
    ["Powerful earthquake triggers tsunami evacuation", "Weather and disasters"],
    ["Hospital launches new cancer vaccine trial", "Health"],
    ["University students win expanded education rights", "Society and education"],
    ["Airline adds flights after airport rail opening", "Travel and transport"],
    ["National football team reaches World Cup final", "Sports"],
    ["Film festival announces its music award winners", "Culture and entertainment"],
    ["Researchers launch an artificial intelligence satellite", "Science and technology"],
    ["Forest conservation plan cuts carbon emissions", "Environment"],
    ["Oddly shaped garden bench becomes neighborhood curiosity", "Other"],
  ] as const)("classifies %s as %s", (headline, expected) => {
    expect(classifyLiveHeadline(headline)).toBe(expected);
  });

  it("keeps Other as a narrow fallback in the real preloaded index", () => {
    const snapshot = JSON.parse(
      readFileSync(resolve("public/map-news-seed.json"), "utf8"),
    ) as MapNewsPayload;
    const titles = snapshot.countries.flatMap((country) =>
      country.articles.map((article) => article.title),
    );
    const otherCount = titles.filter(
      (title) => classifyLiveHeadline(title) === "Other",
    ).length;
    const categoryCounts = titles.reduce<Record<string, number>>(
      (counts, title) => {
        const category = classifyLiveHeadline(title);
        counts[category] = (counts[category] ?? 0) + 1;
        return counts;
      },
      {},
    );
    const largestCategoryCount = Math.max(...Object.values(categoryCounts));

    expect(
      otherCount / titles.length,
      `${otherCount} of ${titles.length} current headlines fell back to Other`,
    ).toBeLessThan(0.25);
    expect(
      Object.keys(categoryCounts).length,
      JSON.stringify(categoryCounts),
    ).toBeGreaterThanOrEqual(12);
    expect(
      largestCategoryCount / titles.length,
      JSON.stringify(categoryCounts),
    ).toBeLessThan(0.55);

    const countryEvents = snapshot.countries.map((country) =>
      buildLiveEvents(
        {
          countryName: country.countryName,
          scope: "country",
          generatedAt: country.generatedAt,
          refreshAfterSeconds: snapshot.refreshAfterSeconds,
          provider: snapshot.provider,
          articles: country.articles,
        },
        { name: country.countryName },
      ),
    );
    const topCategoryCounts = countryEvents.reduce<Record<string, number>>(
      (counts, events) => {
        const category = events[0]?.category ?? "Missing";
        counts[category] = (counts[category] ?? 0) + 1;
        return counts;
      },
      {},
    );

    expect(
      countryEvents.every((events) => events.length > 0),
      JSON.stringify(topCategoryCounts),
    ).toBe(true);
    expect(
      Object.keys(topCategoryCounts).length,
      JSON.stringify(topCategoryCounts),
    ).toBeGreaterThanOrEqual(8);

    const egypt = snapshot.countries.find(
      (country) => country.countryName === "Egypt",
    );
    expect(egypt?.articles.length).toBeGreaterThanOrEqual(24);
    const egyptTitles = egypt?.articles
      .map((article) => article.title)
      .join(" ");
    expect(egyptTitles).toMatch(/digital visa/i);
    expect(egyptTitles).toMatch(/detained|release/i);
    expect(egyptTitles).toMatch(/Egypt-Gaza border tunnels/i);
    expect(
      countryEvents[snapshot.countries.indexOf(egypt!)].length,
    ).toBeGreaterThan(10);
  }, 20_000);

  it("clusters related reporting and preserves publisher links", () => {
    const events = buildLiveEvents(payload, {
      name: "Canada",
      iso2: "CA",
    });
    expect(events).toHaveLength(1);
    expect(events[0].articles).toHaveLength(2);
    expect(events[0].articles[0].source.publisherName).toBeTruthy();
    expect(events[0].importanceScore).toBeGreaterThan(0);
  });

  it("matches global headlines to a country", () => {
    expect(articlesMentioningCountry(payload, "Canada")).toHaveLength(2);
    expect(articlesMentioningCountry(payload, "Japan")).toHaveLength(0);
  });

  it("matches countries mentioned in feed descriptions", () => {
    const descriptionOnly: LiveNewsPayload = {
      ...payload,
      articles: [
        {
          id: "description-only",
          title: "Parliament approves the emergency package",
          description: "Canadian lawmakers backed the measure late Thursday.",
          url: "https://example.com/description-only",
          publisherName: "Example News",
          publisherUrl: "https://example.com",
          publishedAt: "2026-07-24T21:00:00.000Z",
        },
      ],
    };

    expect(articlesMentioningCountry(descriptionOnly, "Canada")).toHaveLength(
      1,
    );
  });

  it("groups differently worded coverage and exposes the first four sources", () => {
    const headlines = [
      "US launches fresh strikes on Iranian military sites",
      "American attacks hit Iran military facilities overnight",
      "Iran military sites hit by fresh US attack",
      "Fresh attacks target Iranian military facilities",
      "US attack targets Iran military sites",
      "Iranian military facilities struck in US attacks",
    ];
    const multiSource: LiveNewsPayload = {
      ...payload,
      countryName: "United States",
      articles: headlines.map((title, index) => ({
        id: `source-${index}`,
        title,
        description:
          "The latest attack involved military facilities in Iran and the United States.",
        url: `https://publisher${index}.example/story`,
        publisherName: `Publisher ${index + 1}`,
        publisherUrl: `https://publisher${index}.example`,
        publishedAt: `2026-07-24T${String(23 - index).padStart(2, "0")}:00:00.000Z`,
      })),
    };

    const events = buildLiveEvents(multiSource, {
      name: "United States",
      iso2: "US",
    });

    expect(events).toHaveLength(1);
    expect(events[0].articles).toHaveLength(4);
    expect(events[0].scoringInput.independentSourceCount).toBe(6);
    expect(events[0].summary).toContain("6 independent publishers");
  });
});
