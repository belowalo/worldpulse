import { countrySearchTerms, textMatchesCountry } from "./country-terms";
import { categoryColor } from "./scoring";
import type { Event, MapCountry } from "./types";

export type MapPosition = [number, number];

interface CountryFeature {
  id?: string | number;
  properties?: { name?: string };
  geometry?: {
    type?: string;
    coordinates?: unknown;
  };
}

interface CountryFeatureCollection {
  features?: CountryFeature[];
}

export interface EventLinkFeatureCollection {
  type: "FeatureCollection";
  features: Array<{
    type: "Feature";
    properties: {
      category: string;
      color: string;
      eventId: string;
      headline: string;
      importanceScore: number;
      from: string;
      to: string;
    };
    geometry: {
      type: "LineString";
      coordinates: MapPosition[];
    };
  }>;
}

function isPosition(value: unknown): value is MapPosition {
  return (
    Array.isArray(value) &&
    value.length >= 2 &&
    typeof value[0] === "number" &&
    typeof value[1] === "number"
  );
}

function outerRings(coordinates: unknown, geometryType: string) {
  if (!Array.isArray(coordinates)) return [] as MapPosition[][];
  if (geometryType === "Polygon") {
    return isPosition(coordinates[0]?.[0])
      ? [coordinates[0] as MapPosition[]]
      : [];
  }
  if (geometryType === "MultiPolygon") {
    return coordinates.flatMap((polygon) =>
      Array.isArray(polygon) && isPosition(polygon[0]?.[0])
        ? [polygon[0] as MapPosition[]]
        : [],
    );
  }
  return [];
}

function unwrapRing(ring: MapPosition[]) {
  if (!ring.length) return ring;
  const unwrapped: MapPosition[] = [[ring[0][0], ring[0][1]]];
  for (const [longitude, latitude] of ring.slice(1)) {
    let adjustedLongitude = longitude;
    const previousLongitude = unwrapped.at(-1)?.[0] ?? longitude;
    while (adjustedLongitude - previousLongitude > 180) adjustedLongitude -= 360;
    while (adjustedLongitude - previousLongitude < -180) adjustedLongitude += 360;
    unwrapped.push([adjustedLongitude, latitude]);
  }
  return unwrapped;
}

function ringAreaAndCenter(ring: MapPosition[]) {
  const points = unwrapRing(ring);
  let twiceArea = 0;
  let longitudeTotal = 0;
  let latitudeTotal = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    const cross = current[0] * next[1] - next[0] * current[1];
    twiceArea += cross;
    longitudeTotal += (current[0] + next[0]) * cross;
    latitudeTotal += (current[1] + next[1]) * cross;
  }
  if (Math.abs(twiceArea) < 0.000001) {
    const longitude =
      points.reduce((total, point) => total + point[0], 0) /
      Math.max(1, points.length);
    const latitude =
      points.reduce((total, point) => total + point[1], 0) /
      Math.max(1, points.length);
    return { area: 0, center: [longitude, latitude] as MapPosition };
  }
  return {
    area: Math.abs(twiceArea / 2),
    center: [
      longitudeTotal / (3 * twiceArea),
      latitudeTotal / (3 * twiceArea),
    ] as MapPosition,
  };
}

function normalizeLongitude(longitude: number) {
  return ((longitude + 540) % 360) - 180;
}

export function countryCentersFromGeoJson(
  collection: unknown,
) {
  const featureCollection = collection as CountryFeatureCollection;
  const centers: Record<string, MapPosition> = {};
  for (const feature of featureCollection.features ?? []) {
    const name = feature.properties?.name?.trim();
    const geometryType = feature.geometry?.type ?? "";
    if (!name) continue;
    const candidates = outerRings(
      feature.geometry?.coordinates,
      geometryType,
    ).map(ringAreaAndCenter);
    const largest = candidates.sort((left, right) => right.area - left.area)[0];
    if (!largest) continue;
    centers[name] = [
      normalizeLongitude(largest.center[0]),
      largest.center[1],
    ];
    if (feature.id != null) {
      centers[String(feature.id)] = centers[name];
    }
  }
  return centers;
}

