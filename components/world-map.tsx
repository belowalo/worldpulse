"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type {
  CustomDataSource,
  Entity,
  GeoJsonDataSource,
  Viewer,
} from "cesium";
import {
  type WorldFeature,
  type WorldFeatureCollection,
} from "@/lib/country-hit-test";
import {
  loadCesiumRuntime,
  type CesiumRuntime,
} from "@/lib/cesium-runtime";
import {
  buildEventLinkCollection,
  countryCentersFromGeoJson,
  type MapPosition,
} from "@/lib/map-links";
import { mapStyleForEvent } from "@/lib/scoring";
import type { Event, MapCountry } from "@/lib/types";

export interface WorldMapProps {
  countries: MapCountry[];
  selectedMapId: string | null;
  onSelect: (country: MapCountry) => void;
  onSelectCapital?: (selection: CapitalMarkerSelection) => void;
  onReady?: () => void;
  onError?: (message: string) => void;
  readyForDisplay?: boolean;
  statusLabel?: string;
  linkEvents?: Event[];
}

export interface CapitalMarkerSelection {
  capital: string;
  country: MapCountry;
}

export type {
  WorldFeature,
  WorldFeatureCollection,
} from "@/lib/country-hit-test";

interface GlobeArc {
  color: string;
  endLat: number;
  endLng: number;
  importanceScore: number;
  startLat: number;
  startLng: number;
}

export interface GlobePoint {
  capital: string;
  color: string;
  country: MapCountry;
  lat: number;
  lng: number;
}

interface CapitalCoordinate {
  iso2: string | null;
  iso3: string | null;
  capital: string;
  lat: number;
  lng: number;
}

interface CountryEntityRecord {
  entity: Entity;
  featureId: string | null;
  featureName: string;
}

interface CesiumGlobeScene {
  arcs: CustomDataSource;
  countries: GeoJsonDataSource;
  countryEntities: CountryEntityRecord[];
  countryEntityIndex: Map<string, CountryEntityRecord>;
  markers: CustomDataSource;
  markerCapitals: Map<string, CapitalMarkerSelection>;
  markerCountries: Map<string, MapCountry>;
  runtime: CesiumRuntime;
  viewer: Viewer;
}

interface HoveredCountry {
  country: MapCountry;
  x: number;
  y: number;
}

export const GLOBE_PERFORMANCE_PROFILE = {
  arcLimit: 12,
  demandRendering: true,
  imageryMaxLevel: 12,
  maximumScreenSpaceError: 4,
  msaaSamples: 1,
  resolutionScale: 0.85,
  targetFrameRate: 30,
  terrainCacheLimit: 96,
  terrainDecodeConcurrency: 4,
  terrainMaxLevel: 13,
  terrainTileSamples: 33,
  tileCacheSize: 96,
} as const;
const ARC_LIMIT = GLOBE_PERFORMANCE_PROFILE.arcLimit;
const TERRAIN_TILE_SAMPLES =
  GLOBE_PERFORMANCE_PROFILE.terrainTileSamples;
const TERRAIN_MAX_LEVEL = GLOBE_PERFORMANCE_PROFILE.terrainMaxLevel;
const TERRAIN_CACHE_LIMIT = GLOBE_PERFORMANCE_PROFILE.terrainCacheLimit;
const TERRAIN_DECODE_CONCURRENCY =
  GLOBE_PERFORMANCE_PROFILE.terrainDecodeConcurrency;
const CAPITAL_MARKER_HEIGHT_METERS = 8_000;
const INITIAL_LONGITUDE = 17;
const INITIAL_LATITUDE = 12;
const INITIAL_HEIGHT_METERS = 18_500_000;
const SATELLITE_TILE_URL =
  "https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless_3857/default/g/{z}/{y}/{x}.jpg";
export const SATELLITE_IMAGERY_BRIGHTNESS = 0.66;
const SMALL_ISLAND_HIT_OFFSETS = [
  [0, -3],
  [3, 0],
  [0, 3],
  [-3, 0],
  [-3, -3],
  [3, -3],
  [3, 3],
  [-3, 3],
  [0, -6],
  [6, 0],
  [0, 6],
  [-6, 0],
] as const;

let geometryPromise: Promise<WorldFeatureCollection> | null = null;
let geometryFetchIdentity: typeof fetch | null = null;
let capitalsPromise: Promise<CapitalCoordinate[]> | null = null;
const terrainTileCache = new Map<string, Promise<Float32Array>>();
const terrainDecodeQueue: Array<() => void> = [];
let activeTerrainDecodes = 0;

function scheduleTerrainDecode(task: () => Promise<Float32Array>) {
  return new Promise<Float32Array>((resolve) => {
    const run = () => {
      activeTerrainDecodes += 1;
      void task()
        .then(resolve)
        .catch(() => resolve(flatTerrainTile()))
        .finally(() => {
          activeTerrainDecodes -= 1;
          terrainDecodeQueue.shift()?.();
        });
    };
    if (activeTerrainDecodes < TERRAIN_DECODE_CONCURRENCY) run();
    else terrainDecodeQueue.push(run);
  });
}

