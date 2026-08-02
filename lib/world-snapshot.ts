import {
  articlesMentioningCountry,
  buildLiveEvents,
} from "@/lib/live-news";
import { countriesMentionedByEvent } from "@/lib/map-links";
import { calculateImportance } from "@/lib/scoring";
import type {
  Event,
  LiveNewsPayload,
  MapCountry,
  MapNewsPayload,
} from "@/lib/types";

export interface PreparedCountryFeed {
  error: string | null;
  events: Event[];
  loading: false;
  provider: string;
  updatedAt: string;
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
