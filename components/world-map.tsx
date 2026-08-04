"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type * as Three from "three";
import type { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import {
  buildCountryHitIndex,
  countryFeatureAtCoordinates,
  polygonsForFeature,
  type CountryHitIndex,
  type WorldFeature,
  type WorldFeatureCollection,
} from "@/lib/country-hit-test";
import type { globeRuntime } from "@/lib/globe-runtime";
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
  onReady?: () => void;
  readyForDisplay?: boolean;
  statusLabel?: string;
  linkEvents?: Event[];
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

interface GlobePoint {
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

type GlobeRuntime = typeof globeRuntime;

interface GlobeScene {
  arcs: Three.Group;
  camera: Three.PerspectiveCamera;
  controls: OrbitControls;
  markerTexture: Three.CanvasTexture;
  points: Three.Points | null;
  raycaster: Three.Raycaster;
  renderer: Three.WebGLRenderer;
  scene: Three.Scene;
  sphere: Three.Mesh;
  texture: Three.CanvasTexture;
  textureCanvas: HTMLCanvasElement;
}

interface HoveredCountry {
  country: MapCountry;
  x: number;
  y: number;
}

const TEXTURE_WIDTH = 4096;
const TEXTURE_HEIGHT = 2048;
const SPHERE_RADIUS = 1;
const ARC_LIMIT = 20;
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
let globeRuntimePromise: Promise<GlobeRuntime> | null =
  typeof window === "undefined" ? null : importGlobeRuntime();
let capitalsPromise: Promise<CapitalCoordinate[]> | null = null;

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

function importGlobeRuntime() {
  return import("@/lib/globe-runtime")
    .then(({ globeRuntime: runtime }) => runtime)
    .catch((error) => {
      globeRuntimePromise = null;
      throw error;
    });
}

function loadGlobeRuntime() {
  if (!globeRuntimePromise) globeRuntimePromise = importGlobeRuntime();
  return globeRuntimePromise;
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
        console.warn("Capital coordinates were unavailable; using country centers.", error);
        return [];
      });
  }
  return capitalsPromise;
}

export async function preloadWorldGlobe() {
  await Promise.all([
    loadWorldGeometry(),
    loadGlobeRuntime(),
    loadCapitalCoordinates(),
  ]);
}

function featureName(feature: WorldFeature) {
  return feature.properties?.name?.trim() ?? "";
}

function countryColor(country?: MapCountry) {
  if (!country) return "#213749";
  if (!country.topEvent) {
    return country.signalReady === false ? "#3a5064" : "#31566d";
  }
  return mapStyleForEvent(
    country.topEvent.category,
    country.topEvent.importanceScore,
  ).fillColor;
}

function normalizeLongitude(longitude: number) {
  return ((((longitude + 180) % 360) + 360) % 360) - 180;
}

