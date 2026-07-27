import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  articlesMentioningCountry,
  buildLiveEvents,
  classifyLiveHeadline,
  enrichEventWithCoverage,
  eventsDescribeSameOccurrence,
  mergeCanonicalEvents,
  newsTextTokens,
} from "@/lib/live-news";
import {
  biasDistributionForArticles,
  publisherBiasRating,
} from "@/lib/publisher-bias";
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
    ["Wildfires spread across Spain during record heat", "Weather and disasters"],
    ["Jersey Zoo geckos threatened by an invasive ant attack", "Environment"],
    ["Xenophobic violence intensifies near the border", "Conflict and security"],
    ["Police capture an international fugitive", "Crime and justice"],
    ["Authorities uncover a North Korean hacking ring", "Crime and justice"],
    ["Island athletes win at the Commonwealth Games", "Sports"],
    ["Antares red star appears beside the Moon", "Science and technology"],
    ["Temps are predicted to hit 106 in Egypt this week", "Weather and disasters"],
    ["Egypt petroleum exports rise as refinery output surges", "Economy"],
    ["New steel quotas will weaken competition", "Economy"],
    ["Qatar Airways adds a new Auckland route", "Travel and transport"],
    [
      "South Africa warns against searches of migrants' documents",
      "Society and education",
    ],
    [
      "Growing Pains: Rethinking Development Charges in Canadian Municipalities",
      "Economy",
    ],
    [
      "Human rights groups support the museum's curatorial independence",
      "Society and education",
    ],
    [
      "Record Canadian Para presence at 2026 Commonwealth Games",
      "Sports",
    ],
  ] as const)("classifies %s as %s", (headline, expected) => {
    expect(classifyLiveHeadline(headline)).toBe(expected);
  });

  it("normalizes common inflections consistently", () => {
    expect(newsTextTokens("wildfires athletes prices warnings games")).toEqual(
      expect.arrayContaining([
        "wildfire",
        "athlete",
        "price",
        "warning",
        "game",
      ]),
    );
  });

  it("keeps Other as a narrow fallback in the real map summary", () => {
    const snapshot = JSON.parse(
      readFileSync(resolve("public/map-news-summary.json"), "utf8"),
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

    expect(
      snapshot.countries.every((country) => country.articles.length === 1),
    ).toBe(true);
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

  it("groups differently worded coverage and exposes the top five sources", () => {
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
    expect(events[0].articles).toHaveLength(5);
    expect(events[0].scoringInput.independentSourceCount).toBe(6);
    expect(events[0].summary).toContain("6 independent publishers");
  });

  it("matches rewritten country and global headlines to one occurrence", () => {
    const countryEvent = buildLiveEvents(
      {
        ...payload,
        countryName: "United States",
        articles: [
          {
            ...payload.articles[0],
            id: "guardian-heat",
            title:
              "‘Extraordinarily hot’: US heatwave stretches on with millions still under warnings",
            description:
              "Millions across the United States remain under heat warnings.",
            publisherName: "The Guardian",
            publisherUrl: "https://theguardian.com/",
          },
        ],
      },
      {
        name: "United States",
        iso2: "US",
      },
    )[0];
    const globalEvent = buildLiveEvents(
      {
        ...payload,
        countryName: null,
        scope: "global",
        articles: [
          {
            ...payload.articles[0],
            id: "ap-heat",
            title:
              "Heat dome expands across the central United States, creating dangerous conditions for millions",
            description:
              "The US heat wave is putting millions of people at risk.",
            publisherName: "AP News",
            publisherUrl: "https://apnews.com/",
          },
        ],
      },
      null,
    )[0];

    expect(countryEvent.id).not.toBe(globalEvent.id);
    expect(eventsDescribeSameOccurrence(countryEvent, globalEvent)).toBe(true);
    const canonicalEvent = mergeCanonicalEvents(globalEvent, countryEvent);
    expect(canonicalEvent.id).toBe(globalEvent.id);
    expect(canonicalEvent.affectedCountries).toContain("US");
    expect(canonicalEvent.scoringInput.independentSourceCount).toBe(2);
    expect(canonicalEvent.articles).toHaveLength(2);
  });

  it("does not merge unrelated crime reports that share generic wording", () => {
    const [seattleEvent] = buildLiveEvents(
      {
        ...payload,
        countryName: "Canada",
        articles: [
          {
            ...payload.articles[0],
            id: "seattle-case",
            title:
              "Suspect dies after Seattle Space Needle shooting leaves victim injured",
            publisherName: "CBC News",
            publisherUrl: "https://cbc.ca/",
          },
        ],
      },
      { name: "Canada", iso2: "CA" },
    );
    const [berlinEvent] = buildLiveEvents(
      {
        ...payload,
        countryName: null,
        scope: "global",
        articles: [
          {
            ...payload.articles[0],
            id: "berlin-case",
            title:
              "Suspect in deadly Berlin Pride attack killed in confrontation with police, officials say",
            publisherName: "BBC News",
            publisherUrl: "https://bbc.com/",
          },
        ],
      },
      null,
    );

    expect(eventsDescribeSameOccurrence(seattleEvent, berlinEvent)).toBe(false);
  });

  it("merges an event-specific search and ranks five distinct publishers", () => {
    const [event] = buildLiveEvents(
      { ...payload, articles: [payload.articles[0]] },
      { name: "Canada", iso2: "CA" },
    );
    const expanded = enrichEventWithCoverage(event, {
      ...payload,
      scope: "event",
      articles: [
        payload.articles[0],
        payload.articles[1],
        ...["BBC News", "CBC News", "Local Desk", "Another Local Desk"].map(
          (publisherName, index) => ({
            id: `expanded-${index}`,
            title: `Canada wildfire response expands across western provinces ${index}`,
            url: `https://expanded${index}.example/story`,
            publisherName,
            publisherUrl: `https://expanded${index}.example`,
            publishedAt: `2026-07-24T${20 - index}:00:00.000Z`,
          }),
        ),
        {
          id: "duplicate-bbc-feed",
          title: "Western Canada wildfire response expands again",
          url: "https://bbc.example/duplicate",
          publisherName: "BBC",
          publisherUrl: "https://bbc.example/different-feed",
          publishedAt: "2026-07-24T19:30:00.000Z",
        },
      ],
    });

    expect(expanded.articles).toHaveLength(5);
    expect(expanded.scoringInput.independentSourceCount).toBe(6);
    expect(expanded.summary).toContain("Expanded topic search matched 6");
    expect(
      new Set(
        expanded.articles.map((article) => article.source.publisherName),
      ).size,
    ).toBe(5);
    expect(
      expanded.articles.filter((article) =>
        article.source.publisherName.toLowerCase().startsWith("bbc"),
      ),
    ).toHaveLength(1);
    expect(
      expanded.articles.map((article) => article.source.publisherName),
    ).toEqual(
      expect.arrayContaining(["Reuters", "Associated Press", "BBC News"]),
    );
  });

  it("keeps canonical sources when broader coverage returns only new publishers", () => {
    const [event] = buildLiveEvents(
      { ...payload, articles: [payload.articles[0]] },
      { name: "Canada", iso2: "CA" },
    );
    const expanded = enrichEventWithCoverage(event, {
      ...payload,
      scope: "event",
      articles: [payload.articles[1]],
    });

    expect(expanded.scoringInput.independentSourceCount).toBe(2);
    expect(
      expanded.articles.map((article) => article.source.publisherName),
    ).toEqual(expect.arrayContaining(["Reuters", "Associated Press"]));
  });

  it("builds a Ground News publisher mix and excludes unrated outlets", () => {
    const [event] = buildLiveEvents(payload, {
      name: "Canada",
      iso2: "CA",
    });
    const distribution = biasDistributionForArticles(event.articles);

    expect(publisherBiasRating("Reuters")).toMatchObject({
      bucket: "center",
      label: "Center",
    });
    expect(publisherBiasRating("Associated Press")).toMatchObject({
      bucket: "left",
      label: "Lean Left",
    });
    expect(
      publisherBiasRating(
        "ABC News - Breaking News, Latest News and Videos",
      ),
    ).toMatchObject({
      bucket: "left",
      label: "Lean Left",
    });
    expect(publisherBiasRating("Newsweek")).toMatchObject({
      bucket: "center",
      label: "Center",
    });
    expect(publisherBiasRating("New York Post")).toMatchObject({
      bucket: "right",
      label: "Lean Right",
    });
    expect(publisherBiasRating("Fox News")).toMatchObject({
      bucket: "right",
      label: "Right",
    });
    expect(publisherBiasRating("Washington Examiner")).toMatchObject({
      bucket: "right",
      label: "Lean Right",
    });
    expect(publisherBiasRating("National Review")).toMatchObject({
      bucket: "right",
      label: "Right",
    });
    expect(publisherBiasRating("ABC News Australia")).toBeNull();
    expect(publisherBiasRating("Unknown Local Desk")).toBeNull();
    expect(distribution).toMatchObject({
      left: 1,
      center: 1,
      right: 0,
      rated: 2,
      total: 2,
    });
    expect(
      distribution.percentages.left +
        distribution.percentages.center +
        distribution.percentages.right,
    ).toBe(100);
  });

  it("counts publisher aliases once in the Ground News mix", () => {
    const [event] = buildLiveEvents(payload, {
      name: "Canada",
      iso2: "CA",
    });
    const template = event.articles[0];
    const distribution = biasDistributionForArticles([
      ...event.articles,
      {
        ...template,
        id: "bbc-primary",
        source: {
          ...template.source,
          id: "bbc-primary",
          publisherName: "BBC News",
          url: "https://bbc.com/",
        },
      },
      {
        ...template,
        id: "bbc-alias",
        source: {
          ...template.source,
          id: "bbc-alias",
          publisherName: "BBC",
          url: "https://bbc.co.uk/",
        },
      },
    ]);

    expect(distribution).toMatchObject({
      left: 1,
      center: 2,
      right: 0,
      rated: 3,
      total: 3,
    });
  });

  it("prioritizes left, right, and center publishers in the displayed five", () => {
    const [event] = buildLiveEvents(
      {
        ...payload,
        articles: [
          ["Reuters", "https://reuters.com/"],
          ["BBC News", "https://bbc.com/"],
          ["Associated Press", "https://apnews.com/"],
          ["CNN", "https://cnn.com/"],
          ["New York Post", "https://nypost.com/"],
          ["Local Desk", "https://local.example/"],
        ].map(([publisherName, publisherUrl], index) => ({
          id: `balanced-${index}`,
          title: `Canada wildfire response expands across western provinces ${index}`,
          description:
            "Canada is expanding its response to major western wildfires.",
          url: `${publisherUrl}story-${index}`,
          publisherName,
          publisherUrl,
          publishedAt: `2026-07-24T${23 - index}:00:00.000Z`,
        })),
      },
      { name: "Canada", iso2: "CA" },
    );
    const distribution = biasDistributionForArticles(event.articles);

    expect(event.articles).toHaveLength(5);
    expect(distribution.left).toBeGreaterThanOrEqual(1);
    expect(distribution.right).toBeGreaterThanOrEqual(1);
    expect(distribution.center).toBeGreaterThanOrEqual(1);
    expect(
      event.articles.map((article) => article.source.publisherName),
    ).toContain("New York Post");
  });
});
