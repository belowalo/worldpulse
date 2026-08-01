export interface WorldFeature {
  type: "Feature";
  id?: string | number;
  properties?: {
    name?: string;
    [key: string]: unknown;
  };
  geometry: {
    type: string;
    coordinates: unknown;
  };
}

export interface WorldFeatureCollection {
  type: "FeatureCollection";
  features: WorldFeature[];
}

export interface CountryHitFeature {
  id?: string;
  name: string;
}

interface HitBounds {
  maxLatitude: number;
  maxLongitude: number;
  minLatitude: number;
  minLongitude: number;
}

interface IndexedPolygon {
  bounds: HitBounds;
  feature: CountryHitFeature;
  rings: number[][][];
}

export interface CountryHitIndex {
  cells: Map<string, IndexedPolygon[]>;
  polygons: IndexedPolygon[];
}

const COORDINATE_EPSILON = 1e-9;
const HIT_CELL_SIZE = 10;

export function polygonsForFeature(feature: WorldFeature): number[][][][] {
  if (feature.geometry.type === "Polygon") {
    return [feature.geometry.coordinates as number[][][]];
  }
  if (feature.geometry.type === "MultiPolygon") {
    return feature.geometry.coordinates as number[][][][];
  }
  return [];
}

function unwrapRing(ring: number[][]) {
  if (!ring.length) return [];

  const output: number[][] = [];
  let previousLongitude = ring[0][0];
  let unwrappedLongitude = previousLongitude;
  for (const [longitude, latitude] of ring) {
    let delta = longitude - previousLongitude;
    if (delta > 180) delta -= 360;
    if (delta < -180) delta += 360;
    unwrappedLongitude += delta;
    output.push([unwrappedLongitude, latitude]);
    previousLongitude = longitude;
  }
  return output;
}

function ringBounds(ring: number[][]): HitBounds | null {
  if (!ring.length) return null;
  let minLongitude = Number.POSITIVE_INFINITY;
  let maxLongitude = Number.NEGATIVE_INFINITY;
  let minLatitude = Number.POSITIVE_INFINITY;
  let maxLatitude = Number.NEGATIVE_INFINITY;
  for (const [longitude, latitude] of ring) {
    minLongitude = Math.min(minLongitude, longitude);
    maxLongitude = Math.max(maxLongitude, longitude);
    minLatitude = Math.min(minLatitude, latitude);
    maxLatitude = Math.max(maxLatitude, latitude);
  }
  return { minLongitude, maxLongitude, minLatitude, maxLatitude };
}

function normalizeLongitude(longitude: number) {
  return ((((longitude + 180) % 360) + 360) % 360) - 180;
}

function cellKey(longitude: number, latitude: number) {
  const longitudeCell = Math.min(
    35,
    Math.max(0, Math.floor((normalizeLongitude(longitude) + 180) / HIT_CELL_SIZE)),
  );
  const latitudeCell = Math.min(
    17,
    Math.max(0, Math.floor((latitude + 90) / HIT_CELL_SIZE)),
  );
  return `${longitudeCell}:${latitudeCell}`;
}

function longitudeRangeIntersects(
  bounds: HitBounds,
  minLongitude: number,
  maxLongitude: number,
) {
  return [minLongitude, minLongitude - 360, minLongitude + 360].some(
    (candidateMin) =>
      candidateMin <= bounds.maxLongitude + COORDINATE_EPSILON &&
      candidateMin + (maxLongitude - minLongitude) >=
        bounds.minLongitude - COORDINATE_EPSILON,
  );
}

function buildHitCells(polygons: IndexedPolygon[]) {
  const cells = new Map<string, IndexedPolygon[]>();
  for (const polygon of polygons) {
    const minLatitudeCell = Math.min(
      17,
      Math.max(0, Math.floor((polygon.bounds.minLatitude + 90) / HIT_CELL_SIZE)),
    );
    const maxLatitudeCell = Math.min(
      17,
      Math.max(0, Math.floor((polygon.bounds.maxLatitude + 90) / HIT_CELL_SIZE)),
    );
    for (
      let latitudeCell = minLatitudeCell;
      latitudeCell <= maxLatitudeCell;
      latitudeCell += 1
    ) {
      for (let longitudeCell = 0; longitudeCell < 36; longitudeCell += 1) {
        const minLongitude = longitudeCell * HIT_CELL_SIZE - 180;
        if (
          !longitudeRangeIntersects(
            polygon.bounds,
            minLongitude,
            minLongitude + HIT_CELL_SIZE,
          )
        ) {
          continue;
        }
        const key = `${longitudeCell}:${latitudeCell}`;
        cells.set(key, [...(cells.get(key) ?? []), polygon]);
      }
    }
  }
  return cells;
}

