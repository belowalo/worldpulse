import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildEventLinkCollection,
  countriesMentionedByEvent,
  countryCentersFromGeoJson,
} from "@/lib/map-links";
import type { Event, MapCountry } from "@/lib/types";

const countries: MapCountry[] = [
  { mapId: "156", name: "China", iso2: "CN", events: [] },
  { mapId: "608", name: "Philippines", iso2: "PH", events: [] },
  { mapId: "818", name: "Egypt", iso2: "EG", events: [] },
  { mapId: "840", name: "United States", iso2: "US", events: [] },
];

const makeEvent = (headline: string, primaryCountry = "CN") =>
  ({
    id: `event-${headline}`,
    headline,
    summary: "Current reporting from public news feeds.",
    category: "Conflict and security",
    importanceScore: 72,
    importanceLabel: "Significant",
    geographicScope: "National",
    primaryCountry,
    affectedCountries: [primaryCountry],
    firstSeenAt: "2026-07-24T12:00:00.000Z",
    lastUpdatedAt: "2026-07-24T13:00:00.000Z",
    scoringComponents: {
      sourceDiversity: 1,
      geographicImpact: 1,
      publisherProminence: 1,
      recency: 1,
      coverageVelocity: 1,
    },
    scoringInput: {
      independentSourceCount: 1,
      sourceCountryCount: 1,
      affectedCountryCount: 1,
      countrySignificance: 50,
      publisherProminence: 50,
      ageHours: 1,
      articlesPerHour: 1,
    },
    articles: [],
    generatedSummary: true,
  }) satisfies Event;

describe("multi-country map links", () => {
  it("recognizes the countries named in an international event", () => {
    const event = makeEvent(
      "China, Philippine coastguard vessels clash in South China Sea",
    );
    expect(
      countriesMentionedByEvent(event, countries).map(
        (country) => country.name,
      ),
    ).toEqual(["China", "Philippines"]);
  });

  it("builds a curved link only when at least two countries are involved", () => {
    const centers = {
      China: [104, 35] as [number, number],
      Philippines: [122, 13] as [number, number],
      Egypt: [30, 27] as [number, number],
      "United States": [-98, 39] as [number, number],
    };
    const international = buildEventLinkCollection({
      events: [
        makeEvent(
          "China, Philippine coastguard vessels clash in South China Sea",
        ),
      ],
      countries,
      selectedMapId: "156",
      centers,
    });
    expect(international.features).toHaveLength(1);
    expect(international.features[0].properties).toMatchObject({
      from: "China",
      to: "Philippines",
    });
    expect(international.features[0].geometry.coordinates.length).toBeGreaterThan(
      20,
    );
    expect(international.features[0].geometry.coordinates[18]).not.toEqual([
      113,
      24,
    ]);

    const domestic = buildEventLinkCollection({
      events: [makeEvent("China announces a domestic museum opening")],
      countries,
      selectedMapId: "156",
      centers,
    });
    expect(domestic.features).toHaveLength(0);
  });

  it("finds a stable center for Egypt's real map geometry", () => {
    const geojson = JSON.parse(
      readFileSync(resolve("public/countries.geojson"), "utf8"),
    );
    const centers = countryCentersFromGeoJson(geojson);
    expect(centers.Egypt?.[0]).toBeGreaterThan(27);
    expect(centers.Egypt?.[0]).toBeLessThan(33);
    expect(centers.Egypt?.[1]).toBeGreaterThan(24);
    expect(centers.Egypt?.[1]).toBeLessThan(30);
  });
});
