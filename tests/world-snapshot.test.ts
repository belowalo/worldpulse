import { describe, expect, it } from "vitest";
import { gzipSync } from "node:zlib";

import {
  MAX_PREPARED_GLOBAL_ARTICLES,
  MAX_PREPARED_COUNTRY_EVENTS,
  mergePreparedCountryFeedSnapshots,
  prepareCompleteWorldSnapshot,
} from "@/lib/world-snapshot";
import {
  decodePreparedWorldNews,
  encodePreparedWorldNews,
  parsePreparedWorldResponseBytes,
} from "@/lib/snapshot-transport";
import { buildWorldDiagnostics } from "@/lib/world-health";
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

  it("bounds global processing while preserving complete country feeds", () => {
    const generatedAt = new Date().toISOString();
    const directory: MapCountry[] = [
      { mapId: "124", name: "Canada", iso2: "CA", events: [] },
    ];
    const globalPayload: LiveNewsPayload = {
      scope: "global",
      countryName: null,
      generatedAt,
      refreshAfterSeconds: 60,
      provider: "Live providers",
      articles: Array.from(
        { length: MAX_PREPARED_GLOBAL_ARTICLES + 20 },
        (_, index) => liveArticle(`global-${index}`, `World update ${index}`),
      ),
    };
    const countryPayloads: MapNewsCountryPayload[] = [
      {
        countryName: "Canada",
        generatedAt,
        available: true,
        articles: [liveArticle("local", "Canada local reporting")],
      },
    ];

    const result = prepareCompleteWorldSnapshot(
      globalPayload,
      countryPayloads,
      directory,
      generatedAt,
    );

    expect(result.globalFeed.events.length).toBeLessThanOrEqual(
      MAX_PREPARED_GLOBAL_ARTICLES,
    );
    expect(result.countryFeeds.Canada.events).toHaveLength(1);
  });

  it("normalizes repeated events and round-trips the prepared payload", () => {
    const generatedAt = new Date().toISOString();
    const directory: MapCountry[] = [
      { mapId: "124", name: "Canada", iso2: "CA", events: [] },
    ];
    const globalPayload: LiveNewsPayload = {
      scope: "global",
      countryName: null,
      generatedAt,
      refreshAfterSeconds: 60,
      provider: "Live providers",
      articles: [liveArticle("shared", "Canada announces a national rail agreement")],
    };
    const prepared = prepareCompleteWorldSnapshot(
      globalPayload,
      [],
      directory,
      generatedAt,
    );
    const wire = encodePreparedWorldNews(prepared);
    const decoded = decodePreparedWorldNews(wire);

    expect(wire.s).toBe("pw2");
    expect(wire.e).toHaveLength(1);
    expect(decoded).toEqual(prepared);
    expect(decoded.countryFeeds.Canada.events[0]).toBe(decoded.globalFeed.events[0]);
    expect(JSON.stringify(wire).length).toBeLessThan(JSON.stringify(prepared).length);
  });

  it("allows up to eight local events per country", () => {
    expect(MAX_PREPARED_COUNTRY_EVENTS).toBeGreaterThan(6);
  });

  it("keeps recent last-known-good country stories when a fresh feed is thin", () => {
    const generatedAt = new Date().toISOString();
    const directory: MapCountry[] = [
      { mapId: "124", name: "Canada", iso2: "CA", events: [] },
    ];
    const previous = prepareCompleteWorldSnapshot(
      {
        scope: "global",
        countryName: null,
        generatedAt,
        refreshAfterSeconds: 60,
        provider: "Live providers",
        articles: [],
      },
      [{
        countryName: "Canada",
        generatedAt,
        available: true,
        articles: [liveArticle("canada-current", "Canada current story")],
      }],
      directory,
      generatedAt,
    ).countryFeeds;
    const fresh = {
      Canada: {
        ...previous.Canada,
        events: [],
        updatedAt: new Date(Date.now() + 60_000).toISOString(),
      },
    };

    const merged = mergePreparedCountryFeedSnapshots(
      fresh,
      previous,
      ["Canada"],
    );

    expect(merged.Canada.events).toHaveLength(1);
    expect(merged.Canada.events[0]?.headline).toBe("Canada current story");
    expect(merged.Canada.updatedAt).toBe(fresh.Canada.updatedAt);
  });

  it("decodes an explicitly compressed snapshot response", async () => {
    const wire = { s: "pw2", v: "test", g: new Date().toISOString(), r: 60, n: [], a: [], e: [], f: { g: [[], null, null], c: [] } };
    const compressed = gzipSync(JSON.stringify(wire));
    await expect(
      parsePreparedWorldResponseBytes(new Uint8Array(compressed)),
    ).resolves.toEqual(wire);
  });

  it("alerts only for inhabited countries without news", () => {
    const generatedAt = new Date().toISOString();
    const directory: MapCountry[] = [
      { mapId: "124", name: "Canada", iso2: "CA", events: [] },
      { mapId: "724", name: "Spain", iso2: "ES", events: [] },
      { mapId: "334", name: "Heard I. and McDonald Is.", events: [] },
    ];
    const globalPayload: LiveNewsPayload = {
      scope: "global",
      countryName: null,
      generatedAt,
      refreshAfterSeconds: 60,
      provider: "Live providers",
      providers: [{ name: "Test feed", status: "ok", articleCount: 1 }],
      articles: [liveArticle("canada", "Canada announces a national rail agreement")],
    };
    const prepared = prepareCompleteWorldSnapshot(
      globalPayload,
      [],
      directory,
      generatedAt,
    );
    const health = buildWorldDiagnostics(prepared, directory, globalPayload, 900_000);

    expect(health.status).toBe("degraded");
    expect(health.missingInhabitedCountries).toEqual(["Spain"]);
    expect(health.expectedEmptyCountries).toEqual(["Heard I. and McDonald Is."]);
    expect(health.providerHealth[0]?.status).toBe("ok");
  });
});
