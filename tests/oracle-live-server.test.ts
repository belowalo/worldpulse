import { describe, expect, it } from "vitest";
import type { LiveArticle, MapNewsCountryPayload } from "../lib/types";
import {
  bootstrapProgress,
  buildWorldPayload,
  mergeCountryFeed,
  selectDiverseCountryArticles,
  type PersistedCollectorState,
} from "../server/oracle-live-server";

function article(id: string, publishedAt = new Date().toISOString()): LiveArticle {
  return {
    id,
    title: `Article ${id}`,
    url: `https://example.com/${id}`,
    publisherName: "Example",
    publisherUrl: "https://example.com",
    publishedAt,
  };
}

function state(): PersistedCollectorState {
  return {
    version: 1,
    startedAt: "2026-08-21T00:00:00.000Z",
    updatedAt: "2026-08-21T01:00:00.000Z",
    completedCycleAt: null,
    cycleNumber: 0,
    global: null,
    countries: {},
    lastAttemptAt: {},
  };
}

describe("Oracle live server", () => {
  it("keeps current last-known-good stories when a provider scan is temporarily empty", () => {
    const current: MapNewsCountryPayload = {
      countryName: "Iran",
      generatedAt: "2026-08-21T00:00:00.000Z",
      available: true,
      articles: [
        {
          ...article("current"),
          title: "Iran announces a new national infrastructure plan",
        },
      ],
    };
    const incoming: MapNewsCountryPayload = {
      countryName: "Iran",
      generatedAt: "2026-08-21T01:00:00.000Z",
      available: false,
      articles: [],
    };
    const merged = mergeCountryFeed("Iran", current, incoming);
    expect(merged.generatedAt).toBe(incoming.generatedAt);
    expect(merged.available).toBe(true);
    expect(merged.articles.map((item) => item.id)).toEqual(["current"]);
  });

  it("purges topic labels and Palestine locality collisions from persisted state", () => {
    const publishedAt = new Date().toISOString();
    const current: MapNewsCountryPayload = {
      countryName: "Palestine",
      generatedAt: publishedAt,
      available: true,
      articles: [
        { ...article("topic", publishedAt), title: "Israel & Palestine" },
        {
          ...article("new-palestine", publishedAt),
          title: "New Palestine wins Indiana high school football opener",
        },
        {
          ...article("gaza-aid", publishedAt),
          title: "Palestinian officials discuss aid deliveries in Gaza",
        },
      ],
    };

    const merged = mergeCountryFeed("Palestine", current, undefined);
    expect(merged.articles.map((item) => item.id)).toEqual(["gaza-aid"]);
  });

  it("purges person, product, and U.S. locality collisions for nearby countries", () => {
    const publishedAt = new Date().toISOString();
    const jordan = mergeCountryFeed(
      "Jordan",
      {
        countryName: "Jordan",
        generatedAt: publishedAt,
        available: true,
        articles: [
          { ...article("jordan-love", publishedAt), title: "Jordan Love throws a touchdown pass" },
          { ...article("air-jordan", publishedAt), title: "Air Jordan 14 Low gets a release date" },
          { ...article("jordan-ingman", publishedAt), title: "County economic development highlights Jordan Ingman" },
          { ...article("jordan-trade", publishedAt), title: "Jordan expands trade with West Bank markets" },
        ],
      },
      undefined,
    );
    const lebanon = mergeCountryFeed(
      "Lebanon",
      {
        countryName: "Lebanon",
        generatedAt: publishedAt,
        available: true,
        articles: [
          { ...article("lebanon-county", publishedAt), title: "Police investigate crash in Lebanon County" },
          { ...article("lebanon-economy", publishedAt), title: "Lebanon economy contracts as regional war continues" },
        ],
      },
      undefined,
    );

    expect(jordan.articles.map((item) => item.id)).toEqual(["jordan-trade"]);
    expect(lebanon.articles.map((item) => item.id)).toEqual(["lebanon-economy"]);
  });

  it("retains distinct events before additional coverage of a dominant story", () => {
    const publishedAt = "2026-08-22T06:00:00.000Z";
    const tariffCoverage = Array.from({ length: 24 }, (_, index) => ({
      ...article(`tariff-${index}`, publishedAt),
      title:
        index % 2
          ? `Canada vows dollar-for-dollar tariff retaliation after U.S. trade talks fail ${index}`
          : `U.S. and Canada trade talks collapse as new tariffs take effect ${index}`,
      publisherName: `Tariff Publisher ${index}`,
      publisherUrl: `https://tariff-${index}.example.com`,
    }));
    const distinctStories: LiveArticle[] = [
      {
        ...article("wnba", "2026-08-22T05:59:00.000Z"),
        title: "WNBA games in Canada remain surreal for Olympic basketball star",
      },
      {
        ...article("wildfire", "2026-08-22T05:58:00.000Z"),
        title: "Canada wildfire crews expand evacuation zone in British Columbia",
      },
      {
        ...article("health", "2026-08-22T05:57:00.000Z"),
        title: "Canada health agency launches a national vaccination campaign",
      },
    ];

    const selected = selectDiverseCountryArticles(
      "Canada",
      [...tariffCoverage, ...distinctStories],
      20,
    );

    expect(selected).toHaveLength(8);
    expect(selected.map((item) => item.id)).toEqual(
      expect.arrayContaining(["wnba", "wildfire", "health"]),
    );
    expect(
      selected.filter((item) => item.id.startsWith("tariff-")).length,
    ).toBeLessThanOrEqual(5);
  });

  it("becomes ready after global news and every country attempt, including across a restart", () => {
    const current = state();
    current.global = {
      countryName: null,
      scope: "global",
      generatedAt: current.updatedAt,
      refreshAfterSeconds: 60,
      provider: "test",
      articles: [article("global")],
    };
    current.lastAttemptAt = { Iran: current.updatedAt, Mauritania: current.updatedAt };
    expect(bootstrapProgress(current, ["Iran", "Mauritania"])).toMatchObject({
      ready: true,
      attemptedCountries: 2,
      totalCountries: 2,
    });
  });

  it("always emits the complete country directory in stable order", () => {
    const current = state();
    const payload = buildWorldPayload(current, ["Mauritania", "Iran"]);
    expect(payload.scope).toBe("world-live");
    expect(payload.countries.map((country) => country.countryName)).toEqual([
      "Mauritania",
      "Iran",
    ]);
    expect(payload.countries.every((country) => country.articles.length === 0)).toBe(true);
  });
});
