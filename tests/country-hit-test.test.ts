import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildCountryHitIndex,
  countryFeatureAtCoordinates,
  type WorldFeatureCollection,
} from "@/lib/country-hit-test";

const countriesPath = resolve(process.cwd(), "public/countries.geojson");
const countries = JSON.parse(
  readFileSync(countriesPath, "utf8"),
) as WorldFeatureCollection;
const countryIndex = buildCountryHitIndex(countries);

function countryAt(longitude: number, latitude: number) {
  return countryFeatureAtCoordinates(countryIndex, longitude, latitude)?.name;
}

describe("country geometry hit testing", () => {
  it.each([
    ["Mallorca", 2.9, 39.6, "Spain"],
    ["Menorca", 4.1, 39.95, "Spain"],
    ["Ibiza", 1.43, 38.98, "Spain"],
    ["Corsica", 9, 42.1, "France"],
    ["Sardinia", 9, 40, "Italy"],
    ["Barbados", -59.55, 13.18, "Barbados"],
    ["Dominica", -61.37, 15.4, "Dominica"],
    ["Saint Lucia", -60.98, 13.9, "Saint Lucia"],
    ["Puerto Rico", -66.3, 18.25, "Puerto Rico"],
    ["U.S. Virgin Islands", -64.75, 17.74, "U.S. Virgin Is."],
    ["Jamaica", -77.3, 18.1, "Jamaica"],
    ["Trinidad", -61.28, 10.48, "Trinidad and Tobago"],
    ["Grenada", -61.68, 12.12, "Grenada"],
    ["Antigua", -61.8, 17.08, "Antigua and Barb."],
    ["Saint Vincent", -61.2, 13.2, "St. Vin. and Gren."],
    ["Canary Islands", -15.5, 28.1, "Spain"],
    ["Cape Verde", -23.6, 15.1, "Cape Verde"],
  ])("selects %s correctly", (_place, longitude, latitude, expected) => {
    expect(countryAt(longitude, latitude)).toBe(expected);
  });

  it.each([
    [-62.5, 14.5],
    [-60.2, 15.2],
    [5.5, 39.8],
  ])("does not turn nearby ocean into a country at %s, %s", (longitude, latitude) => {
    expect(countryAt(longitude, latitude)).toBeUndefined();
  });

  it("respects polygon holes", () => {
    const index = buildCountryHitIndex({
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          id: "ring-country",
          properties: { name: "Ring Country" },
          geometry: {
            type: "Polygon",
            coordinates: [
              [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]],
              [[4, 4], [6, 4], [6, 6], [4, 6], [4, 4]],
            ],
          },
        },
      ],
    });

    expect(countryFeatureAtCoordinates(index, 2, 2)?.name).toBe("Ring Country");
    expect(countryFeatureAtCoordinates(index, 5, 5)).toBeUndefined();
  });

  it("matches polygons that cross the international date line", () => {
    const index = buildCountryHitIndex({
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          id: "date-line-country",
          properties: { name: "Date Line Country" },
          geometry: {
            type: "Polygon",
            coordinates: [
              [[179, -2], [-179, -2], [-179, 2], [179, 2], [179, -2]],
            ],
          },
        },
      ],
    });

    expect(countryFeatureAtCoordinates(index, 179.5, 0)?.name).toBe(
      "Date Line Country",
    );
    expect(countryFeatureAtCoordinates(index, -179.5, 0)?.name).toBe(
      "Date Line Country",
    );
    expect(countryFeatureAtCoordinates(index, 0, 0)).toBeUndefined();
  });
});