function traceRing(
  context: CanvasRenderingContext2D,
  ring: number[][],
  horizontalShift: number,
) {
  if (!ring.length) return;
  let previousLongitude = ring[0][0];
  let unwrappedLongitude = previousLongitude;

  ring.forEach((position, index) => {
    const longitude = position[0];
    const latitude = Math.max(-90, Math.min(90, position[1]));
    if (index) {
      let delta = longitude - previousLongitude;
      if (delta > 180) delta -= 360;
      if (delta < -180) delta += 360;
      unwrappedLongitude += delta;
    }
    const x =
      ((unwrappedLongitude + 180) / 360) * TEXTURE_WIDTH + horizontalShift;
    const y = ((90 - latitude) / 180) * TEXTURE_HEIGHT;
    if (index === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
    previousLongitude = longitude;
  });
  context.closePath();
}

function traceFeature(
  context: CanvasRenderingContext2D,
  feature: WorldFeature,
) {
  context.beginPath();
  for (const polygon of polygonsForFeature(feature)) {
    for (const ring of polygon) {
      traceRing(context, ring, 0);
      const crossesAntimeridian = ring.some((position, index) => {
        const previous = ring[index - 1];
        return previous ? Math.abs(position[0] - previous[0]) > 180 : false;
      });
      if (crossesAntimeridian) {
        traceRing(context, ring, -TEXTURE_WIDTH);
        traceRing(context, ring, TEXTURE_WIDTH);
      }
    }
  }
}

function countryForFeature(
  feature: WorldFeature,
  byId: Map<string, MapCountry>,
  byName: Map<string, MapCountry>,
) {
  return (
    (feature.id != null ? byId.get(String(feature.id)) : undefined) ??
    byName.get(featureName(feature))
  );
}

function drawWorldTexture({
  scene,
  geometry,
  byId,
  byName,
}: {
  scene: GlobeScene;
  geometry: WorldFeatureCollection;
  byId: Map<string, MapCountry>;
  byName: Map<string, MapCountry>;
}) {
  const context = scene.textureCanvas.getContext("2d");
  if (!context) return;

  context.clearRect(0, 0, TEXTURE_WIDTH, TEXTURE_HEIGHT);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  const ocean = context.createLinearGradient(0, 0, 0, TEXTURE_HEIGHT);
  ocean.addColorStop(0, "#0b1d2d");
  ocean.addColorStop(0.48, "#071522");
  ocean.addColorStop(1, "#040c15");
  context.fillStyle = ocean;
  context.fillRect(0, 0, TEXTURE_WIDTH, TEXTURE_HEIGHT);
  context.beginPath();
  for (let longitude = -165; longitude <= 165; longitude += 15) {
    const x = ((longitude + 180) / 360) * TEXTURE_WIDTH;
    context.moveTo(x, 0);
    context.lineTo(x, TEXTURE_HEIGHT);
  }
  for (let latitude = -75; latitude <= 75; latitude += 15) {
    const y = ((90 - latitude) / 180) * TEXTURE_HEIGHT;
    context.moveTo(0, y);
    context.lineTo(TEXTURE_WIDTH, y);
  }
  context.strokeStyle = "rgba(109, 156, 181, 0.1)";
  context.lineWidth = 1;
  context.stroke();
  geometry.features.forEach((feature) => {
    const country = countryForFeature(feature, byId, byName);
    traceFeature(context, feature);
    context.fillStyle = countryColor(country);
    context.fill("evenodd");
    context.strokeStyle = "rgba(147, 193, 216, 0.68)";
    context.lineWidth = 1.25;
    context.stroke();
  });
  scene.texture.needsUpdate = true;
}

function vectorForLatLng(
  THREE: GlobeRuntime["THREE"],
  latitude: number,
  longitude: number,
  radius = SPHERE_RADIUS,
) {
  const lat = (latitude * Math.PI) / 180;
  const lng = (longitude * Math.PI) / 180;
  const cosine = Math.cos(lat);
  return new THREE.Vector3(
    radius * cosine * Math.sin(lng),
    radius * Math.sin(lat),
    radius * cosine * Math.cos(lng),
  );
}

function disposeObject(object: Three.Object3D) {
  object.traverse((child) => {
    const renderable = child as Three.Mesh;
    renderable.geometry?.dispose();
    const materials = Array.isArray(renderable.material)
      ? renderable.material
      : renderable.material
        ? [renderable.material]
        : [];
    for (const material of materials) material.dispose();
  });
}

function createCapitalMarkerCanvas() {
  const canvas = document.createElement("canvas");
  canvas.width = 192;
  canvas.height = 192;
  const context = canvas.getContext("2d");
  if (!context) return canvas;
  const glow = context.createRadialGradient(96, 96, 6, 96, 96, 86);
  glow.addColorStop(0, "rgba(255,255,255,1)");
  glow.addColorStop(0.16, "rgba(255,255,255,0.95)");
  glow.addColorStop(0.36, "rgba(255,255,255,0.3)");
  glow.addColorStop(1, "rgba(255,255,255,0)");
  context.fillStyle = glow;
  context.fillRect(0, 0, 192, 192);
  context.strokeStyle = "rgba(255,255,255,0.92)";
  context.lineWidth = 5;
  context.beginPath();
  context.arc(96, 96, 34, 0, Math.PI * 2);
  context.stroke();
  context.save();
  context.translate(96, 96);
  context.rotate(Math.PI / 4);
  context.fillStyle = "rgba(255,255,255,0.96)";
  context.fillRect(-9, -9, 18, 18);
  context.restore();
  return canvas;
}

function updatePoints(
  runtime: GlobeRuntime,
  globeScene: GlobeScene,
  points: GlobePoint[],
) {
  if (globeScene.points) {
    globeScene.scene.remove(globeScene.points);
    disposeObject(globeScene.points);
    globeScene.points = null;
  }
  if (!points.length) return;

  const positions = new Float32Array(points.length * 3);
  const colors = new Float32Array(points.length * 3);
  points.forEach((point, index) => {
    const position = vectorForLatLng(
      runtime.THREE,
      point.lat,
      point.lng,
      1.003,
    );
    const color = new runtime.THREE.Color(point.color);
    position.toArray(positions, index * 3);
    color.toArray(colors, index * 3);
  });
  const geometry = new runtime.THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new runtime.THREE.BufferAttribute(positions, 3),
  );
  geometry.setAttribute("color", new runtime.THREE.BufferAttribute(colors, 3));
  const material = new runtime.THREE.PointsMaterial({
    size: 0.05,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.95,
    vertexColors: true,
    map: globeScene.markerTexture,
    alphaTest: 0.025,
    depthWrite: false,
    blending: runtime.THREE.AdditiveBlending,
  });
  globeScene.points = new runtime.THREE.Points(geometry, material);
  globeScene.points.renderOrder = 3;
  globeScene.scene.add(globeScene.points);
}

