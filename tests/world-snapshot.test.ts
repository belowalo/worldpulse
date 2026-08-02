import { describe, expect, it } from "vitest";

import { prepareCompleteWorldSnapshot } from "@/lib/world-snapshot";
import type {
  LiveArticle,
  LiveNewsPayload,
  MapCountry,
  MapNewsCountryPayload,
} from "@/lib/types";

function liveArticle(id: string, title: string): LiveArticle {
  return {
    id,
    title,
    description: title,
    url: `https://publisher.example/${id}`,
    publisherName: "Example News",
    publisherUrl: "https://publisher.example/",
    publishedAt: new Date(Date.now() - 5 * 60_000).toISOString(),
  };
}

describe("prepared minute world state", () => {
  it("publishes all countries and maps fresh global reporting before release", () => {
    const generatedAt = new Date().toISOString();
    const directory: MapCountry[] = [
      { mapId: "124", name: "Canada", iso2: "CA", events: [] },
      { mapId: "724", name: "Spain", iso2: "ES", events: [] },
    ];
    const globalPayload: LiveNewsPayload = {
      scope: "global",
      countryName: null,
      generatedAt,
      refreshAfterSeconds: 60,
      provider: "Live providers",
      articles: [
        liveArticle(
          "canada-trade",
          "Canada announces a new national trade agreement",
        ),
      ],
    };
    const countryPayloads: MapNewsCountryPayload[] = [
      {
        countryName: "Spain",
        generatedAt,
        available: true,
        articles: [
          liveArticle(
            "spain-weather",
            "Spain issues severe weather warnings across the country",
          ),
        ],
      },
    ];

    const result = prepareCompleteWorldSnapshot(
      globalPayload,
      countryPayloads,
      directory,
      generatedAt,
    );

    expect(result.scope).toBe("prepared-world");
    expect(result.refreshAfterSeconds).toBe(60);
    expect(Object.keys(result.countryFeeds)).toEqual(["Canada", "Spain"]);
    expect(result.globalFeed.events).toHaveLength(1);
    expect(result.countryFeeds.Canada.events[0]?.headline).toContain("Canada");
    expect(result.countryFeeds.Spain.events[0]?.headline).toContain("Spain");
    expect(result.countryFeeds.Canada.loading).toBe(false);
  });
});