function pointOnSegment(
  longitude: number,
  latitude: number,
  start: number[],
  end: number[],
) {
  const squaredLength =
    (end[0] - start[0]) ** 2 + (end[1] - start[1]) ** 2;
  if (squaredLength <= COORDINATE_EPSILON ** 2) {
    return (
      (longitude - start[0]) ** 2 + (latitude - start[1]) ** 2 <=
      COORDINATE_EPSILON ** 2
    );
  }
  const cross =
    (longitude - start[0]) * (end[1] - start[1]) -
    (latitude - start[1]) * (end[0] - start[0]);
  if (Math.abs(cross) > COORDINATE_EPSILON) return false;

  const dot =
    (longitude - start[0]) * (end[0] - start[0]) +
    (latitude - start[1]) * (end[1] - start[1]);
  if (dot < -COORDINATE_EPSILON) return false;
  return dot <= squaredLength + COORDINATE_EPSILON;
}

type RingLocation = "boundary" | "inside" | "outside";

function locateInRing(
  longitude: number,
  latitude: number,
  ring: number[][],
): RingLocation {
  let inside = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index++) {
    const start = ring[previous];
    const end = ring[index];
    if (pointOnSegment(longitude, latitude, start, end)) return "boundary";
    if (
      (end[1] > latitude) !== (start[1] > latitude) &&
      longitude <
        ((start[0] - end[0]) * (latitude - end[1])) /
          (start[1] - end[1]) +
          end[0]
    ) {
      inside = !inside;
    }
  }
  return inside ? "inside" : "outside";
}

function polygonContains(
  polygon: IndexedPolygon,
  longitude: number,
  latitude: number,
) {
  const { bounds, rings } = polygon;
  if (
    longitude < bounds.minLongitude - COORDINATE_EPSILON ||
    longitude > bounds.maxLongitude + COORDINATE_EPSILON ||
    latitude < bounds.minLatitude - COORDINATE_EPSILON ||
    latitude > bounds.maxLatitude + COORDINATE_EPSILON
  ) {
    return false;
  }

  const outerLocation = locateInRing(longitude, latitude, rings[0]);
  if (outerLocation === "outside") return false;
  if (outerLocation === "boundary") return true;
  for (const hole of rings.slice(1)) {
    const holeLocation = locateInRing(longitude, latitude, hole);
    if (holeLocation === "boundary") return true;
    if (holeLocation === "inside") return false;
  }
  return true;
}

export function buildCountryHitIndex(
  collection: WorldFeatureCollection,
): CountryHitIndex {
  const polygons: IndexedPolygon[] = [];
  for (const worldFeature of collection.features) {
    const name = worldFeature.properties?.name?.trim();
    if (!name) continue;
    const feature: CountryHitFeature = {
      id: worldFeature.id == null ? undefined : String(worldFeature.id),
      name,
    };
    for (const polygon of polygonsForFeature(worldFeature)) {
      const unwrappedRings = polygon
        .map(unwrapRing)
        .filter((ring) => ring.length >= 3);
      const outerRing = unwrappedRings[0];
      if (!outerRing) continue;
      const outerBounds = ringBounds(outerRing);
      if (!outerBounds) continue;
      const outerCenter =
        (outerBounds.minLongitude + outerBounds.maxLongitude) / 2;
      const rings = unwrappedRings.map((ring, ringIndex) => {
        if (ringIndex === 0) return ring;
        const bounds = ringBounds(ring);
        if (!bounds) return ring;
        const center = (bounds.minLongitude + bounds.maxLongitude) / 2;
        const shift = Math.round((outerCenter - center) / 360) * 360;
        return shift
          ? ring.map(([longitude, latitude]) => [longitude + shift, latitude])
          : ring;
      });
      const bounds = rings[0] ? ringBounds(rings[0]) : null;
      if (bounds) polygons.push({ bounds, feature, rings });
    }
  }
  return { cells: buildHitCells(polygons), polygons };
}

export function countryFeatureAtCoordinates(
  index: CountryHitIndex,
  longitude: number,
  latitude: number,
): CountryHitFeature | undefined {
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return undefined;
  if (latitude < -90 || latitude > 90) return undefined;

  const normalizedLongitude = normalizeLongitude(longitude);
  const candidates = index.cells.get(cellKey(normalizedLongitude, latitude)) ?? [];
  for (const polygon of candidates) {
    for (const candidateLongitude of [
      normalizedLongitude,
      normalizedLongitude - 360,
      normalizedLongitude + 360,
    ]) {
      if (polygonContains(polygon, candidateLongitude, latitude)) {
        return polygon.feature;
      }
    }
  }
  return undefined;
}
