import { describe, expect, it } from "vitest";

import {
  articlesMentioningCountry,
  buildLiveEvents,
  classifyLiveHeadline,
} from "@/lib/live-news";
import type { LiveNewsPayload } from "@/lib/types";

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
      "Environment",
    );
    expect(
      classifyLiveHeadline(
        "「MUSIC AWARDS JAPAN 2026 アニソンスペシャル」放送決定！",
      ),
    ).toBe("Culture and sports");
    expect(classifyLiveHeadline("Government announces new tariffs")).toBe(
      "Economy",
    );
  });

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