export function loadWorldGeometry({
  fresh = false,
}: { fresh?: boolean } = {}): Promise<WorldFeatureCollection> {
  if (geometryFetchIdentity !== fetch) {
    geometryPromise = null;
    geometryFetchIdentity = fetch;
  }
  if (!geometryPromise || fresh) {
    geometryPromise = fetch("/countries.geojson", {
      signal: AbortSignal.timeout(20_000),
    })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error("Country geometry is temporarily unavailable.");
        }
        return (await response.json()) as WorldFeatureCollection;
      })
      .then((collection) => {
        if (!Array.isArray(collection.features) || !collection.features.length) {
          throw new Error("Country geometry is incomplete.");
        }
        return { ...collection, type: "FeatureCollection" as const };
      })
      .catch((error) => {
        geometryPromise = null;
        throw error;
      });
  }
  return geometryPromise;
}

function loadCapitalCoordinates() {
  if (!capitalsPromise) {
    capitalsPromise = fetch("/world-capitals.json", {
      signal: AbortSignal.timeout(20_000),
    })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error("Capital coordinates are temporarily unavailable.");
        }
        return (await response.json()) as CapitalCoordinate[];
      })
      .then((capitals) =>
        capitals.filter(
          (capital) =>
            Number.isFinite(capital.lat) &&
            Number.isFinite(capital.lng) &&
            capital.capital !== "N/A" &&
            !(capital.lat === 0 && capital.lng === 0),
        ),
      )
      .catch((error) => {
        capitalsPromise = null;
        console.warn(
          "Capital coordinates were unavailable; using country centers.",
          error,
        );
        return [];
      });
  }
  return capitalsPromise;
}

export async function preloadWorldGlobe() {
  await Promise.all([
    loadWorldGeometry(),
    loadCesiumRuntime(),
    loadCapitalCoordinates(),
  ]);
}

function featureName(feature: WorldFeature) {
  return feature.properties?.name?.trim() ?? "";
}

function countryForFeature(
  featureId: string | null,
  name: string,
  byId: Map<string, MapCountry>,
  byName: Map<string, MapCountry>,
) {
  return (featureId ? byId.get(featureId) : undefined) ?? byName.get(name);
}

function countryColor(country?: MapCountry) {
  if (!country) return "#33495a";
  if (!country.topEvent) {
    return country.signalReady === false ? "#5b6b78" : "#42657a";
  }
  return mapStyleForEvent(
    country.topEvent.category,
    country.topEvent.importanceScore,
  ).fillColor;
}

function flatTerrainTile() {
  return new Float32Array(TERRAIN_TILE_SAMPLES * TERRAIN_TILE_SAMPLES);
}

async function decodeTerrainTile(response: Response) {
  const blob = await response.blob();
  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return flatTerrainTile();
    context.drawImage(bitmap, 0, 0);
    const pixels = context.getImageData(0, 0, bitmap.width, bitmap.height).data;
    const elevations = new Float32Array(
      TERRAIN_TILE_SAMPLES * TERRAIN_TILE_SAMPLES,
    );
    for (let row = 0; row < TERRAIN_TILE_SAMPLES; row += 1) {
      const sourceY = Math.round(
        (row / (TERRAIN_TILE_SAMPLES - 1)) * (bitmap.height - 1),
      );
      for (let column = 0; column < TERRAIN_TILE_SAMPLES; column += 1) {
        const sourceX = Math.round(
          (column / (TERRAIN_TILE_SAMPLES - 1)) * (bitmap.width - 1),
        );
        const pixel = (sourceY * bitmap.width + sourceX) * 4;
        const elevation =
          pixels[pixel] * 256 +
          pixels[pixel + 1] +
          pixels[pixel + 2] / 256 -
          32_768;
        elevations[row * TERRAIN_TILE_SAMPLES + column] = Math.max(
          0,
          elevation,
        );
      }
    }
    return elevations;
  } finally {
    bitmap.close();
  }
}

function requestTerrainTile(x: number, y: number, level: number) {
  if (level > TERRAIN_MAX_LEVEL) return undefined;
  const cacheKey = `${level}/${x}/${y}`;
  const cached = terrainTileCache.get(cacheKey);
  if (cached) return cached;

  const tile = scheduleTerrainDecode(() =>
    fetch(`/api/terrain/${level}/${x}/${y}`, {
      signal: AbortSignal.timeout(12_000),
    }).then((response) =>
      response.ok ? decodeTerrainTile(response) : flatTerrainTile(),
    ),
  );
  terrainTileCache.set(cacheKey, tile);
  if (terrainTileCache.size > TERRAIN_CACHE_LIMIT) {
    const oldestKey = terrainTileCache.keys().next().value;
    if (oldestKey) terrainTileCache.delete(oldestKey);
  }
  return tile;
}

function createTerrainProvider(runtime: CesiumRuntime) {
  return new runtime.CustomHeightmapTerrainProvider({
    width: TERRAIN_TILE_SAMPLES,
    height: TERRAIN_TILE_SAMPLES,
    tilingScheme: new runtime.WebMercatorTilingScheme(),
    callback: requestTerrainTile,
    credit: new runtime.Credit(
      '<a href="https://registry.opendata.aws/terrain-tiles/" target="_blank" rel="noreferrer">Mapzen terrain via AWS Open Data</a>',
    ),
  });
}

