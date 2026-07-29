"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type * as Three from "three";
import type { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
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
  statusLabel?: string;
  linkEvents?: Event[];
}

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

interface GlobeArc {
  color: string;
  endLat: number;
  endLng: number;
  importanceScore: number;
  startLat: number;
  startLng: number;
}

interface GlobePoint {
  color: string;
  country: MapCountry;
  lat: number;
  lng: number;
}

type GlobeRuntime = typeof globeRuntime;

interface GlobeScene {
  arcs: Three.Group;
  camera: Three.PerspectiveCamera;
  controls: OrbitControls;
  hitCanvas: HTMLCanvasElement;
  hitCountries: Array<MapCountry | undefined>;
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

const TEXTURE_WIDTH = 1536;
const TEXTURE_HEIGHT = 768;
const SPHERE_RADIUS = 1;
const POINT_LIMIT = 90;
const ARC_LIMIT = 20;

let geometryPromise: Promise<WorldFeatureCollection> | null = null;
let geometryFetchIdentity: typeof fetch | null = null;
let globeRuntimePromise: Promise<GlobeRuntime> | null = null;

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

function loadGlobeRuntime() {
  if (!globeRuntimePromise) {
    globeRuntimePromise = import("@/lib/globe-runtime")
      .then(({ globeRuntime: runtime }) => runtime)
      .catch((error) => {
        globeRuntimePromise = null;
        throw error;
      });
  }
  return globeRuntimePromise;
}

export async function preloadWorldGlobe() {
  await Promise.all([loadWorldGeometry(), loadGlobeRuntime()]);
}

function featureName(feature: WorldFeature) {
  return feature.properties?.name?.trim() ?? "";
}

function countryColor(country?: MapCountry) {
  if (!country?.topEvent) {
    return country?.signalReady === false ? "#273443" : "#192634";
  }
  return mapStyleForEvent(
    country.topEvent.category,
    country.topEvent.importanceScore,
  ).fillColor;
}

function normalizeLongitude(longitude: number) {
  return ((((longitude + 180) % 360) + 360) % 360) - 180;
}

function coordinatesToPolygons(feature: WorldFeature): number[][][][] {
  if (feature.geometry.type === "Polygon") {
    return [feature.geometry.coordinates as number[][][]];
  }
  if (feature.geometry.type === "MultiPolygon") {
    return feature.geometry.coordinates as number[][][][];
  }
  return [];
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
  for (const polygon of coordinatesToPolygons(feature)) {
    for (const ring of polygon) {
      traceRing(context, ring, -TEXTURE_WIDTH);
      traceRing(context, ring, 0);
      traceRing(context, ring, TEXTURE_WIDTH);
    }
  }
}

function hitColor(index: number) {
  return `rgb(${index & 255}, ${(index >> 8) & 255}, ${(index >> 16) & 255})`;
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
  selectedMapId,
}: {
  scene: GlobeScene;
  geometry: WorldFeatureCollection;
  byId: Map<string, MapCountry>;
  byName: Map<string, MapCountry>;
  selectedMapId: string | null;
}) {
  const context = scene.textureCanvas.getContext("2d");
  const hitContext = scene.hitCanvas.getContext("2d", {
    willReadFrequently: true,
  });
  if (!context || !hitContext) return;

  context.clearRect(0, 0, TEXTURE_WIDTH, TEXTURE_HEIGHT);
  context.fillStyle = "#07111d";
  context.fillRect(0, 0, TEXTURE_WIDTH, TEXTURE_HEIGHT);
  hitContext.clearRect(0, 0, TEXTURE_WIDTH, TEXTURE_HEIGHT);
  scene.hitCountries = [undefined];

  geometry.features.forEach((feature) => {
    const country = countryForFeature(feature, byId, byName);
    const selected = country?.mapId === selectedMapId;
    traceFeature(context, feature);
    context.fillStyle = countryColor(country);
    context.fill("evenodd");
    context.strokeStyle = selected
      ? "rgba(245, 255, 255, 0.98)"
      : "rgba(130, 174, 197, 0.58)";
    context.lineWidth = selected ? 2.4 : 0.72;
    context.stroke();

    if (country) {
      const index = scene.hitCountries.push(country) - 1;
      traceFeature(hitContext, feature);
      hitContext.fillStyle = hitColor(index);
      hitContext.fill("evenodd");
      hitContext.strokeStyle = hitColor(index);
      hitContext.lineWidth = 2;
      hitContext.stroke();
    }
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
      1.018,
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
    size: 0.026,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.94,
    vertexColors: true,
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
    const geometry = new runtime.THREE.BufferGeometry().setFromPoints(vertices);
    const material = new runtime.THREE.LineBasicMaterial({
      color: arc.color,
      transparent: true,
      opacity: 0.6,
    });
    globeScene.arcs.add(new runtime.THREE.Line(geometry, material));
  }
  globeScene.scene.add(globeScene.arcs);
}

function countryAtPoint(
  globeScene: GlobeScene,
  point: Three.Vector3,
): MapCountry | undefined {
  const normalized = point.clone().normalize();
  const latitude = (Math.asin(normalized.y) * 180) / Math.PI;
  const longitude = normalizeLongitude(
    (Math.atan2(normalized.x, normalized.z) * 180) / Math.PI,
  );
  const x = Math.min(
    TEXTURE_WIDTH - 1,
    Math.max(0, Math.floor(((longitude + 180) / 360) * TEXTURE_WIDTH)),
  );
  const y = Math.min(
    TEXTURE_HEIGHT - 1,
    Math.max(0, Math.floor(((90 - latitude) / 180) * TEXTURE_HEIGHT)),
  );
  const context = globeScene.hitCanvas.getContext("2d", {
    willReadFrequently: true,
  });
  if (!context) return undefined;
  const [red, green, blue] = context.getImageData(x, y, 1, 1).data;
  return globeScene.hitCountries[red | (green << 8) | (blue << 16)];
}

export function WorldMap({
  countries,
  selectedMapId,
  onSelect,
  statusLabel = "Live feed · auto-refresh",
  linkEvents = [],
}: WorldMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const runtimeRef = useRef<GlobeRuntime | null>(null);
  const globeSceneRef = useRef<GlobeScene | null>(null);
  const geometryRef = useRef<WorldFeatureCollection | null>(null);
  const onSelectRef = useRef(onSelect);
  const hoverFrameRef = useRef<number | null>(null);
  const pointerStartRef = useRef({ x: 0, y: 0 });
  const [hovered, setHovered] = useState<HoveredCountry | null>(null);
  const [mapError, setMapError] = useState<string | null>(null);
  const [worldGeometry, setWorldGeometry] =
    useState<WorldFeatureCollection | null>(null);

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

  const eventArcs = useMemo<GlobeArc[]>(() => {
    if (!Object.keys(countryCenters).length) return [];
    return buildEventLinkCollection({
      events: linkEvents,
      countries,
      selectedMapId,
      centers: countryCenters,
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
  }, [countries, countryCenters, linkEvents, selectedMapId]);

  const signalPoints = useMemo<GlobePoint[]>(
    () =>
      countries
        .filter((country) => country.topEvent)
        .sort(
          (left, right) =>
            (right.topEvent?.importanceScore ?? 0) -
            (left.topEvent?.importanceScore ?? 0),
        )
        .slice(0, POINT_LIMIT)
        .flatMap((country) => {
          const center =
            countryCenters[country.name] ?? countryCenters[country.mapId];
          if (!center) return [];
          return [
            {
              color: mapStyleForEvent(
                country.topEvent?.category,
                country.topEvent?.importanceScore,
              ).fillColor,
              country,
              lat: center[1],
              lng: center[0],
            },
          ];
        }),
    [countries, countryCenters],
  );

  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || globeSceneRef.current) return;
    let cancelled = false;
    let animationFrame = 0;
    let resizeObserver: ResizeObserver | null = null;

    void Promise.all([loadWorldGeometry(), loadGlobeRuntime()])
      .then(([geometry, runtime]) => {
        if (cancelled || !containerRef.current) return;
        runtimeRef.current = runtime;
        geometryRef.current = geometry;
        setWorldGeometry(geometry);

        const scene = new runtime.THREE.Scene();
        const camera = new runtime.THREE.PerspectiveCamera(42, 1, 0.1, 100);
        camera.position.set(0, 0.2, 2.55);
        const renderer = new runtime.THREE.WebGLRenderer({
          alpha: true,
          antialias: false,
          powerPreference: "high-performance",
        });
        renderer.setClearColor(0x000000, 0);
        renderer.outputColorSpace = runtime.THREE.SRGBColorSpace;
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.25));
        containerRef.current.replaceChildren(renderer.domElement);

        const textureCanvas = document.createElement("canvas");
        textureCanvas.width = TEXTURE_WIDTH;
        textureCanvas.height = TEXTURE_HEIGHT;
        const hitCanvas = document.createElement("canvas");
        hitCanvas.width = TEXTURE_WIDTH;
        hitCanvas.height = TEXTURE_HEIGHT;
        const texture = new runtime.THREE.CanvasTexture(textureCanvas);
        texture.colorSpace = runtime.THREE.SRGBColorSpace;
        texture.minFilter = runtime.THREE.LinearFilter;
        texture.magFilter = runtime.THREE.LinearFilter;

        const sphere = new runtime.THREE.Mesh(
          new runtime.THREE.SphereGeometry(SPHERE_RADIUS, 64, 36),
          new runtime.THREE.MeshPhongMaterial({
            map: texture,
            color: 0xffffff,
            emissive: 0x02070d,
            emissiveIntensity: 0.42,
            shininess: 4,
          }),
        );
        sphere.rotation.y = -Math.PI / 2;
        scene.add(sphere);

        const atmosphere = new runtime.THREE.Mesh(
          new runtime.THREE.SphereGeometry(1.08, 48, 28),
          new runtime.THREE.MeshBasicMaterial({
            color: 0x5b9dbe,
            transparent: true,
            opacity: 0.11,
            side: runtime.THREE.BackSide,
          }),
        );
        scene.add(atmosphere);
        scene.add(new runtime.THREE.HemisphereLight(0xa8d8e8, 0x07111d, 2.1));
        const light = new runtime.THREE.DirectionalLight(0xffffff, 1.6);
        light.position.set(-3, 4, 5);
        scene.add(light);

        const controls = new runtime.OrbitControls(
          camera,
          renderer.domElement,
        );
        controls.enableDamping = true;
        controls.dampingFactor = 0.06;
        controls.enablePan = false;
        controls.minDistance = 1.55;
        controls.maxDistance = 4;
        controls.autoRotate =
          !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        controls.autoRotateSpeed = 0.24;

        const globeScene: GlobeScene = {
          arcs: new runtime.THREE.Group(),
          camera,
          controls,
          hitCanvas,
          hitCountries: [undefined],
          points: null,
          raycaster: new runtime.THREE.Raycaster(),
          renderer,
          scene,
          sphere,
          texture,
          textureCanvas,
        };
        globeSceneRef.current = globeScene;
        drawWorldTexture({
          scene: globeScene,
          geometry,
          byId: new Map(),
          byName: new Map(),
          selectedMapId: null,
        });

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
          if (!document.hidden) {
            controls.update();
            renderer.render(scene, camera);
          }
          animationFrame = window.requestAnimationFrame(render);
        };
        render();
        setMapError(null);
      })
      .catch(() => {
        if (!cancelled) {
          setMapError("The interactive globe could not start on this device.");
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
        globeScene.texture.dispose();
        globeScene.renderer.dispose();
      }
      globeSceneRef.current = null;
      geometryRef.current = null;
      runtimeRef.current = null;
      container.replaceChildren();
    };
  }, []);

  useEffect(() => {
    const globeScene = globeSceneRef.current;
    const geometry = geometryRef.current;
    if (!globeScene || !geometry) return;
    const timeout = window.setTimeout(() => {
      drawWorldTexture({
        scene: globeScene,
        geometry,
        byId: countryIndex.byId,
        byName: countryIndex.byName,
        selectedMapId,
      });
    }, 40);
    return () => window.clearTimeout(timeout);
  }, [countryIndex, selectedMapId, worldGeometry]);

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

  const locateCountry = (clientX: number, clientY: number) => {
    const globeScene = globeSceneRef.current;
    const runtime = runtimeRef.current;
    const canvas = globeScene?.renderer.domElement;
    if (!globeScene || !runtime || !canvas) return undefined;
    const bounds = canvas.getBoundingClientRect();
    const pointer = new runtime.THREE.Vector2(
      ((clientX - bounds.left) / bounds.width) * 2 - 1,
      -((clientY - bounds.top) / bounds.height) * 2 + 1,
    );
    globeScene.raycaster.setFromCamera(pointer, globeScene.camera);
    const intersection = globeScene.raycaster.intersectObject(
      globeScene.sphere,
      false,
    )[0];
    return intersection
      ? countryAtPoint(globeScene, intersection.point)
      : undefined;
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const { clientX, clientY } = event;
    if (hoverFrameRef.current != null) return;
    hoverFrameRef.current = window.requestAnimationFrame(() => {
      hoverFrameRef.current = null;
      const country = locateCountry(clientX, clientY);
      const bounds = event.currentTarget.getBoundingClientRect();
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

  return (
    <div
      className="world-globe relative h-full min-h-[420px] w-full overflow-hidden bg-[#050a11]"
      aria-label="Interactive 3D world news globe. Drag to rotate, scroll to zoom, and click or tap a country to open its news panel."
      role="region"
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
          Live intelligence globe
        </div>
        <h1 className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-white sm:text-3xl">
          The world, in context.
        </h1>
        <p className="mt-2 text-xs leading-relaxed text-[#aab5c5]">
          Drag to rotate. Scroll to zoom. Select any country.
        </p>
      </div>
      <div
        className="pointer-events-none absolute left-5 top-28 z-10 max-w-[calc(100%-2.5rem)] truncate rounded-full border border-[#354258] bg-[#0a121d]/90 px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-[#aab5c5] sm:left-auto sm:right-4 sm:top-4 sm:max-w-[420px]"
        role="status"
        aria-live="polite"
      >
        {statusLabel}
      </div>
      <div className="pointer-events-none absolute bottom-28 left-4 z-10 hidden items-center gap-3 rounded-full border border-[#273548] bg-[#07101a]/82 px-3 py-2 font-mono text-[9px] uppercase tracking-[0.15em] text-[#8392a6] sm:flex">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-[#73e2cc] shadow-[0_0_10px_#73e2cc]" />
          Verified signal
        </span>
        <span>Three.js / WebGL</span>
      </div>
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
                ? "Checking current country coverage…"
                : "No verified country-specific headline is currently indexed.")}
          </div>
          <div className="world-globe-tooltip__meta">
            {hovered.country.topEvent
              ? `${hovered.country.topEvent.category} · ${hovered.country.topEvent.importanceLabel}`
              : "Country feed ready"}
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
