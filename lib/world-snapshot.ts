import {
  articlesMentioningCountry,
  buildLiveEvents,
  mergeEventFeeds,
} from "@/lib/live-news";
import { countriesMentionedByEvent } from "@/lib/map-links";
import { calculateImportance } from "@/lib/scoring";
import type {
  Event,
  LiveNewsPayload,
  MapCountry,
  MapNewsPayload,
  PreparedNewsFeed,
  PreparedWorldNewsPayload,
} from "@/lib/types";

export interface PreparedCountryFeed {
  error: null;
  events: Event[];
  loading: false;
  provider: string;
  updatedAt: string;
}

// The UI renders only a ranked portion of the world feed. A generous bound
// avoids repeating hundreds of global stories through country feeds and keeps
// the minute snapshot within the production Worker's CPU allowance. Local
// country feeds remain independently complete.
export const MAX_PREPARED_GLOBAL_ARTICLES = 30;
export const MAX_PREPARED_COUNTRY_EVENTS = 8;
export const PREPARED_STORY_RETENTION_MS = 7 * 24 * 60 * 60 * 1_000;

export function mergePreparedCountryFeedSnapshots(
  freshFeeds: Record<string, PreparedNewsFeed>,
  previousFeeds: Record<string, PreparedNewsFeed>,
  countryNames: string[],
  now = Date.now(),
) {
  const cutoff = now - PREPARED_STORY_RETENTION_MS;
  const merged: Record<string, PreparedNewsFeed> = {};
  for (const countryName of countryNames) {
    const fresh = freshFeeds[countryName];
    const previous = previousFeeds[countryName];
    if (!fresh && !previous) continue;
    const base = fresh ?? previous;
    merged[countryName] = {
      ...base,
      events: mergeEventFeeds(
        fresh?.events ?? [],
        previous?.events ?? [],
      ).filter((event) => {
        const updatedAt = Date.parse(event.lastUpdatedAt);
        return Number.isFinite(updatedAt) && updatedAt >= cutoff;
      }),
      loading: false,
      error: null,
    };
  }
  return merged;
}

export function applyDetectedGeography(
  event: Event,
  countries: MapCountry[],
  anchorCountry?: MapCountry,
) {
  const mentionedCountries = countriesMentionedByEvent(
    event,
    countries,
    anchorCountry,
  );
  const detectedCountries = mentionedCountries.map(
    (country) => country.iso2 ?? country.name,
  );
  const affectedCountries = [
    ...new Set(
      detectedCountries.length
        ? detectedCountries
        : event.affectedCountries.length
          ? event.affectedCountries
          : event.primaryCountry !== "GLOBAL"
            ? [event.primaryCountry]
            : [],
    ),
  ];
  const scoringInput = {
    ...event.scoringInput,
    affectedCountryCount: Math.max(1, affectedCountries.length),
  };
  const scoring = calculateImportance(scoringInput);
  return {
    ...event,
    geographicScope:
      affectedCountries.length > 1
        ? ("International" as const)
        : event.geographicScope,
    primaryCountry:
      event.primaryCountry === "GLOBAL" && affectedCountries[0]
        ? affectedCountries[0]
        : event.primaryCountry,
    affectedCountries,
    importanceScore: scoring.score,
    importanceLabel: scoring.label,
    scoringComponents: scoring.components,
    scoringInput,
  };
}

export function prepareWorldSnapshotFeeds(
  payloads: MapNewsPayload["countries"],
  countryDirectory: MapCountry[],
) {
  const countriesByName = new Map(
    countryDirectory.map((country) => [country.name, country]),
  );
  const feeds: Record<string, PreparedCountryFeed> = {};
  for (const countryPayload of payloads) {
    const country = countriesByName.get(countryPayload.countryName);
    if (!country) continue;
    const livePayload: LiveNewsPayload = {
      countryName: country.name,
      scope: "country",
      generatedAt: countryPayload.generatedAt,
      refreshAfterSeconds: 300,
      provider: "WorldPulse",
      articles: countryPayload.articles,
    };
    const countryArticles = articlesMentioningCountry(
      livePayload,
      country.name,
    );
    feeds[country.name] = {
      events: buildLiveEvents(
        { ...livePayload, articles: countryArticles },
        country,
      ).map((event) =>
        applyDetectedGeography(event, countryDirectory, country),
      ),
      updatedAt: countryPayload.generatedAt,
      provider: "WorldPulse",
      loading: false,
      error: null,
    };
  }
  return feeds;
}

export function prepareCompleteWorldSnapshot(
  globalPayload: LiveNewsPayload,
  countryPayloads: MapNewsPayload["countries"],
  countryDirectory: MapCountry[],
  generatedAt = new Date().toISOString(),
): PreparedWorldNewsPayload {
  const localFeeds = prepareWorldSnapshotFeeds(
    countryPayloads,
    countryDirectory,
  );
  return prepareCompleteWorldSnapshotFromFeeds(
    globalPayload,
    localFeeds,
    countryDirectory,
    generatedAt,
  );
}

export function prepareCompleteWorldSnapshotFromFeeds(
  globalPayload: LiveNewsPayload,
  localFeeds: Record<string, PreparedNewsFeed>,
  countryDirectory: MapCountry[],
  generatedAt = new Date().toISOString(),
): PreparedWorldNewsPayload {
  const globalEvents = buildLiveEvents(
    {
      ...globalPayload,
      articles: globalPayload.articles.slice(0, MAX_PREPARED_GLOBAL_ARTICLES),
    },
    null,
  ).map((event) => applyDetectedGeography(event, countryDirectory));
  const countriesByIdentifier = new Map<string, MapCountry>();
  for (const country of countryDirectory) {
    countriesByIdentifier.set(country.name, country);
    if (country.iso2) countriesByIdentifier.set(country.iso2, country);
  }
  const currentGlobalEventsByCountry = new Map<string, Event[]>();
  for (const event of globalEvents) {
    for (const identifier of event.affectedCountries) {
      const country = countriesByIdentifier.get(identifier);
      if (!country) continue;
      const events = currentGlobalEventsByCountry.get(country.name) ?? [];
      events.push(event);
      currentGlobalEventsByCountry.set(country.name, events);
    }
  }
  const countryFeeds: PreparedWorldNewsPayload["countryFeeds"] = {};
  for (const country of countryDirectory) {
    const localFeed = localFeeds[country.name];
    const normalizedLocalEvents = (localFeed?.events ?? []).map((event) =>
      applyDetectedGeography(event, countryDirectory, country),
    );
    countryFeeds[country.name] = {
      events: mergeEventFeeds(
        normalizedLocalEvents.slice(0, MAX_PREPARED_COUNTRY_EVENTS),
        currentGlobalEventsByCountry.get(country.name) ?? [],
      ).sort(
        (left, right) =>
          right.importanceScore - left.importanceScore ||
          Date.parse(right.lastUpdatedAt) - Date.parse(left.lastUpdatedAt),
      ),
      updatedAt: localFeed?.updatedAt ?? generatedAt,
      provider: "WorldPulse \u00b7 minute world state",
      loading: false,
      error: null,
    };
  }
  return {
    scope: "prepared-world",
    version: generatedAt.slice(0, 16),
    generatedAt,
    refreshAfterSeconds: 60,
    globalFeed: {
      events: globalEvents,
      updatedAt: globalPayload.generatedAt,
      provider: globalPayload.provider,
      loading: false,
      error: null,
    },
    countryFeeds,
  };
}