function curvedLine(
  start: MapPosition,
  end: MapPosition,
  steps = 36,
): MapPosition[] {
  const deltaLongitude = end[0] - start[0];
  const deltaLatitude = end[1] - start[1];
  const distance = Math.hypot(
    deltaLongitude * Math.cos(((start[1] + end[1]) / 2) * (Math.PI / 180)),
    deltaLatitude,
  );
  const bend = Math.min(18, Math.max(2.5, distance * 0.16));
  const length = Math.max(0.001, Math.hypot(deltaLongitude, deltaLatitude));
  const hemisphereDirection = (start[1] + end[1]) / 2 >= 0 ? 1 : -1;
  const control: MapPosition = [
    (start[0] + end[0]) / 2 -
      (deltaLatitude / length) * bend * hemisphereDirection,
    (start[1] + end[1]) / 2 +
      (deltaLongitude / length) * bend * hemisphereDirection,
  ];

  return Array.from({ length: steps + 1 }, (_, index) => {
    const progress = index / steps;
    const inverse = 1 - progress;
    return [
      inverse * inverse * start[0] +
        2 * inverse * progress * control[0] +
        progress * progress * end[0],
      inverse * inverse * start[1] +
        2 * inverse * progress * control[1] +
        progress * progress * end[1],
    ];
  });
}

export function countriesMentionedByEvent(
  event: Event,
  countries: MapCountry[],
  _anchorCountry?: MapCountry,
) {
  void _anchorCountry;
  const searchableText = [
    event.headline,
    ...event.articles.map((article) => article.headline),
  ].join(" ");
  return countries.filter((country) =>
    textMatchesCountry(searchableText, termsForCountry(country.name)),
  );
}

const countryTermsCache = new Map<string, string[]>();

function termsForCountry(countryName: string) {
  const cached = countryTermsCache.get(countryName);
  if (cached) return cached;
  const terms = countrySearchTerms(countryName);
  countryTermsCache.set(countryName, terms);
  return terms;
}

export function buildEventLinkCollection({
  events,
  countries,
  selectedMapId,
  centers,
  maxLinks = 28,
}: {
  events: Event[];
  countries: MapCountry[];
  selectedMapId: string | null;
  centers: Record<string, MapPosition>;
  maxLinks?: number;
}): EventLinkFeatureCollection {
  const selectedCountry = countries.find(
    (country) => country.mapId === selectedMapId,
  );
  const centerForCountry = (country: MapCountry) =>
    centers[country.name] ?? centers[country.mapId];
  const strongestPair = new Map<
    string,
    EventLinkFeatureCollection["features"][number]
  >();

  for (const event of [...events].sort(
    (left, right) => right.importanceScore - left.importanceScore,
  )) {
    const mentioned = countriesMentionedByEvent(event, countries).filter(
      (country) => centerForCountry(country),
    );
    if (mentioned.length < 2) continue;

    const primaryCountry = countries.find(
      (country) =>
        country.iso2 === event.primaryCountry ||
        country.name === event.primaryCountry,
    );
    const selectedIsMentioned = selectedCountry
      ? mentioned.find((country) => country.mapId === selectedCountry.mapId)
      : undefined;
    const primaryIsMentioned = primaryCountry
      ? mentioned.find((country) => country.mapId === primaryCountry.mapId)
      : undefined;
    const origin = selectedIsMentioned ?? primaryIsMentioned ?? mentioned[0];
    const originCenter = centerForCountry(origin);
    if (!originCenter) continue;
    for (const destination of mentioned) {
      if (destination.mapId === origin.mapId) continue;
      const destinationCenter = centerForCountry(destination);
      if (!destinationCenter) continue;
      const pairKey = [origin.name, destination.name].sort().join("|");
      const existing = strongestPair.get(pairKey);
      if (
        existing &&
        existing.properties.importanceScore >= event.importanceScore
      ) {
        continue;
      }
      strongestPair.set(pairKey, {
        type: "Feature",
        properties: {
          category: event.category,
          color: categoryColor(event.category),
          eventId: event.id,
          headline: event.headline,
          importanceScore: event.importanceScore,
          from: origin.name,
          to: destination.name,
        },
        geometry: {
          type: "LineString",
          coordinates: curvedLine(
            originCenter,
            destinationCenter,
          ),
        },
      });
    }
  }

  return {
    type: "FeatureCollection",
    features: [...strongestPair.values()]
      .sort(
        (left, right) =>
          right.properties.importanceScore -
          left.properties.importanceScore,
      )
      .slice(0, maxLinks),
  };
}
