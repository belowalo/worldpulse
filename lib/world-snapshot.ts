import {
  buildLiveEvents,
  mergeEventFeeds,
} from "@/lib/live-news";
import { countriesMentionedByEvent } from "@/lib/map-links";
import {
  countryNameNeedsDisambiguation,
  countrySearchTerms,
  textMatchesCountry,
} from "@/lib/country-terms";
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
export const MAX_PREPARED_COUNTRY_EVENTS = 20;
export const PREPARED_STORY_RETENTION_MS = 7 * 24 * 60 * 60 * 1_000;
const PREPARED_STORY_ROLLOVER_GUARD_MS = 5 * 60_000;

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
        if (!Number.isFinite(updatedAt) || updatedAt < cutoff) return false;
        if (!countryNameNeedsDisambiguation(countryName)) return true;
        const searchableText = [
          event.headline,
          event.summary,
          ...event.articles.map((article) => article.headline),
        ].join(" ");
        return textMatchesCountry(
          searchableText,
          countrySearchTerms(countryName),
        );
      }),
      loading: false,
      error: null,
    };
  }
  return merged;
}

export function mergeLatestPreparedCountryFeedSources(
  leftFeeds: Record<string, PreparedNewsFeed>,
  rightFeeds: Record<string, PreparedNewsFeed>,
  countryNames: string[],
) {
  const merged: Record<string, PreparedNewsFeed> = {};
  for (const countryName of countryNames) {
    const left = leftFeeds[countryName];
    const right = rightFeeds[countryName];
    if (!left && !right) continue;
    const leftTimestamp = Date.parse(left?.updatedAt ?? "");
    const rightTimestamp = Date.parse(right?.updatedAt ?? "");
    const leftIsLatest =
      !right ||
      (Number.isFinite(leftTimestamp) &&
        (!Number.isFinite(rightTimestamp) || leftTimestamp >= rightTimestamp));
    const latest = leftIsLatest ? left : right;
    const previous = leftIsLatest ? right : left;
    const country = mergePreparedCountryFeedSnapshots(
      latest ? { [countryName]: latest } : {},
      previous ? { [countryName]: previous } : {},
      [countryName],
    )[countryName];
    if (country) merged[countryName] = country;
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

function anchorEventToCountry(event: Event, country: MapCountry) {
  const identifier = country.iso2 ?? country.name;
  const affectedCountries = [
    ...new Set([...event.affectedCountries, identifier]),
  ];
  const scoringInput = {
    ...event.scoringInput,
    affectedCountryCount: Math.max(1, affectedCountries.length),
  };
  const scoring = calculateImportance(scoringInput);
  return {
    ...event,
    primaryCountry:
      event.primaryCountry === "GLOBAL" ? identifier : event.primaryCountry,
    affectedCountries,
    geographicScope:
      affectedCountries.length > 1
        ? ("International" as const)
        : event.geographicScope,
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
      provider: "Hemisphere Herald",
      // The globe renders at most twenty country events. Bounding the input
      // prevents thousands of extra similarity comparisons on every poll.
      articles: countryPayload.articles.slice(0, MAX_PREPARED_COUNTRY_EVENTS),
    };
    feeds[country.name] = {
      // The continuous collector already verifies country relevance before
      // publishing this record, so the browser should not filter it again.
      events: buildLiveEvents(livePayload, country),
      updatedAt: countryPayload.generatedAt,
      provider: "Hemisphere Herald",
      loading: false,
      error: null,
    };
  }
  return feeds;
}

export function buildLiveWorldView(
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

// Legacy test fixtures still import the old builder name. Production uses the
// live-world name above and never persists its return value.
export const prepareCompleteWorldSnapshot = buildLiveWorldView;

export function prepareCompleteWorldSnapshotFromFeeds(
  globalPayload: LiveNewsPayload,
  localFeeds: Record<string, PreparedNewsFeed>,
  countryDirectory: MapCountry[],
  generatedAt = new Date().toISOString(),
): PreparedWorldNewsPayload {
  const generatedTimestamp = Date.parse(generatedAt);
  const retentionCutoff =
    (Number.isFinite(generatedTimestamp) ? generatedTimestamp : Date.now()) -
    PREPARED_STORY_RETENTION_MS +
    PREPARED_STORY_ROLLOVER_GUARD_MS;
  const isRetainedStory = (event: Event) => {
    const updatedAt = Date.parse(event.lastUpdatedAt);
    return Number.isFinite(updatedAt) && updatedAt >= retentionCutoff;
  };
  const globalEvents = buildLiveEvents(
    {
      ...globalPayload,
      articles: globalPayload.articles.slice(0, MAX_PREPARED_GLOBAL_ARTICLES),
    },
    null,
  )
    .map((event) => applyDetectedGeography(event, countryDirectory))
    .filter(isRetainedStory);
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
    const normalizedLocalEvents = (localFeed?.events ?? [])
      // Local provider results have already been country-verified. Re-anchor
      // them in constant time instead of scanning every event against every
      // country name and alias again in the browser.
      .map((event) => anchorEventToCountry(event, country))
      .filter(isRetainedStory);
    const latestLocalEvents = [...normalizedLocalEvents]
      .sort(
        (left, right) =>
          Date.parse(right.lastUpdatedAt) - Date.parse(left.lastUpdatedAt) ||
          right.importanceScore - left.importanceScore,
      )
      .slice(0, MAX_PREPARED_COUNTRY_EVENTS);
    const matchingGlobalEvents =
      currentGlobalEventsByCountry.get(country.name) ?? [];
    countryFeeds[country.name] = {
      // buildLiveEvents already returns a clustered, ranked local feed. Avoid
      // an O(n²) similarity merge when there is no global event to add.
      events: matchingGlobalEvents.length
        ? mergeEventFeeds(latestLocalEvents, matchingGlobalEvents)
        : latestLocalEvents,
      updatedAt: localFeed?.updatedAt ?? generatedAt,
      provider: "Hemisphere Herald \u00b7 minute world state",
      loading: false,
      error: null,
    };
  }
  const affectedCountriesByEvent = new Map<string, Set<string>>();
  for (const event of [
    ...globalEvents,
    ...Object.values(countryFeeds).flatMap((feed) => feed.events),
  ]) {
    const affected = affectedCountriesByEvent.get(event.id) ?? new Set<string>();
    for (const identifier of event.affectedCountries) affected.add(identifier);
    affectedCountriesByEvent.set(event.id, affected);
  }
  const finalizeEventGeography = (event: Event) => {
    const affectedCountries = [
      ...(affectedCountriesByEvent.get(event.id) ?? event.affectedCountries),
    ];
    const scoringInput = {
      ...event.scoringInput,
      affectedCountryCount: Math.max(1, affectedCountries.length),
    };
    const scoring = calculateImportance(scoringInput);
    return {
      ...event,
      affectedCountries,
      geographicScope:
        affectedCountries.length > 1
          ? ("International" as const)
          : event.geographicScope,
      primaryCountry:
        event.primaryCountry === "GLOBAL" && affectedCountries[0]
          ? affectedCountries[0]
          : event.primaryCountry,
      importanceScore: scoring.score,
      importanceLabel: scoring.label,
      scoringComponents: scoring.components,
      scoringInput,
    };
  };
  for (const feed of Object.values(countryFeeds)) {
    feed.events = feed.events.map(finalizeEventGeography);
  }
  const finalizedGlobalEvents = globalEvents.map(finalizeEventGeography);
  return {
    scope: "live-world-view",
    version: generatedAt.slice(0, 16),
    generatedAt,
    refreshAfterSeconds: 60,
    globalFeed: {
      events: finalizedGlobalEvents,
      updatedAt: globalPayload.generatedAt,
      provider: globalPayload.provider,
      loading: false,
      error: null,
    },
    countryFeeds,
  };
}
