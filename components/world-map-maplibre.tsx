"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type {
  GeoJSONSource,
  Map as MapLibreMap,
  MapMouseEvent,
  StyleSpecification,
} from "maplibre-gl";
import type {
  WorldFeature,
  WorldFeatureCollection,
} from "@/lib/country-hit-test";
import {
  buildEventLinkCollection,
  countryCentersFromGeoJson,
  type MapPosition,
} from "@/lib/map-links";
import { mapStyleForEvent } from "@/lib/scoring";
import type { Event, MapCountry } from "@/lib/types";
import "maplibre-gl/dist/maplibre-gl.css";

export interface WorldMapProps {
  countries: MapCountry[];
  selectedMapId: string | null;
  onSelect: (country: MapCountry) => void;
  onReady?: () => void;
  readyForDisplay?: boolean;
  statusLabel?: string;
  linkEvents?: Event[];
}

interface CapitalCoordinate {
  iso2: string | null;
  iso3: string | null;
  capital: string;
  lat: number;
  lng: number;
}

interface GlobePoint {
  capital: string;
  color: string;
  country: MapCountry;
  lat: number;
  lng: number;
}

interface HoveredCountry {
  country: MapCountry;
  x: number;
  y: number;
}

interface MapLibreScene {
  map: MapLibreMap;
  ready: boolean;
}

type MapLibreRuntime = typeof import("maplibre-gl");

const INITIAL_LONGITUDE = 17;
const INITIAL_LATITUDE = 12;
const INITIAL_ZOOM = 1.65;
const COUNTRY_SOURCE_ID = "worldpulse-countries";
const COUNTRY_FILL_LAYER_ID = "worldpulse-country-fill";
const COUNTRY_OUTLINE_LAYER_ID = "worldpulse-country-outline";
const CAPITAL_SOURCE_ID = "worldpulse-capitals";
const CAPITAL_LAYER_ID = "worldpulse-capital-stars";
const ARC_SOURCE_ID = "worldpulse-arcs";
const ARC_LAYER_ID = "worldpulse-connection-arcs";
const SATELLITE_TILE_URL =
  "https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless_3857/default/g/{z}/{y}/{x}.jpg";
const TERRAIN_TILE_URL = "/api/terrain/{z}/{x}/{y}";
const ARC_LIMIT = 12;
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

export const GLOBE_PERFORMANCE_PROFILE = {
  arcLimit: ARC_LIMIT,
  antialias: false,
  imageryMaxLevel: 10,
  maxTileCacheSize: 32,
  maxZoom: 13,
  pixelRatioLimit: 1,
  terrainActivationZoom: 3.25,
  terrainExaggeration: 1.65,
  terrainMaxLevel: 11,
} as const;

let geometryPromise: Promise<WorldFeatureCollection> | null = null;
let geometryFetchIdentity: typeof fetch | null = null;
let capitalsPromise: Promise<CapitalCoordinate[]> | null = null;
let runtimePromise: Promise<MapLibreRuntime> | null = null;

function loadMapLibreRuntime() {
  if (!runtimePromise) {
    runtimePromise = import("maplibre-gl").catch((error) => {
      runtimePromise = null;
      throw error;
    });
  }
  return runtimePromise;
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
    loadCapitalCoordinates(),
    loadMapLibreRuntime(),
  ]);
}

function featureName(feature: WorldFeature) {
  return feature.properties?.name?.trim() ?? "";
}