function createSatelliteProvider(runtime: CesiumRuntime) {
  return new runtime.UrlTemplateImageryProvider({
    url: SATELLITE_TILE_URL,
    tilingScheme: new runtime.WebMercatorTilingScheme(),
    minimumLevel: 0,
    maximumLevel: GLOBE_PERFORMANCE_PROFILE.imageryMaxLevel,
    tileWidth: 256,
    tileHeight: 256,
    hasAlphaChannel: false,
    credit: new runtime.Credit(
      '<a href="https://cloudless.eox.at/" target="_blank" rel="noreferrer">Sentinel-2 cloudless by EOX (modified Copernicus Sentinel data 2016)</a>',
    ),
  });
}

export function prepareCountryGeoJson(geometry: WorldFeatureCollection) {
  return {
    type: "FeatureCollection" as const,
    features: geometry.features.map((feature, index) => ({
      ...feature,
      id: `worldpulse-country-${index}`,
      properties: {
        ...feature.properties,
        worldPulseFeatureId:
          feature.id == null ? null : String(feature.id),
        worldPulseFeatureName: featureName(feature),
      },
    })),
  };
}

export async function createCountryDataSource(
  runtime: CesiumRuntime,
  geometry: WorldFeatureCollection,
) {
  const prepared = prepareCountryGeoJson(geometry);
  const dataSource = await runtime.GeoJsonDataSource.load(prepared, {
    clampToGround: true,
    fill: runtime.Color.WHITE.withAlpha(0.24),
  });
  const propertyTime = runtime.JulianDate.now();
  const countryEntities = dataSource.entities.values.flatMap((entity) => {
    if (!entity.polygon) return [];
    const properties = entity.properties?.getValue(propertyTime) as
      | Record<string, unknown>
      | undefined;
    const featureId = properties?.worldPulseFeatureId;
    const featureName = properties?.worldPulseFeatureName;
    return [
      {
        entity,
        featureId: featureId == null ? null : String(featureId),
        featureName: featureName == null ? "" : String(featureName),
      },
    ];
  });
  return { countryEntities, dataSource };
}

function updateCountryEntities(
  scene: CesiumGlobeScene,
  countryIndex: {
    byId: Map<string, MapCountry>;
    byName: Map<string, MapCountry>;
  },
  selectedMapId: string | null,
) {
  for (const record of scene.countryEntities) {
    const country = countryForFeature(
      record.featureId,
      record.featureName,
      countryIndex.byId,
      countryIndex.byName,
    );
    const selected = country?.mapId === selectedMapId;
    const alpha = selected ? 0.68 : country?.topEvent ? 0.46 : 0.28;
    const fill = scene.runtime.Color.fromCssColorString(
      countryColor(country),
    ).withAlpha(alpha);
    if (record.entity.polygon) {
      record.entity.polygon.material =
        new scene.runtime.ColorMaterialProperty(fill);
    }
  }
  scene.viewer.scene.requestRender();
}

export function updatePoints(scene: CesiumGlobeScene, points: GlobePoint[]) {
  scene.markers.entities.removeAll();
  scene.markerCapitals.clear();
  scene.markerCountries.clear();
  points.forEach((point, index) => {
    const id = `worldpulse-marker-${point.country.mapId}-${index}`;
    scene.markerCapitals.set(id, {
      capital: point.capital,
      country: point.country,
    });
    scene.markerCountries.set(id, point.country);
    scene.markers.entities.add({
      id,
      name: point.capital,
      position: scene.runtime.Cartesian3.fromDegrees(
        point.lng,
        point.lat,
        CAPITAL_MARKER_HEIGHT_METERS,
      ),
      label: {
        disableDepthTestDistance: 0,
        fillColor: scene.runtime.Color.fromCssColorString(point.color),
        font: point.country.topEvent
          ? "700 22px Arial, sans-serif"
          : "700 18px Arial, sans-serif",
        heightReference: scene.runtime.HeightReference.NONE,
        horizontalOrigin: scene.runtime.HorizontalOrigin.CENTER,
        outlineColor: scene.runtime.Color.WHITE.withAlpha(0.92),
        outlineWidth: 2,
        scaleByDistance: new scene.runtime.NearFarScalar(
          50_000,
          1,
          35_000_000,
          0.22,
        ),
        style: scene.runtime.LabelStyle.FILL_AND_OUTLINE,
        text: "★",
        verticalOrigin: scene.runtime.VerticalOrigin.CENTER,
      },
    });
  });
  scene.viewer.scene.requestRender();
}

function positionsForArc(runtime: CesiumRuntime, arc: GlobeArc) {
  const geodesic = new runtime.EllipsoidGeodesic(
    runtime.Cartographic.fromDegrees(arc.startLng, arc.startLat),
    runtime.Cartographic.fromDegrees(arc.endLng, arc.endLat),
  );
  const peakHeight = Math.max(
    120_000,
    Math.min(850_000, arc.importanceScore * 8_000),
  );
  return Array.from({ length: 49 }, (_, index) => {
    const progress = index / 48;
    const position = geodesic.interpolateUsingFraction(progress);
    return runtime.Cartesian3.fromRadians(
      position.longitude,
      position.latitude,
      Math.sin(Math.PI * progress) * peakHeight,
    );
  });
}

