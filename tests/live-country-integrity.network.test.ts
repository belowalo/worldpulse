import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { countryCodeForName } from "@/lib/country-locale";
import {
  articlesMentioningCountry,
  buildLiveEvents,
  mergeEventFeeds,
} from "@/lib/live-news";
import { mapStyleForEvent } from "@/lib/scoring";
import type {
  LiveNewsPayload,
  MapCountry,
  MapNewsPayload,
} from "@/lib/types";

const runLiveAudit = process.env.WORLD_PULSE_LIVE_QA === "1";
const baseUrl = process.env.WORLD_PULSE_QA_URL ?? "http://localhost:3000";
const ALLOWED_NEUTRAL_MAP_AREAS = new Set([
  "Antarctica",
  "Fr. S. Antarctic Lands",
  "Heard I. and McDonald Is.",
]);

async function parallelMap<T, R>(
  items: T[],
  concurrency: number,
  task: (item: T) => Promise<R>,
) {
  const results = new Array<R>(items.length);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (cursor < items.length) {
        const index = cursor;
        cursor += 1;
        results[index] = await task(items[index]);
      }
    }),
  );
  return results;
}

async function fetchJsonWithRetry<T>(url: string) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return (await response.json()) as T;
    } catch {
      // Retry transient local-worker and upstream failures.
    }
    await new Promise((resolve) => setTimeout(resolve, attempt * 300));
  }
  return null;
}

describe.skipIf(!runLiveAudit)("live country integrity", () => {
  it("returns a current, related top event or a truthful neutral state for all 215 map areas", async () => {
    const geojson = JSON.parse(
      readFileSync(resolve("public/countries.geojson"), "utf8"),
    ) as {
      features: Array<{ id: string; properties: { name: string } }>;
    };
    const countries: MapCountry[] = geojson.features.map((feature) => ({
      mapId: String(feature.id),
      name: feature.properties.name,
      iso2: countryCodeForName(feature.properties.name) ?? undefined,
      events: [],
    }));

    const mapPayloads = await parallelMap(
      Array.from({ length: Math.ceil(countries.length / 8) }, (_, index) =>
        countries.slice(index * 8, index * 8 + 8),
      ),
      2,
      async (batch) => {
        const parameters = new URLSearchParams({
          scope: "map",
          countries: batch.map((country) => country.name).join("|"),
          fresh: "1",
        });
        return fetchJsonWithRetry<MapNewsPayload>(
          `${baseUrl}/api/live-news?${parameters.toString()}`,
        );
      },
    );
    const mapArticles = new Map(
      mapPayloads.flatMap((payload) =>
        (payload?.countries ?? []).map(
          (country) => [country.countryName, country.articles] as const,
        ),
      ),
    );
    const currentRelatedMapArticles = new Map(
      countries.map((country) => {
        const payload: LiveNewsPayload = {
          countryName: country.name,
          scope: "country",
          generatedAt: new Date().toISOString(),
          refreshAfterSeconds: 300,
          provider: "Live world search",
          articles: mapArticles.get(country.name) ?? [],
        };
        return [
          country.name,
          articlesMentioningCountry(payload, country.name).filter(
            (article) =>
              Date.now() - Date.parse(article.publishedAt) <=
              7 * 24 * 3_600_000,
          ),
        ] as const;
      }),
    );
    const countriesNeedingDeepSearch = countries.filter(
      (country) => !currentRelatedMapArticles.get(country.name)?.length,
    );

    const deepPayloads = await parallelMap(
      countriesNeedingDeepSearch,
      3,
      async (country) => {
        const parameters = new URLSearchParams({
          country: country.name,
          fresh: "1",
        });
        if (country.iso2) parameters.set("iso2", country.iso2);
        return fetchJsonWithRetry<LiveNewsPayload>(
          `${baseUrl}/api/live-news?${parameters.toString()}`,
        );
      },
    );
    const deepPayloadByCountry = new Map(
      countriesNeedingDeepSearch.map(
        (country, index) => [country.name, deepPayloads[index]] as const,
      ),
    );

    const failures: string[] = [];
    let acceptedArticleCount = 0;
    for (const country of countries) {
      const deepPayload = deepPayloadByCountry.get(country.name);
      if (
        countriesNeedingDeepSearch.some(
          (candidate) => candidate.name === country.name,
        ) &&
        !deepPayload
      ) {
        failures.push(`${country.name}: country endpoint failed after retries`);
      }
      const mapPayload: LiveNewsPayload = {
        countryName: country.name,
        scope: "country",
        generatedAt: new Date().toISOString(),
        refreshAfterSeconds: 300,
        provider: "Live world search",
        articles: currentRelatedMapArticles.get(country.name) ?? [],
      };
      const relevantDeep = articlesMentioningCountry(
        deepPayload ?? { ...mapPayload, articles: [] },
        country.name,
      );
      const relevantMap = articlesMentioningCountry(
        mapPayload,
        country.name,
      );
      acceptedArticleCount += relevantDeep.length + relevantMap.length;
      const events = mergeEventFeeds(
        buildLiveEvents(
          {
            ...(deepPayload ?? mapPayload),
            articles: relevantDeep,
          },
          country,
        ),
        buildLiveEvents(
          { ...mapPayload, articles: relevantMap },
          country,
        ),
      );
      const topEvent = events[0];
      if (!topEvent) {
        if (!ALLOWED_NEUTRAL_MAP_AREAS.has(country.name)) {
          failures.push(`${country.name}: no related event`);
        }
        continue;
      }
      const ageHours =
        (Date.now() - Date.parse(topEvent.lastUpdatedAt)) / 3_600_000;
      if (!Number.isFinite(ageHours) || ageHours > 7 * 24) {
        failures.push(`${country.name}: top event is not current`);
      }
      if (
        !topEvent.articles.length ||
        topEvent.articles.some(
          (article) =>
            !article.source.publisherName.trim() ||
            !/^https?:\/\//u.test(article.originalUrl),
        )
      ) {
        failures.push(`${country.name}: invalid publisher metadata`);
      }
      const style = mapStyleForEvent(
        topEvent.category,
        topEvent.importanceScore,
      );
      if (style.fillColor === "#303a47") {
        failures.push(`${country.name}: neutral color despite top event`);
      }
    }

    process.stdout.write(
      `\nLive country audit: ${countries.length} countries, ${acceptedArticleCount} related articles, ${failures.length} failures.\n`,
    );
    expect(failures, failures.join("\n")).toEqual([]);
  }, 300_000);
});
