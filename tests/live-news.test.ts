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
});