function updateArcs(scene: CesiumGlobeScene, arcs: GlobeArc[]) {
  scene.arcs.entities.removeAll();
  for (const [index, arc] of arcs.slice(0, ARC_LIMIT).entries()) {
    const color = scene.runtime.Color.fromCssColorString(arc.color);
    scene.arcs.entities.add({
      id: `worldpulse-arc-${index}`,
      polyline: {
        arcType: scene.runtime.ArcType.NONE,
        material: new scene.runtime.PolylineGlowMaterialProperty({
          color: color.withAlpha(0.82),
          glowPower: 0.17,
          taperPower: 0.7,
        }),
        positions: positionsForArc(scene.runtime, arc),
        width: 2,
      },
    });
  }
  scene.viewer.scene.requestRender();
}

function countryFromEntity(
  scene: CesiumGlobeScene,
  entity: Entity,
  countryIndex: {
    byId: Map<string, MapCountry>;
    byName: Map<string, MapCountry>;
  },
) {
  const markerCountry = scene.markerCountries.get(entity.id);
  if (markerCountry) return markerCountry;
  const record = scene.countryEntityIndex.get(entity.id);
  return record
    ? countryForFeature(
        record.featureId,
        record.featureName,
        countryIndex.byId,
        countryIndex.byName,
      )
    : undefined;
}

