import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildEventLinkCollection,
  countriesMentionedByEvent,
  countryCentersFromGeoJson,
} from "@/lib/map-links";
import {
  countrySearchTerms,
  textMatchesCountry,
} from "@/lib/country-terms";
import type { Event, MapCountry } from "@/lib/types";

const countries: MapCountry[] = [
  { mapId: "156", name: "China", iso2: "CN", events: [] },
  { mapId: "608", name: "Philippines", iso2: "PH", events: [] },
  { mapId: "818", name: "Egypt", iso2: "EG", events: [] },
  { mapId: "840", name: "United States", iso2: "US", events: [] },
  { mapId: "364", name: "Iran", iso2: "IR", events: [] },
  { mapId: "120", name: "Cameroon", iso2: "CM", events: [] },
  { mapId: "566", name: "Nigeria", iso2: "NG", events: [] },
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
  it("recognizes local names used for remote territories", () => {
    expect(
      textMatchesCountry(
        "Conservation work continues across the Chagos Archipelago",
        countrySearchTerms("Br. Indian Ocean Ter."),
      ),
    ).toBe(true);
    expect(
      textMatchesCountry(
        "Researchers return to Kerguelen for a new survey",
        countrySearchTerms("Fr. S. Antarctic Lands"),
      ),
    ).toBe(true);
    expect(
      textMatchesCountry(
        "Ascension Island updates its marine protection plan",
        countrySearchTerms("Saint Helena"),
      ),
    ).toBe(true);
    expect(
      textMatchesCountry(
        "Saint-Pierre-et-Miquelon adopte son budget territorial",
        countrySearchTerms("St. Pierre and Miquelon"),
      ),
    ).toBe(true);
    expect(
      textMatchesCountry(
        "Tahiti updates its coastal resilience plan",
        countrySearchTerms("Fr. Polynesia"),
      ),
    ).toBe(true);
    expect(
      textMatchesCountry(
        "Tarawa opens a new public health centre",
        countrySearchTerms("Kiribati"),
      ),
    ).toBe(true);
    expect(
      textMatchesCountry(
        "Mariehamn expands ferry service across the islands",
        countrySearchTerms("Aland"),
      ),
    ).toBe(true);
    expect(
      textMatchesCountry(
        "Saipan officials publish the new CNMI budget",
        countrySearchTerms("N. Mariana Is."),
      ),
    ).toBe(true);
    expect(
      textMatchesCountry(
        "Charlotte Amalie begins a USVI port upgrade",
        countrySearchTerms("U.S. Virgin Is."),
      ),
    ).toBe(true);
  });

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

  it("keeps a verified local-feed country as an affected country", () => {
    const event = makeEvent(
      "Cameroon and Malawi reach the continental semifinals",
      "CM",
    );
    const nigeria = countries.find((country) => country.name === "Nigeria");

    expect(
      countriesMentionedByEvent(event, countries, nigeria).map(
        (country) => country.name,
      ),
    ).toEqual(["Cameroon", "Nigeria"]);
  });

  it("treats uppercase US as a country without matching lowercase us", () => {
    const terms = countrySearchTerms("United States");
    expect(
      textMatchesCountry("US expands attacks on Iran", terms),
    ).toBe(true);
    expect(
      textMatchesCountry("Join us for the latest briefing", terms),
    ).toBe(false);

    const event = makeEvent(
      "US expands Iran attacks as Trump warns Tehran",
      "GLOBAL",
    );
    expect(
      countriesMentionedByEvent(event, countries).map(
        (country) => country.name,
      ),
    ).toEqual(["United States", "Iran"]);

    const links = buildEventLinkCollection({
      events: [event],
      countries,
      selectedMapId: null,
      centers: {
        "United States": [-98, 39],
        Iran: [53, 32],
      },
    });
    expect(links.features).toHaveLength(1);
    expect(links.features[0].properties).toMatchObject({
      from: "United States",
      to: "Iran",
    });
  });

  it("distinguishes the country Georgia from the U.S. state", () => {
    const terms = countrySearchTerms("Georgia");

    expect(terms).not.toContain("Georgia");
    expect(
      textMatchesCountry(
        "Tbilisi hosts talks between the Georgian government and EU leaders",
        terms,
      ),
    ).toBe(true);
    expect(
      textMatchesCountry(
        "Georgia Bulldogs release their SEC football schedule",
        terms,
      ),
    ).toBe(false);
    expect(
      textMatchesCountry(
        "ICE announces more than 1,200 arrests across Atlanta and Georgia",
        terms,
      ),
    ).toBe(false);
  });

  it("builds a curved link only when at least two countries are involved", () => {
    const centers = {
      China: [104, 35] as [number, number],
      Philippines: [122, 13] as [number, number],
      Egypt: [30, 27] as [number, number],
      "United States": [-98, 39] as [number, number],
      Iran: [53, 32] as [number, number],
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
    expect(centers["840"]).toEqual(centers["United States"]);
  });
});
