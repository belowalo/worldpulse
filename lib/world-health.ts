import type {
  LiveNewsPayload,
  MapCountry,
  PreparedWorldNewsPayload,
  WorldPulseDiagnostics,
} from "@/lib/types";

export const EXPECTED_EMPTY_COUNTRIES = new Set([
  "Antarctica",
  "Fr. S. Antarctic Lands",
  "Heard I. and McDonald Is.",
  "S. Geo. and S. Sandw. Is.",
]);

export function buildWorldDiagnostics(
  snapshot: PreparedWorldNewsPayload,
  directory: MapCountry[],
  globalPayload: LiveNewsPayload,
  snapshotBytes: number,
): WorldPulseDiagnostics {
  const missingInhabitedCountries = directory
    .filter(
      (country) =>
        !EXPECTED_EMPTY_COUNTRIES.has(country.name) &&
        !snapshot.countryFeeds[country.name]?.events.length,
    )
    .map((country) => country.name);
  const expectedEmptyCountries = directory
    .filter(
      (country) =>
        EXPECTED_EMPTY_COUNTRIES.has(country.name) &&
        !snapshot.countryFeeds[country.name]?.events.length,
    )
    .map((country) => country.name);
  const inhabitedCountries = directory.filter(
    (country) => !EXPECTED_EMPTY_COUNTRIES.has(country.name),
  ).length;

  return {
    status: missingInhabitedCountries.length ? "degraded" : "healthy",
    fresh: true,
    generatedAt: snapshot.generatedAt,
    snapshotGeneratedAt: snapshot.generatedAt,
    snapshotBytes,
    totalCountries: directory.length,
    countriesWithNews: directory.filter(
      (country) => snapshot.countryFeeds[country.name]?.events.length,
    ).length,
    inhabitedCountries,
    inhabitedCountriesWithNews:
      inhabitedCountries - missingInhabitedCountries.length,
    missingInhabitedCountries,
    expectedEmptyCountries,
    globalEventCount: snapshot.globalFeed.events.length,
    providerHealth: globalPayload.providers ?? [],
  };
}