function updateArcs(
  runtime: GlobeRuntime,
  globeScene: GlobeScene,
  arcs: GlobeArc[],
) {
  globeScene.scene.remove(globeScene.arcs);
  disposeObject(globeScene.arcs);
  globeScene.arcs = new runtime.THREE.Group();

  for (const arc of arcs.slice(0, ARC_LIMIT)) {
    const start = vectorForLatLng(
      runtime.THREE,
      arc.startLat,
      arc.startLng,
    ).normalize();
    const end = vectorForLatLng(
      runtime.THREE,
      arc.endLat,
      arc.endLng,
    ).normalize();
    const peak = Math.max(
      0.1,
      Math.min(0.3, arc.importanceScore / 300),
    );
    const vertices: Three.Vector3[] = [];
    for (let index = 0; index <= 24; index += 1) {
      const progress = index / 24;
      const position = start
        .clone()
        .lerp(end, progress)
        .normalize()
        .multiplyScalar(1.025 + Math.sin(Math.PI * progress) * peak);
      vertices.push(position);
    }
    const curve = new runtime.THREE.CatmullRomCurve3(vertices);
    const geometry = new runtime.THREE.TubeGeometry(
      curve,
      64,
      0.0027,
      6,
      false,
    );
    const material = new runtime.THREE.MeshBasicMaterial({
      color: arc.color,
      transparent: true,
      opacity: 0.74,
      blending: runtime.THREE.AdditiveBlending,
      depthWrite: false,
    });
    globeScene.arcs.add(new runtime.THREE.Mesh(geometry, material));
  }
  globeScene.scene.add(globeScene.arcs);
}

