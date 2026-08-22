import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { buildLiveEvents } from "@/lib/live-news";
import { mapStyleForEvent } from "@/lib/scoring";
import type {
  LiveNewsPayload,
  LiveWorldNewsPayload,
  MapCountry,
} from "@/lib/types";

const runLiveAudit = process.env.WORLD_PULSE_LIVE_QA === "1";
const baseUrl =
  process.env.WORLD_PULSE_QA_URL ??
  "https://worldpulse.belowalo2005.workers.dev";

async function fetchLiveWorld() {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(
        `${baseUrl}/api/live-news?scope=world-live`,
      );
      if (response.ok) return (await response.json()) as LiveWorldNewsPayload;
    } catch {
      // Retry transient edge or upstream failures.
    }
    await new Promise((resolve) => setTimeout(resolve, attempt * 500));
  }
  return null;
}

describe.skipIf(!runLiveAudit)("live country integrity", () => {
  it("serves a current, valid live feed for every inhabited map country", async () => {
    const geojson = JSON.parse(
      readFileSync(resolve("public/countries.geojson"), "utf8"),
    ) as {
      features: Array<{ id: string; properties: { name: string } }>;
    };
    const countries: MapCountry[] = geojson.features.map((feature) => ({
      mapId: String(feature.id),
      name: feature.properties.name,
      events: [],
    }));
    const world = await fetchLiveWorld();
    expect(world).not.toBeNull();
    if (!world) return;

    const feedByCountry = new Map(
      world.countries.map((country) => [country.countryName, country] as const),
    );
    const expectedEmpty = new Set([
      "Fr. S. Antarctic Lands",
      "Siachen Glacier",
    ]);
    const failures: string[] = [];
    let acceptedArticleCount = 0;

    if (world.scope !== "world-live") failures.push("invalid world scope");
    if (world.countries.length !== countries.length) {
      failures.push(
        `expected ${countries.length} country records, received ${world.countries.length}`,
      );
    }
    if (Date.now() - Date.parse(world.generatedAt) > 120_000) {
      failures.push("complete world feed is more than two minutes old");
    }

    for (const country of countries) {
      const feed = feedByCountry.get(country.name);
      if (!feed) {
        failures.push(`${country.name}: missing from complete world response`);
        continue;
      }
      if (!feed.articles.length) {
        if (!expectedEmpty.has(country.name)) {
          failures.push(`${country.name}: inhabited country has no live news`);
        }
        continue;
      }
      acceptedArticleCount += feed.articles.length;
      const payload: LiveNewsPayload = {
        countryName: country.name,
        scope: "country",
        generatedAt: feed.generatedAt,
        refreshAfterSeconds: world.refreshAfterSeconds,
        provider: world.provider,
        articles: feed.articles,
      };
      const topEvent = buildLiveEvents(payload, country)[0];
      if (!topEvent) {
        failures.push(`${country.name}: articles did not produce an event`);
        continue;
      }
      if (Date.now() - Date.parse(topEvent.lastUpdatedAt) > 8 * 86_400_000) {
        failures.push(`${country.name}: top event is stale`);
      }
      if (
        feed.articles.some(
          (article) =>
            !article.publisherName.trim() ||
            !/^https?:\/\//u.test(article.url) ||
            !Number.isFinite(Date.parse(article.publishedAt)),
        )
      ) {
        failures.push(`${country.name}: invalid article metadata`);
      }
      const style = mapStyleForEvent(
        topEvent.category,
        topEvent.importanceScore,
      );
      if (style.fillColor === "#303a47") {
        failures.push(`${country.name}: neutral color despite top event`);
      }
    }

    const actualEmpty = world.countries
      .filter((country) => !country.articles.length)
      .map((country) => country.countryName)
      .sort();
    expect(actualEmpty).toEqual([...expectedEmpty].sort());
    process.stdout.write(
      `\nLive country audit: ${countries.length} countries, ${acceptedArticleCount} current articles, ${failures.length} failures.\n`,
    );
    expect(failures, failures.join("\n")).toEqual([]);
  }, 60_000);
});