function countryForFeature(
  feature: WorldFeature,
  byId: Map<string, MapCountry>,
  byName: Map<string, MapCountry>,
) {
  const featureId = feature.id == null ? null : String(feature.id);
  const name = featureName(feature);
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

function prepareCountryGeoJson(
  geometry: WorldFeatureCollection,
  countryIndex: {
    byId: Map<string, MapCountry>;
    byName: Map<string, MapCountry>;
  },
  selectedMapId: string | null,
) {
  return {
    type: "FeatureCollection" as const,
    features: geometry.features.map((feature, index) => {
      const country = countryForFeature(
        feature,
        countryIndex.byId,
        countryIndex.byName,
      );
      const selected = country?.mapId === selectedMapId;
      return {
        ...feature,
        id: `worldpulse-country-${index}`,
        properties: {
          ...feature.properties,
          worldPulseColor: countryColor(country),
          worldPulseMapId: country?.mapId ?? "",
          worldPulseName: country?.name ?? featureName(feature),
          worldPulseOpacity: selected
            ? 0.68
            : country?.topEvent
              ? 0.46
              : 0.28,
        },
      };
    }),
  };
}

function starImageName(color: string) {
  return `worldpulse-star-${color.replace(/[^a-z0-9]/gi, "").toLowerCase()}`;
}

function createStarImage(color: string) {
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  if (!context) return null;
  const center = size / 2;
  const outerRadius = 25;
  const innerRadius = 10.5;
  context.clearRect(0, 0, size, size);
  context.beginPath();
  for (let index = 0; index < 10; index += 1) {
    const radius = index % 2 === 0 ? outerRadius : innerRadius;
    const angle = -Math.PI / 2 + (index * Math.PI) / 5;
    const x = center + Math.cos(angle) * radius;
    const y = center + Math.sin(angle) * radius;
    if (index === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  }
  context.closePath();
  context.shadowBlur = 8;
  context.shadowColor = color;
  context.fillStyle = color;
  context.fill();
  context.shadowBlur = 0;
  context.lineWidth = 2.5;
  context.strokeStyle = "rgba(255,255,255,0.92)";
  context.stroke();
  return context.getImageData(0, 0, size, size);
}

function ensureStarImages(map: MapLibreMap, points: GlobePoint[]) {
  for (const color of new Set(points.map((point) => point.color))) {
    const name = starImageName(color);
    if (map.hasImage(name)) continue;
    const image = createStarImage(color);
    if (image) map.addImage(name, image, { pixelRatio: 2 });
  }
}

function pointGeoJson(points: GlobePoint[]) {
  return {
    type: "FeatureCollection" as const,
    features: points.map((point, index) => ({
      type: "Feature" as const,
      id: `worldpulse-marker-${point.country.mapId}-${index}`,
      properties: {
        worldPulseCapital: point.capital,
        worldPulseIcon: starImageName(point.color),
        worldPulseMapId: point.country.mapId,
        worldPulseName: point.country.name,
      },
      geometry: {
        type: "Point" as const,
        coordinates: [point.lng, point.lat],
      },
    })),
  };
}

function emptyFeatureCollection() {
  return { type: "FeatureCollection" as const, features: [] };
}

function createMapStyle(): StyleSpecification {
  return {
    version: 8,
    name: "WorldPulse satellite globe",
    sources: {
      satellite: {
        type: "raster",
        tiles: [SATELLITE_TILE_URL],
        tileSize: 256,
        minzoom: 0,
        maxzoom: GLOBE_PERFORMANCE_PROFILE.imageryMaxLevel,
        attribution:
          "Sentinel-2 cloudless by EOX; modified Copernicus Sentinel data 2016",
      },
    },
    layers: [
      {
        id: "worldpulse-space",
        type: "background",
        paint: { "background-color": "#050a11" },
      },
      {
        id: "worldpulse-satellite",
        type: "raster",
        source: "satellite",
        paint: {
          "raster-brightness-max": 0.66,
          "raster-contrast": 0.08,
          "raster-fade-duration": 0,
          "raster-saturation": -0.12,
        },
      },
    ],
  };
}

function installMapOverlays(
  map: MapLibreMap,
  geometry: WorldFeatureCollection,
  countryIndex: {
    byId: Map<string, MapCountry>;
    byName: Map<string, MapCountry>;
  },
  selectedMapId: string | null,
  points: GlobePoint[],
  arcs: ReturnType<typeof buildEventLinkCollection>,
) {
  map.addSource(COUNTRY_SOURCE_ID, {
    type: "geojson",
    data: prepareCountryGeoJson(geometry, countryIndex, selectedMapId),
    buffer: 8,
    maxzoom: GLOBE_PERFORMANCE_PROFILE.maxZoom,
    tolerance: 0.75,
  });
  map.addLayer({
    id: COUNTRY_FILL_LAYER_ID,
    type: "fill",
    source: COUNTRY_SOURCE_ID,
    paint: {
      "fill-color": ["get", "worldPulseColor"],
      "fill-opacity": ["get", "worldPulseOpacity"],
    },
  });
  map.addLayer({
    id: COUNTRY_OUTLINE_LAYER_ID,
    type: "line",
    source: COUNTRY_SOURCE_ID,
    paint: {
      "line-color": "rgba(218,231,241,0.68)",
      "line-opacity": 0.65,
      "line-width": ["interpolate", ["linear"], ["zoom"], 0, 0.35, 6, 1],
    },
  });
  map.addSource(ARC_SOURCE_ID, { type: "geojson", data: arcs });
  map.addLayer({
    id: ARC_LAYER_ID,
    type: "line",
    source: ARC_SOURCE_ID,
    layout: { "line-cap": "round", "line-join": "round" },
    paint: {
      "line-blur": 0.8,
      "line-color": ["get", "color"],
      "line-opacity": 0.82,
      "line-width": ["interpolate", ["linear"], ["zoom"], 0, 0.8, 7, 2.2],
    },
  });
  ensureStarImages(map, points);
  map.addSource(CAPITAL_SOURCE_ID, {
    type: "geojson",
    data: pointGeoJson(points),
  });
  map.addLayer({
    id: CAPITAL_LAYER_ID,
    type: "symbol",
    source: CAPITAL_SOURCE_ID,
    layout: {
      "icon-allow-overlap": true,
      "icon-ignore-placement": true,
      "icon-image": ["get", "worldPulseIcon"],
      "icon-size": [
        "interpolate",
        ["linear"],
        ["zoom"],
        0,
        0.24,
        2,
        0.38,
        6,
        0.78,
        11,
        1.05,
      ],
    },
  });
}

function ensureTerrain(map: MapLibreMap) {
  if (map.getZoom() < GLOBE_PERFORMANCE_PROFILE.terrainActivationZoom) return;
  if (!map.getSource("terrain")) {
    map.addSource("terrain", {
      type: "raster-dem",
      tiles: [TERRAIN_TILE_URL],
      tileSize: 256,
      minzoom: 0,
      maxzoom: GLOBE_PERFORMANCE_PROFILE.terrainMaxLevel,
      encoding: "terrarium",
      attribution: "Mapzen terrain via AWS Open Data",
    });
  }
  map.setTerrain({
    source: "terrain",
    exaggeration: GLOBE_PERFORMANCE_PROFILE.terrainExaggeration,
  });
}

function sourceAsGeoJson(map: MapLibreMap, id: string) {
  return map.getSource(id) as GeoJSONSource | undefined;
}

function mapIdFromFeatures(
  map: MapLibreMap,
  point: { x: number; y: number },
) {
  const layers = [CAPITAL_LAYER_ID, COUNTRY_FILL_LAYER_ID].filter((layer) =>
    map.getLayer(layer),
  );
  if (!layers.length) return undefined;
  const features = map.queryRenderedFeatures([point.x, point.y], {
    layers,
  });
  const mapId = features[0]?.properties?.worldPulseMapId;
  return typeof mapId === "string" && mapId ? mapId : undefined;
}

function locateMapId(map: MapLibreMap, point: { x: number; y: number }) {
  const exact = mapIdFromFeatures(map, point);
  if (exact) return exact;
  const nearby = new Set<string>();
  for (const [offsetX, offsetY] of SMALL_ISLAND_HIT_OFFSETS) {
    const mapId = mapIdFromFeatures(map, {
      x: point.x + offsetX,
      y: point.y + offsetY,
    });
    if (mapId) nearby.add(mapId);
  }
  return nearby.size === 1 ? nearby.values().next().value : undefined;
}

export function WorldMap({
  countries,
  selectedMapId,
  onSelect,
  onReady,
  readyForDisplay = true,
  statusLabel = "Live",
  linkEvents = [],
}: WorldMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<MapLibreScene | null>(null);
  const onSelectRef = useRef(onSelect);
  const onReadyRef = useRef(onReady);
  const readyNotifiedRef = useRef(false);
  const countryIndexRef = useRef<{
    byId: Map<string, MapCountry>;
    byName: Map<string, MapCountry>;
  }>({ byId: new Map(), byName: new Map() });
  const mapInputsRef = useRef<{
    eventArcs: ReturnType<typeof buildEventLinkCollection>;
    readyForDisplay: boolean;
    selectedMapId: string | null;
    signalPoints: GlobePoint[];
  }>({
    eventArcs: emptyFeatureCollection(),
    readyForDisplay: false,
    selectedMapId: null,
    signalPoints: [],
  });
  const [hovered, setHovered] = useState<HoveredCountry | null>(null);
  const [mapError, setMapError] = useState<string | null>(null);
  const [worldGeometry, setWorldGeometry] =
    useState<WorldFeatureCollection | null>(null);
  const [capitalCoordinates, setCapitalCoordinates] = useState<
    CapitalCoordinate[]
  >([]);
  const [viewAnnouncement, setViewAnnouncement] = useState("");

  const countryIndex = useMemo(() => {
    const byId = new Map<string, MapCountry>();
    const byName = new Map<string, MapCountry>();
    for (const country of countries) {
      byId.set(country.mapId, country);
      byName.set(country.name, country);
    }
    return { byId, byName };
  }, [countries]);
  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  useEffect(() => {
    onReadyRef.current = onReady;
  }, [onReady]);

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
  const eventArcs = useMemo(
    () =>
      Object.keys(connectionCenters).length
        ? buildEventLinkCollection({
            events: linkEvents,
            countries,
            selectedMapId,
            centers: connectionCenters,
            maxLinks: ARC_LIMIT,
          })
        : emptyFeatureCollection(),
    [connectionCenters, countries, linkEvents, selectedMapId],
  );
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
    countryIndexRef.current = countryIndex;
  }, [countryIndex]);

  useEffect(() => {
    mapInputsRef.current = {
      eventArcs: eventArcs as ReturnType<typeof buildEventLinkCollection>,
      readyForDisplay,
      selectedMapId,
      signalPoints,
    };
  }, [eventArcs, readyForDisplay, selectedMapId, signalPoints]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || sceneRef.current) return;
    let cancelled = false;
    let map: MapLibreMap | null = null;
    let animationFrame: number | null = null;
    let overlayIdleHandle: number | null = null;
    let contextLostListener: EventListener | null = null;
    let visibilityListener: (() => void) | null = null;

    const reportFailure = (error: unknown) => {
      console.error("World globe initialization failed.", error);
      map?.remove();
      map = null;
      if (!cancelled) {
        setMapError("The interactive globe could not start on this device.");
        if (!readyNotifiedRef.current) {
          readyNotifiedRef.current = true;
          onReadyRef.current?.();
        }
      }
    };

    const initialize = async () => {
      const overlayData = Promise.all([
        loadWorldGeometry(),
        loadCapitalCoordinates(),
      ]);
      const runtime = await loadMapLibreRuntime();
      if (cancelled || !containerRef.current) return;
      runtime.setWorkerCount(1);
      map = new runtime.Map({
        container: containerRef.current,
        style: createMapStyle(),
        center: [INITIAL_LONGITUDE, INITIAL_LATITUDE],
        zoom: INITIAL_ZOOM,
        minZoom: 0.35,
        maxZoom: GLOBE_PERFORMANCE_PROFILE.maxZoom,
        pitch: 0,
        bearing: 0,
        attributionControl: false,
        canvasContextAttributes: {
          antialias: GLOBE_PERFORMANCE_PROFILE.antialias,
          preserveDrawingBuffer: false,
        },
        fadeDuration: 0,
        maxTileCacheSize: GLOBE_PERFORMANCE_PROFILE.maxTileCacheSize,
        cancelPendingTileRequestsWhileZooming: true,
        pixelRatio: Math.min(
          window.devicePixelRatio || 1,
          GLOBE_PERFORMANCE_PROFILE.pixelRatioLimit,
        ),
        renderWorldCopies: false,
      });
      const liveMap = map;
      sceneRef.current = { map: liveMap, ready: false };

      liveMap.on("styleimagemissing", (event) => {
        const encodedColor = event.id.replace("worldpulse-star-", "");
        if (!/^[0-9a-f]{6}$/i.test(encodedColor) || liveMap.hasImage(event.id)) {
          return;
        }
        const image = createStarImage(`#${encodedColor}`);
        if (image) liveMap.addImage(event.id, image, { pixelRatio: 2 });
      });

      liveMap.once("load", () => {
        if (cancelled) return;
        liveMap.setProjection({ type: "globe" });
        setMapError(null);
        if (!readyNotifiedRef.current) {
          readyNotifiedRef.current = true;
          onReadyRef.current?.();
        }
        void overlayData
          .then(([geometry, capitals]) => {
            if (cancelled) return;
            setWorldGeometry(geometry);
            setCapitalCoordinates(capitals);
            const installOverlays = () => {
              if (cancelled) return;
              try {
                const latestInputs = mapInputsRef.current;
                installMapOverlays(
                  liveMap,
                  geometry,
                  countryIndexRef.current,
                  latestInputs.selectedMapId,
                  latestInputs.signalPoints,
                  latestInputs.eventArcs,
                );
                const scene = sceneRef.current;
                if (scene) scene.ready = true;
                ensureTerrain(liveMap);
              } catch (error) {
                reportFailure(error);
              }
            };
            if (window.requestIdleCallback) {
              overlayIdleHandle = window.requestIdleCallback(installOverlays, {
                timeout: 1_500,
              });
            } else {
              window.setTimeout(installOverlays, 0);
            }
          })
          .catch(reportFailure);
      });
      liveMap.on("error", (event) => {
        const message = event.error?.message ?? "";
        if (/webgl|context|shader/i.test(message)) reportFailure(event.error);
      });
      liveMap.on("mousemove", (event: MapMouseEvent) => {
        const mapId = locateMapId(liveMap, event.point);
        const country = mapId
          ? countryIndexRef.current.byId.get(mapId)
          : undefined;
        liveMap.getCanvas().style.cursor = country ? "pointer" : "grab";
        setHovered(
          country
            ? { country, x: event.point.x, y: event.point.y }
            : null,
        );
      });
      liveMap.on("mouseout", () => setHovered(null));
      liveMap.on("click", (event: MapMouseEvent) => {
        const mapId = locateMapId(liveMap, event.point);
        const country = mapId
          ? countryIndexRef.current.byId.get(mapId)
          : undefined;
        if (country) onSelectRef.current(country);
      });
      liveMap.on("zoomend", () => ensureTerrain(liveMap));
      visibilityListener = () => {
        if (document.hidden) {
          liveMap.stop();
        } else {
          liveMap.resize();
          liveMap.triggerRepaint();
        }
      };
      document.addEventListener("visibilitychange", visibilityListener);
      contextLostListener = (event) => {
        event.preventDefault();
        setMapError("The interactive globe paused to protect this device.");
        if (!readyNotifiedRef.current) {
          readyNotifiedRef.current = true;
          onReadyRef.current?.();
        }
      };
      liveMap
        .getCanvas()
        .addEventListener("webglcontextlost", contextLostListener);
    };

    animationFrame = window.requestAnimationFrame(() => {
      void initialize().catch(reportFailure);
    });

    return () => {
      cancelled = true;
      if (animationFrame != null) {
        window.cancelAnimationFrame(animationFrame);
      }
      if (overlayIdleHandle != null && window.cancelIdleCallback) {
        window.cancelIdleCallback(overlayIdleHandle);
      }
      if (map && contextLostListener) {
        map
          .getCanvas()
          .removeEventListener("webglcontextlost", contextLostListener);
      }
      if (visibilityListener) {
        document.removeEventListener("visibilitychange", visibilityListener);
      }
      map?.remove();
      sceneRef.current = null;
      container.replaceChildren();
    };
  }, []);

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene?.ready || !worldGeometry) return;
    sourceAsGeoJson(scene.map, COUNTRY_SOURCE_ID)?.setData(
      prepareCountryGeoJson(worldGeometry, countryIndex, selectedMapId),
    );
    if (readyForDisplay && !readyNotifiedRef.current) {
      readyNotifiedRef.current = true;
      onReadyRef.current?.();
    }
  }, [countryIndex, readyForDisplay, selectedMapId, worldGeometry]);

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene?.ready) return;
    ensureStarImages(scene.map, signalPoints);
    sourceAsGeoJson(scene.map, CAPITAL_SOURCE_ID)?.setData(
      pointGeoJson(signalPoints),
    );
  }, [signalPoints]);

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene?.ready) return;
    sourceAsGeoJson(scene.map, ARC_SOURCE_ID)?.setData(eventArcs);
  }, [eventArcs]);

  const changeZoom = (zoomIn: boolean) => {
    const map = sceneRef.current?.map;
    if (!map) return;
    if (zoomIn) map.zoomIn({ duration: 280 });
    else map.zoomOut({ duration: 280 });
    setViewAnnouncement(zoomIn ? "Globe zoomed in" : "Globe zoomed out");
  };

  const resetView = () => {
    const map = sceneRef.current?.map;
    if (!map) return;
    map.easeTo({
      center: [INITIAL_LONGITUDE, INITIAL_LATITUDE],
      zoom: INITIAL_ZOOM,
      bearing: 0,
      pitch: 0,
      duration: 650,
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
      data-globe-engine="maplibre-gl"
      data-globe-imagery="sentinel-2-cloudless-2016"
      aria-label="Interactive 3D satellite world news globe. Drag to rotate, scroll to zoom from space to terrain, and click or tap a country to open its news panel."
      aria-describedby="world-globe-instructions"
      role="region"
      tabIndex={0}
      onKeyDown={handleGlobeKeyDown}
    >
      <div
        ref={containerRef}
        className="h-full w-full"
        style={{ position: "absolute", inset: 0 }}
      />
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
          Drag to rotate. Scroll or use the controls to zoom into terrain.
        </p>
      </div>
      <p id="world-globe-instructions" className="sr-only">
        Drag or swipe to rotate the globe. Use plus and minus to zoom from space
        into terrain, or press zero to reset the view. Tap or click a country to
        open its news.
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
          onClick={() => changeZoom(true)}
        >
          <span aria-hidden="true">+</span>
        </button>
        <button
          type="button"
          className="icon-button"
          aria-label="Zoom out"
          title="Zoom out"
          onClick={() => changeZoom(false)}
        >
          <span aria-hidden="true">−</span>
        </button>
        <button
          type="button"
          aria-label="Reset globe view"
          title="Reset globe view"
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
              Try enabling hardware acceleration, then reload WorldPulse.
            </p>
          </div>
        </div>
      ) : null}
    </div>
  );
}
