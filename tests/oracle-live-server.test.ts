import { describe, expect, it } from "vitest";
import type { LiveArticle, MapNewsCountryPayload } from "../lib/types";
import {
  bootstrapProgress,
  buildWorldPayload,
  mergeCountryFeed,
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
      articles: [article("current")],
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

  it("does not become ready until global news and every country attempt exist", () => {
    const current = state();
    current.global = {
      countryName: null,
      scope: "global",
      generatedAt: current.updatedAt,
      refreshAfterSeconds: 60,
      provider: "test",
      articles: [article("global")],
    };
    current.completedCycleAt = current.updatedAt;
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