export function WorldMap({
  countries,
  selectedMapId,
  onSelect,
  onSelectCapital,
  onReady,
  readyForDisplay = true,
  statusLabel = "Live",
  linkEvents = [],
}: WorldMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const globeSceneRef = useRef<CesiumGlobeScene | null>(null);
  const onSelectRef = useRef(onSelect);
  const onSelectCapitalRef = useRef(onSelectCapital);
  const onReadyRef = useRef(onReady);
  const readyNotifiedRef = useRef(false);
  const hoverFrameRef = useRef<number | null>(null);
  const pointerStartRef = useRef({ x: 0, y: 0 });
  const [hovered, setHovered] = useState<HoveredCountry | null>(null);
  const [mapError, setMapError] = useState<string | null>(null);
  const [worldGeometry, setWorldGeometry] =
    useState<WorldFeatureCollection | null>(null);
  const [globeSceneReady, setGlobeSceneReady] = useState(false);
  const [viewAnnouncement, setViewAnnouncement] = useState("");
  const [capitalCoordinates, setCapitalCoordinates] = useState<
    CapitalCoordinate[]
  >([]);

  const countryIndex = useMemo(() => {
    const byId = new Map<string, MapCountry>();
    const byName = new Map<string, MapCountry>();
    for (const country of countries) {
      byId.set(country.mapId, country);
      byName.set(country.name, country);
    }
    return { byId, byName };
  }, [countries]);

  const countryCenters = useMemo(
    () =>
      worldGeometry
        ? countryCentersFromGeoJson(worldGeometry)
        : ({} as Record<string, MapPosition>),
    [worldGeometry],
  );
  const capitalIndex = useMemo(() => {
    const byIso2 = new Map<string, CapitalCoordinate[]>();
    const byIso3 = new Map<string, CapitalCoordinate[]>();
    for (const capital of capitalCoordinates) {
      if (capital.iso2) {
        byIso2.set(capital.iso2, [
          ...(byIso2.get(capital.iso2) ?? []),
          capital,
        ]);
      }
      if (capital.iso3) {
        byIso3.set(capital.iso3, [
          ...(byIso3.get(capital.iso3) ?? []),
          capital,
        ]);
      }
    }
    return { byIso2, byIso3 };
  }, [capitalCoordinates]);
  const connectionCenters = useMemo(() => {
    const centers = { ...countryCenters };
    for (const country of countries) {
      const capital =
        (country.iso2
          ? capitalIndex.byIso2.get(country.iso2)?.[0]
          : undefined) ??
        (country.iso3
          ? capitalIndex.byIso3.get(country.iso3)?.[0]
          : undefined);
      if (!capital) continue;
      const position: MapPosition = [capital.lng, capital.lat];
      centers[country.name] = position;
      centers[country.mapId] = position;
    }
    return centers;
  }, [capitalIndex, countries, countryCenters]);

  const eventArcs = useMemo<GlobeArc[]>(() => {
    if (!Object.keys(connectionCenters).length) return [];
    return buildEventLinkCollection({
      events: linkEvents,
      countries,
      selectedMapId,
      centers: connectionCenters,
      maxLinks: ARC_LIMIT,
    }).features.flatMap((feature) => {
      const start = feature.geometry.coordinates[0];
      const end = feature.geometry.coordinates.at(-1);
      if (!start || !end) return [];
      return [
        {
          color: feature.properties.color,
          endLat: end[1],
          endLng: end[0],
          importanceScore: feature.properties.importanceScore,
          startLat: start[1],
          startLng: start[0],
        },
      ];
    });
  }, [connectionCenters, countries, linkEvents, selectedMapId]);

  const signalPoints = useMemo<GlobePoint[]>(
    () =>
      [...countries]
        .sort(
          (left, right) =>
            (right.topEvent?.importanceScore ?? 0) -
              (left.topEvent?.importanceScore ?? 0) ||
            left.name.localeCompare(right.name),
        )
        .flatMap((country) => {
          const capitals =
            (country.iso2
              ? capitalIndex.byIso2.get(country.iso2)
              : undefined) ??
            (country.iso3
              ? capitalIndex.byIso3.get(country.iso3)
              : undefined) ??
            [];
          const fallback =
            countryCenters[country.name] ?? countryCenters[country.mapId];
          const locations = capitals.length
            ? capitals
            : fallback
              ? [
                  {
                    capital: country.name,
                    iso2: country.iso2 ?? null,
                    iso3: country.iso3 ?? null,
                    lat: fallback[1],
                    lng: fallback[0],
                  },
                ]
              : [];
          const seen = new Set<string>();
          return locations.flatMap((capital) => {
            const key = `${capital.lat}:${capital.lng}`;
            if (seen.has(key)) return [];
            seen.add(key);
            return [
              {
                capital: capital.capital,
                color: country.topEvent
                  ? mapStyleForEvent(
                      country.topEvent.category,
                      country.topEvent.importanceScore,
                    ).fillColor
                  : "#8aa3b2",
                country,
                lat: capital.lat,
                lng: capital.lng,
              },
            ];
          });
        }),
    [capitalIndex, countries, countryCenters],
  );

  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  useEffect(() => {
    onSelectCapitalRef.current = onSelectCapital;
  }, [onSelectCapital]);

  useEffect(() => {
    onReadyRef.current = onReady;
  }, [onReady]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || globeSceneRef.current) return;
    let cancelled = false;
    let createdViewer: Viewer | null = null;
    let visibilityWaitListener: (() => void) | null = null;
    let viewerVisibilityListener: (() => void) | null = null;
    let contextLostListener: EventListener | null = null;
    let contextRestoredListener: EventListener | null = null;
    let removeRenderErrorListener: (() => void) | null = null;

    const detachViewerListeners = () => {
      if (viewerVisibilityListener) {
        document.removeEventListener(
          "visibilitychange",
          viewerVisibilityListener,
        );
        viewerVisibilityListener = null;
      }
      if (createdViewer && !createdViewer.isDestroyed()) {
        if (contextLostListener) {
          createdViewer.canvas.removeEventListener(
            "webglcontextlost",
            contextLostListener,
          );
        }
        if (contextRestoredListener) {
          createdViewer.canvas.removeEventListener(
            "webglcontextrestored",
            contextRestoredListener,
          );
        }
      }
      contextLostListener = null;
      contextRestoredListener = null;
      removeRenderErrorListener?.();
      removeRenderErrorListener = null;
    };

    const reportGlobeFailure = (error: unknown) => {
      console.error("Cesium globe initialization failed.", error);
      detachViewerListeners();
      if (createdViewer && !createdViewer.isDestroyed()) {
        createdViewer.destroy();
      }
      createdViewer = null;
      if (!cancelled) {
        setMapError("The interactive globe could not start on this device.");
        readyNotifiedRef.current = true;
        onReadyRef.current?.();
      }
    };

    const waitUntilVisible = () =>
      new Promise<void>((resolve) => {
        if (!document.hidden) {
          resolve();
          return;
        }
        visibilityWaitListener = () => {
          if (document.hidden) return;
          if (visibilityWaitListener) {
            document.removeEventListener(
              "visibilitychange",
              visibilityWaitListener,
            );
            visibilityWaitListener = null;
          }
          resolve();
        };
        document.addEventListener(
          "visibilitychange",
          visibilityWaitListener,
        );
      });

    const initializeGlobe = async () => {
      await waitUntilVisible();
      if (cancelled) return;
      const [geometry, runtime, capitals] = await Promise.all([
        loadWorldGeometry(),
        loadCesiumRuntime(),
        loadCapitalCoordinates(),
      ]);
      await waitUntilVisible();
      if (cancelled || !containerRef.current) return;
      try {
        if (cancelled || !containerRef.current) return;
        const terrainProvider = createTerrainProvider(runtime);
        const viewer = new runtime.Viewer(containerRef.current, {
          animation: false,
          automaticallyTrackDataSourceClocks: false,
          baseLayer: false,
          baseLayerPicker: false,
          contextOptions: {
            allowTextureFilterAnisotropic: false,
            webgl: {
              alpha: false,
              antialias: false,
              preserveDrawingBuffer: false,
            },
          },
          fullscreenButton: false,
          geocoder: false,
          homeButton: false,
          infoBox: false,
          maximumRenderTimeChange: Number.POSITIVE_INFINITY,
          msaaSamples: GLOBE_PERFORMANCE_PROFILE.msaaSamples,
          navigationHelpButton: false,
          orderIndependentTranslucency: false,
          requestRenderMode: GLOBE_PERFORMANCE_PROFILE.demandRendering,
          scene3DOnly: true,
          sceneModePicker: false,
          selectionIndicator: false,
          shouldAnimate: false,
          showRenderLoopErrors: false,
          skyAtmosphere: false,
          skyBox: false,
          targetFrameRate: GLOBE_PERFORMANCE_PROFILE.targetFrameRate,
          terrainProvider,
          timeline: false,
          useBrowserRecommendedResolution: true,
        });
        createdViewer = viewer;
        viewer.resolutionScale = GLOBE_PERFORMANCE_PROFILE.resolutionScale;
        const syncViewerVisibility = () => {
          if (viewer.isDestroyed()) return;
          viewer.useDefaultRenderLoop = !document.hidden;
          if (!document.hidden) viewer.scene.requestRender();
        };
        viewerVisibilityListener = syncViewerVisibility;
        document.addEventListener(
          "visibilitychange",
          viewerVisibilityListener,
        );
        syncViewerVisibility();

        contextLostListener = (event) => {
          event.preventDefault();
          console.error("Cesium WebGL context was lost.");
          setMapError("The interactive globe paused to protect this device.");
          if (!readyNotifiedRef.current) {
            readyNotifiedRef.current = true;
            onReadyRef.current?.();
          }
        };
        contextRestoredListener = () => {
          setMapError(null);
          syncViewerVisibility();
        };
        viewer.canvas.addEventListener(
          "webglcontextlost",
          contextLostListener,
        );
        viewer.canvas.addEventListener(
          "webglcontextrestored",
          contextRestoredListener,
        );
        removeRenderErrorListener = viewer.scene.renderError.addEventListener(
          (_scene, error) => {
            console.error("Cesium render loop failed.", error);
            viewer.useDefaultRenderLoop = false;
            setMapError("The interactive globe could not render on this device.");
            if (!readyNotifiedRef.current) {
              readyNotifiedRef.current = true;
              onReadyRef.current?.();
            }
          },
        );
        if (cancelled) {
          viewer.destroy();
          return;
        }

        const satelliteLayer = viewer.imageryLayers.addImageryProvider(
          createSatelliteProvider(runtime),
        );
        satelliteLayer.brightness = SATELLITE_IMAGERY_BRIGHTNESS;
        satelliteLayer.contrast = 1.08;
        satelliteLayer.saturation = 0.88;
        const { countryEntities, dataSource: countryDataSource } =
          await createCountryDataSource(runtime, geometry);
        if (cancelled) {
          viewer.destroy();
          return;
        }
        const markers = new runtime.CustomDataSource("Hemisphere Herald markers");
        const arcs = new runtime.CustomDataSource("Hemisphere Herald connections");
        await Promise.all([
          viewer.dataSources.add(countryDataSource),
          viewer.dataSources.add(markers),
          viewer.dataSources.add(arcs),
        ]);

        viewer.scene.backgroundColor = runtime.Color.fromCssColorString("#050a11");
        viewer.scene.globe.baseColor = runtime.Color.fromCssColorString("#071522");
        viewer.scene.globe.depthTestAgainstTerrain = false;
        viewer.scene.globe.enableLighting = false;
        viewer.scene.globe.loadingDescendantLimit = 10;
        viewer.scene.globe.maximumScreenSpaceError =
          GLOBE_PERFORMANCE_PROFILE.maximumScreenSpaceError;
        viewer.scene.globe.preloadAncestors = true;
        viewer.scene.globe.preloadSiblings = false;
        viewer.scene.globe.showGroundAtmosphere = false;
        viewer.scene.globe.showWaterEffect = false;
        viewer.scene.globe.tileCacheSize =
          GLOBE_PERFORMANCE_PROFILE.tileCacheSize;
        viewer.scene.verticalExaggeration = 1.65;
        viewer.scene.postProcessStages.fxaa.enabled = false;
        if (viewer.scene.skyBox) viewer.scene.skyBox.show = false;
        if (viewer.scene.sun) viewer.scene.sun.show = false;
        if (viewer.scene.moon) viewer.scene.moon.show = false;
        viewer.scene.fog.enabled = true;
        viewer.scene.screenSpaceCameraController.minimumZoomDistance = 30;
        viewer.scene.screenSpaceCameraController.maximumZoomDistance =
          55_000_000;
        viewer.camera.setView({
          destination: runtime.Cartesian3.fromDegrees(
            INITIAL_LONGITUDE,
            INITIAL_LATITUDE,
            INITIAL_HEIGHT_METERS,
          ),
          orientation: {
            heading: 0,
            pitch: runtime.Math.toRadians(-90),
            roll: 0,
          },
        });

        globeSceneRef.current = {
          arcs,
          countries: countryDataSource,
          countryEntities,
          countryEntityIndex: new Map(
            countryEntities.map((record) => [record.entity.id, record]),
          ),
          markers,
          markerCapitals: new Map(),
          markerCountries: new Map(),
          runtime,
          viewer,
        };
        setWorldGeometry(geometry);
        setCapitalCoordinates(capitals);
        setGlobeSceneReady(true);
        setMapError(null);
        viewer.scene.requestRender();
      } catch (error) {
        reportGlobeFailure(error);
      }
    };

    void initializeGlobe().catch(reportGlobeFailure);

    return () => {
      cancelled = true;
      if (visibilityWaitListener) {
        document.removeEventListener(
          "visibilitychange",
          visibilityWaitListener,
        );
      }
      detachViewerListeners();
      if (hoverFrameRef.current != null) {
        window.cancelAnimationFrame(hoverFrameRef.current);
      }
      const globeScene = globeSceneRef.current;
      if (globeScene && !globeScene.viewer.isDestroyed()) {
        globeScene.viewer.destroy();
      } else if (createdViewer && !createdViewer.isDestroyed()) {
        createdViewer.destroy();
      }
      globeSceneRef.current = null;
      container.replaceChildren();
    };
  }, []);

  useEffect(() => {
    const scene = globeSceneRef.current;
    if (!scene || !readyForDisplay || !globeSceneReady) return;
    const timeout = window.setTimeout(() => {
      updateCountryEntities(scene, countryIndex, selectedMapId);
      if (!readyNotifiedRef.current) {
        readyNotifiedRef.current = true;
        onReadyRef.current?.();
      }
    }, 120);
    return () => window.clearTimeout(timeout);
  }, [countryIndex, globeSceneReady, readyForDisplay, selectedMapId]);

  useEffect(() => {
    const scene = globeSceneRef.current;
    if (scene) updatePoints(scene, signalPoints);
  }, [signalPoints, worldGeometry]);

  useEffect(() => {
    const scene = globeSceneRef.current;
    if (scene) updateArcs(scene, eventArcs);
  }, [eventArcs, worldGeometry]);

  const locateCountryExactly = (clientX: number, clientY: number) => {
    const scene = globeSceneRef.current;
    if (!scene) return undefined;
    const bounds = scene.viewer.canvas.getBoundingClientRect();
    const position = new scene.runtime.Cartesian2(
      clientX - bounds.left,
      clientY - bounds.top,
    );
    const picked = scene.viewer.scene.pick(position);
    const entity = picked?.id instanceof scene.runtime.Entity ? picked.id : null;
    return entity
      ? countryFromEntity(scene, entity, countryIndex)
      : undefined;
  };

  const locateCountry = (clientX: number, clientY: number) => {
    const exactCountry = locateCountryExactly(clientX, clientY);
    if (exactCountry) return exactCountry;
    const nearbyCountries = new Map<string, MapCountry>();
    for (const [offsetX, offsetY] of SMALL_ISLAND_HIT_OFFSETS) {
      const country = locateCountryExactly(clientX + offsetX, clientY + offsetY);
      if (country) nearbyCountries.set(country.mapId, country);
    }
    return nearbyCountries.size === 1
      ? nearbyCountries.values().next().value
      : undefined;
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const { clientX, clientY } = event;
    const currentTarget = event.currentTarget;
    if (hoverFrameRef.current != null) return;
    hoverFrameRef.current = window.requestAnimationFrame(() => {
      hoverFrameRef.current = null;
      const country = locateCountry(clientX, clientY);
      const bounds = currentTarget.getBoundingClientRect();
      setHovered(
        country
          ? {
              country,
              x: clientX - bounds.left,
              y: clientY - bounds.top,
            }
          : null,
      );
      const canvas = globeSceneRef.current?.viewer.canvas;
      if (canvas) canvas.style.cursor = country ? "pointer" : "grab";
    });
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const movement = Math.hypot(
      event.clientX - pointerStartRef.current.x,
      event.clientY - pointerStartRef.current.y,
    );
    if (movement > 6) return;
    const scene = globeSceneRef.current;
    if (scene && onSelectCapitalRef.current) {
      const bounds = scene.viewer.canvas.getBoundingClientRect();
      const position = new scene.runtime.Cartesian2(
        event.clientX - bounds.left,
        event.clientY - bounds.top,
      );
      const picked = scene.viewer.scene.pick(position);
      const entity =
        picked?.id instanceof scene.runtime.Entity ? picked.id : null;
      const capital = entity
        ? scene.markerCapitals.get(entity.id)
        : undefined;
      if (capital) {
        onSelectCapitalRef.current(capital);
        return;
      }
    }
    const country = locateCountry(event.clientX, event.clientY);
    if (country) onSelectRef.current(country);
  };

  const changeZoom = (zoomIn: boolean) => {
    const scene = globeSceneRef.current;
    if (!scene) return;
    const height = Math.max(
      250,
      scene.viewer.camera.positionCartographic.height,
    );
    const distance = Math.max(125, height * 0.34);
    if (zoomIn) scene.viewer.camera.zoomIn(distance);
    else scene.viewer.camera.zoomOut(distance);
    scene.viewer.scene.requestRender();
    setViewAnnouncement(zoomIn ? "Globe zoomed in" : "Globe zoomed out");
  };

  const resetView = () => {
    const scene = globeSceneRef.current;
    if (!scene) return;
    scene.viewer.camera.flyTo({
      destination: scene.runtime.Cartesian3.fromDegrees(
        INITIAL_LONGITUDE,
        INITIAL_LATITUDE,
        INITIAL_HEIGHT_METERS,
      ),
      duration: 0.65,
      orientation: {
        heading: 0,
        pitch: scene.runtime.Math.toRadians(-90),
        roll: 0,
      },
    });
    setViewAnnouncement("Globe view reset");
  };

  const handleGlobeKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "+" || event.key === "=") {
      event.preventDefault();
      changeZoom(true);
    } else if (event.key === "-") {
      event.preventDefault();
      changeZoom(false);
    } else if (event.key === "0" || event.key === "Home") {
      event.preventDefault();
      resetView();
    }
  };

  return (
    <div
      className="world-globe relative h-full min-h-[420px] w-full overflow-hidden bg-[#050a11]"
      data-capital-country-count={
        new Set(signalPoints.map((point) => point.country.mapId)).size
      }
      data-capital-marker-count={signalPoints.length}
      data-globe-auto-rotate="false"
      data-globe-engine="cesiumjs"
      data-globe-imagery="sentinel-2-cloudless-2016"
      aria-label="Interactive 3D satellite world news globe. Drag to rotate, click a country for news, or select a capital star for live city cameras."
      aria-describedby="world-globe-instructions"
      role="region"
      tabIndex={0}
      onKeyDown={handleGlobeKeyDown}
      onPointerDown={(event) => {
        pointerStartRef.current = { x: event.clientX, y: event.clientY };
      }}
      onPointerLeave={() => setHovered(null)}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
    >
      <div ref={containerRef} className="absolute inset-0" />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_46%,transparent_0%,transparent_38%,rgba(2,5,9,0.12)_66%,rgba(2,5,9,0.48)_100%)]" />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-[#050a11]/70 to-transparent" />
      <div className="pointer-events-none absolute left-5 top-5 z-10 max-w-[260px]">
        <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-[#73e2cc]">
          Live satellite world map
        </div>
        <h1 className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-white sm:text-3xl">
          The world, in context.
        </h1>
        <p className="mt-2 text-xs leading-relaxed text-[#aab5c5]">
          Drag to rotate. Select a capital star for live city cameras.
        </p>
      </div>
      <p id="world-globe-instructions" className="sr-only">
        Drag or swipe to rotate the globe. Use plus and minus to zoom from space
        into terrain, or press zero to reset the view. Tap or click a country to
        open its news, or select a capital star to see available live city
        cameras.
      </p>
      <div
        className="world-globe-controls absolute bottom-4 left-4 z-20 flex gap-2"
        aria-label="Globe view controls"
      >
        <button
          type="button"
          className="icon-button"
          aria-label="Zoom in"
          title="Zoom in"
          onPointerDown={(event) => event.stopPropagation()}
          onPointerUp={(event) => event.stopPropagation()}
          onClick={() => changeZoom(true)}
        >
          <span aria-hidden="true">+</span>
        </button>
        <button
          type="button"
          className="icon-button"
          aria-label="Zoom out"
          title="Zoom out"
          onPointerDown={(event) => event.stopPropagation()}
          onPointerUp={(event) => event.stopPropagation()}
          onClick={() => changeZoom(false)}
        >
          <span aria-hidden="true">−</span>
        </button>
        <button
          type="button"
          aria-label="Reset globe view"
          title="Reset globe view"
          onPointerDown={(event) => event.stopPropagation()}
          onPointerUp={(event) => event.stopPropagation()}
          onClick={resetView}
          className="world-globe-controls__reset"
        >
          Reset
        </button>
      </div>
      <span className="sr-only" role="status" aria-live="polite">
        {viewAnnouncement}
      </span>
      {statusLabel !== "Live" ? (
        <div
          className="pointer-events-none absolute left-5 top-28 z-10 max-w-[calc(100%-2.5rem)] truncate rounded-full border border-[#354258] bg-[#0a121d]/90 px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-[#aab5c5] sm:left-auto sm:right-4 sm:top-4 sm:max-w-[420px]"
          role="status"
          aria-live="polite"
        >
          {statusLabel}
        </div>
      ) : null}
      {hovered ? (
        <div
          className="world-globe-tooltip pointer-events-none absolute z-30"
          style={{
            left: Math.min(hovered.x + 14, 420),
            top: Math.max(12, hovered.y - 14),
          }}
        >
          <div className="world-globe-tooltip__header">
            <strong>{hovered.country.name}</strong>
            <span>{hovered.country.topEvent?.importanceScore ?? "—"}</span>
          </div>
          <div className="world-globe-tooltip__headline">
            {hovered.country.topEvent?.headline ??
              (hovered.country.signalReady === false
                ? "Stories are being updated."
                : "No recent headline is available.")}
          </div>
          <div className="world-globe-tooltip__meta">
            {hovered.country.topEvent
              ? `${hovered.country.topEvent.category} · ${hovered.country.topEvent.importanceLabel}`
              : "Select country"}
          </div>
        </div>
      ) : null}
      {mapError ? (
        <div className="absolute inset-0 z-20 grid place-items-center bg-[#050a11]/95 px-6 text-center">
          <div>
            <div className="text-3xl text-[#d36b7b]">!</div>
            <p className="mt-3 text-sm text-[#d4dbe5]">{mapError}</p>
            <p className="mt-2 text-xs text-[#8290a3]">
              Try enabling hardware acceleration, then reload Hemisphere Herald.
            </p>
          </div>
        </div>
      ) : null}
    </div>
  );
}