function coordinatesAtPoint(
  point: Three.Vector3,
) {
  const normalized = point.clone().normalize();
  const latitude = (Math.asin(normalized.y) * 180) / Math.PI;
  const longitude = normalizeLongitude(
    (Math.atan2(normalized.x, normalized.z) * 180) / Math.PI,
  );
  return { latitude, longitude };
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
  const runtimeRef = useRef<GlobeRuntime | null>(null);
  const globeSceneRef = useRef<GlobeScene | null>(null);
  const geometryRef = useRef<WorldFeatureCollection | null>(null);
  const onSelectRef = useRef(onSelect);
  const onReadyRef = useRef(onReady);
  const readyNotifiedRef = useRef(false);
  const readyForRenderRef = useRef(false);
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
  const countryHitIndex = useMemo<CountryHitIndex | null>(
    () => (worldGeometry ? buildCountryHitIndex(worldGeometry) : null),
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
        (country.iso2 ? capitalIndex.byIso2.get(country.iso2)?.[0] : undefined) ??
        (country.iso3 ? capitalIndex.byIso3.get(country.iso3)?.[0] : undefined);
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
            (country.iso2 ? capitalIndex.byIso2.get(country.iso2) : undefined) ??
            (country.iso3 ? capitalIndex.byIso3.get(country.iso3) : undefined) ??
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
    onReadyRef.current = onReady;
  }, [onReady]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || globeSceneRef.current) return;
    let cancelled = false;
    let animationFrame = 0;
    let resizeObserver: ResizeObserver | null = null;

    void Promise.all([
      loadWorldGeometry(),
      loadGlobeRuntime(),
      loadCapitalCoordinates(),
    ])
      .then(([geometry, runtime, capitals]) => {
        if (cancelled || !containerRef.current) return;
        runtimeRef.current = runtime;
        geometryRef.current = geometry;
        setWorldGeometry(geometry);
        setCapitalCoordinates(capitals);

        const scene = new runtime.THREE.Scene();
        const camera = new runtime.THREE.PerspectiveCamera(42, 1, 0.1, 100);
        camera.position.set(0, 0.2, 2.55);
        const renderer = new runtime.THREE.WebGLRenderer({
          alpha: true,
          antialias: true,
          powerPreference: "high-performance",
        });
        renderer.setClearColor(0x000000, 0);
        renderer.outputColorSpace = runtime.THREE.SRGBColorSpace;
        renderer.toneMapping = runtime.THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 1.08;
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2.5));
        containerRef.current.replaceChildren(renderer.domElement);

        const textureCanvas = document.createElement("canvas");
        textureCanvas.width = TEXTURE_WIDTH;
        textureCanvas.height = TEXTURE_HEIGHT;
        const texture = new runtime.THREE.CanvasTexture(textureCanvas);
        texture.colorSpace = runtime.THREE.SRGBColorSpace;
        texture.minFilter = runtime.THREE.LinearMipmapLinearFilter;
        texture.magFilter = runtime.THREE.LinearFilter;
        texture.generateMipmaps = true;
        texture.anisotropy = Math.min(
          8,
          renderer.capabilities.getMaxAnisotropy(),
        );

        const sphere = new runtime.THREE.Mesh(
          new runtime.THREE.SphereGeometry(SPHERE_RADIUS, 256, 160),
          new runtime.THREE.MeshStandardMaterial({
            map: texture,
            color: 0xffffff,
            emissive: 0x02070d,
            emissiveIntensity: 0.22,
            roughness: 0.72,
            metalness: 0.08,
          }),
        );
        sphere.rotation.y = -Math.PI / 2;
        scene.add(sphere);

        const atmosphere = new runtime.THREE.Mesh(
          new runtime.THREE.SphereGeometry(1.075, 192, 128),
          new runtime.THREE.MeshBasicMaterial({
            color: 0x5b9dbe,
            transparent: true,
            opacity: 0.11,
            side: runtime.THREE.BackSide,
          }),
        );
        scene.add(atmosphere);
        scene.add(new runtime.THREE.HemisphereLight(0xbdeeff, 0x06101a, 1.9));
        const light = new runtime.THREE.DirectionalLight(0xe8fbff, 2.2);
        light.position.set(-3, 4, 5);
        scene.add(light);
        const rimLight = new runtime.THREE.DirectionalLight(0x4f9dba, 1.25);
        rimLight.position.set(4, -2, -3);
        scene.add(rimLight);

        const controls = new runtime.OrbitControls(
          camera,
          renderer.domElement,
        );
        controls.enableDamping = true;
        controls.dampingFactor = 0.06;
        controls.enablePan = false;
        controls.minDistance = 1.55;
        controls.maxDistance = 4;
        controls.autoRotate = false;

        const globeScene: GlobeScene = {
          arcs: new runtime.THREE.Group(),
          camera,
          controls,
          markerTexture: new runtime.THREE.CanvasTexture(
            createCapitalMarkerCanvas(),
          ),
          points: null,
          raycaster: new runtime.THREE.Raycaster(),
          renderer,
          scene,
          sphere,
          texture,
          textureCanvas,
        };
        globeSceneRef.current = globeScene;

        const resize = () => {
          const current = containerRef.current;
          if (!current) return;
          const width = Math.max(1, current.clientWidth);
          const height = Math.max(1, current.clientHeight);
          camera.aspect = width / height;
          camera.updateProjectionMatrix();
          renderer.setSize(width, height, false);
        };
        resizeObserver = new ResizeObserver(resize);
        resizeObserver.observe(containerRef.current);
        resize();

        const render = () => {
          if (cancelled) return;
          if (!document.hidden && readyForRenderRef.current) {
            controls.update();
            renderer.render(scene, camera);
          }
          animationFrame = window.requestAnimationFrame(render);
        };
        render();
        setGlobeSceneReady(true);
        setMapError(null);
      })
      .catch(() => {
        if (!cancelled) {
          setMapError("The interactive globe could not start on this device.");
          readyNotifiedRef.current = true;
          onReadyRef.current?.();
        }
      });

    return () => {
      cancelled = true;
      window.cancelAnimationFrame(animationFrame);
      resizeObserver?.disconnect();
      if (hoverFrameRef.current != null) {
        window.cancelAnimationFrame(hoverFrameRef.current);
      }
      const globeScene = globeSceneRef.current;
      if (globeScene) {
        globeScene.controls.dispose();
        disposeObject(globeScene.scene);
        globeScene.markerTexture.dispose();
        globeScene.texture.dispose();
        globeScene.renderer.dispose();
      }
      globeSceneRef.current = null;
      geometryRef.current = null;
      runtimeRef.current = null;
      readyForRenderRef.current = false;
      container.replaceChildren();
    };
  }, []);

  useEffect(() => {
    const globeScene = globeSceneRef.current;
    const geometry = geometryRef.current;
    if (!globeScene || !geometry || !readyForDisplay || !globeSceneReady) {
      return;
    }
    const timeout = window.setTimeout(() => {
      drawWorldTexture({
        scene: globeScene,
        geometry,
        byId: countryIndex.byId,
        byName: countryIndex.byName,
      });
      if (readyForDisplay && !readyNotifiedRef.current) {
        readyNotifiedRef.current = true;
        readyForRenderRef.current = true;
        globeScene.renderer.render(globeScene.scene, globeScene.camera);
        onReadyRef.current?.();
      }
    }, 120);
    return () => window.clearTimeout(timeout);
  }, [countryIndex, globeSceneReady, readyForDisplay, worldGeometry]);

  useEffect(() => {
    const runtime = runtimeRef.current;
    const globeScene = globeSceneRef.current;
    if (!runtime || !globeScene) return;
    updatePoints(runtime, globeScene, signalPoints);
  }, [signalPoints, worldGeometry]);

  useEffect(() => {
    const runtime = runtimeRef.current;
    const globeScene = globeSceneRef.current;
    if (!runtime || !globeScene) return;
    updateArcs(runtime, globeScene, eventArcs);
  }, [eventArcs, worldGeometry]);

  const locateCountryExactly = (
    clientX: number,
    clientY: number,
    canvasBounds?: DOMRect,
  ) => {
    const globeScene = globeSceneRef.current;
    const runtime = runtimeRef.current;
    const canvas = globeScene?.renderer.domElement;
    if (!globeScene || !runtime || !canvas || !countryHitIndex) return undefined;
    const bounds = canvasBounds ?? canvas.getBoundingClientRect();
    const pointer = new runtime.THREE.Vector2(
      ((clientX - bounds.left) / bounds.width) * 2 - 1,
      -((clientY - bounds.top) / bounds.height) * 2 + 1,
    );
    globeScene.raycaster.setFromCamera(pointer, globeScene.camera);
    const intersection = globeScene.raycaster.intersectObject(
      globeScene.sphere,
      false,
    )[0];
    if (!intersection) return undefined;
    const { latitude, longitude } = coordinatesAtPoint(intersection.point);
    const feature = countryFeatureAtCoordinates(
      countryHitIndex,
      longitude,
      latitude,
    );
    if (!feature) return undefined;
    return (
      (feature.id ? countryIndex.byId.get(feature.id) : undefined) ??
      countryIndex.byName.get(feature.name)
    );
  };

  const locateCountry = (clientX: number, clientY: number) => {
    const canvasBounds =
      globeSceneRef.current?.renderer.domElement.getBoundingClientRect();
    if (!canvasBounds) return undefined;
    const exactCountry = locateCountryExactly(clientX, clientY, canvasBounds);
    if (exactCountry) return exactCountry;

    const nearbyCountries = new Map<string, MapCountry>();
    for (const [offsetX, offsetY] of SMALL_ISLAND_HIT_OFFSETS) {
      const country = locateCountryExactly(
        clientX + offsetX,
        clientY + offsetY,
        canvasBounds,
      );
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
      if (globeSceneRef.current) {
        globeSceneRef.current.renderer.domElement.style.cursor = country
          ? "pointer"
          : "grab";
      }
    });
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const movement = Math.hypot(
      event.clientX - pointerStartRef.current.x,
      event.clientY - pointerStartRef.current.y,
    );
    if (movement > 6) return;
    const country = locateCountry(event.clientX, event.clientY);
    if (country) onSelectRef.current(country);
  };

  const changeZoom = (amount: number) => {
    const globeScene = globeSceneRef.current;
    if (!globeScene) return;
    const offset = globeScene.camera.position
      .clone()
      .sub(globeScene.controls.target);
    const distance = Math.min(
      globeScene.controls.maxDistance,
      Math.max(globeScene.controls.minDistance, offset.length() + amount),
    );
    offset.setLength(distance);
    globeScene.camera.position.copy(globeScene.controls.target).add(offset);
    globeScene.controls.update();
    setViewAnnouncement(amount < 0 ? "Globe zoomed in" : "Globe zoomed out");
  };

  const resetView = () => {
    const globeScene = globeSceneRef.current;
    if (!globeScene) return;
    globeScene.camera.position.set(0, 0.2, 2.55);
    globeScene.controls.target.set(0, 0, 0);
    globeScene.controls.update();
    setViewAnnouncement("Globe view reset");
  };

  const handleGlobeKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "+" || event.key === "=") {
      event.preventDefault();
      changeZoom(-0.3);
    } else if (event.key === "-") {
      event.preventDefault();
      changeZoom(0.3);
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
      data-globe-texture={`${TEXTURE_WIDTH}x${TEXTURE_HEIGHT}`}
      aria-label="Interactive 3D world news globe. Drag to rotate, scroll to zoom, and click or tap a country to open its news panel."
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
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_46%,transparent_0%,transparent_32%,rgba(2,5,9,0.2)_58%,rgba(2,5,9,0.72)_100%)]" />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-[#050a11]/80 to-transparent" />
      <div className="pointer-events-none absolute left-5 top-5 z-10 max-w-[260px]">
        <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-[#73e2cc]">
          Live world map
        </div>
        <h1 className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-white sm:text-3xl">
          The world, in context.
        </h1>
        <p className="mt-2 text-xs leading-relaxed text-[#aab5c5]">
          Drag to rotate. Pinch, scroll, or use the controls to zoom.
        </p>
      </div>
      <p id="world-globe-instructions" className="sr-only">
        Drag or swipe to rotate the globe. Use plus and minus to zoom, or press
        zero to reset the view. Tap or click a country to open its news.
      </p>
      <div className="world-globe-controls absolute bottom-4 left-4 z-20 flex gap-2" aria-label="Globe view controls">
        <button
          type="button"
          aria-label="Zoom in"
          title="Zoom in"
          onPointerDown={(event) => event.stopPropagation()}
          onPointerUp={(event) => event.stopPropagation()}
          onClick={() => changeZoom(-0.3)}
        >
          <span aria-hidden="true">+</span>
        </button>
        <button
          type="button"
          aria-label="Zoom out"
          title="Zoom out"
          onPointerDown={(event) => event.stopPropagation()}
          onPointerUp={(event) => event.stopPropagation()}
          onClick={() => changeZoom(0.3)}
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
      <span className="sr-only" role="status" aria-live="polite">{viewAnnouncement}</span>
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
