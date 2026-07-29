"use client";

import * as maplibregl from "maplibre-gl";
import maplibreWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";
import {
  type ExpressionSpecification,
  type GeoJSONSource,
  type Map as MapLibreMap,
  type MapMouseEvent,
} from "maplibre-gl";
import { useEffect, useMemo, useRef, useState } from "react";
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

interface HoveredCountry {
  x: number;
  y: number;
  country: MapCountry;
}

const SOURCE_ID = "world-countries";
const FILL_LAYER = "country-fill";
const LINE_LAYER = "country-line";
const EVENT_LINK_SOURCE = "event-links";
const EVENT_LINK_GLOW_LAYER = "event-link-glow";
const EVENT_LINK_LAYER = "event-link-line";
const EVENT_LINK_HIGHLIGHT_LAYER = "event-link-highlight";
const SELECTED_LAYER = "selected-country";

maplibregl.setWorkerUrl(maplibreWorkerUrl);

function buildCountryColorExpression(countries: MapCountry[]) {
  const expression: unknown[] = ["match", ["get", "name"]];
  for (const country of countries) {
    expression.push(
      country.name,
      mapStyleForEvent(
        country.topEvent?.category,
        country.topEvent?.importanceScore,
      ).fillColor,
    );
  }
  expression.push("#303a47");
  return expression as ExpressionSpecification;
}

export function WorldMap({
  countries,
  selectedMapId,
  onSelect,
  statusLabel = "Live feed · auto-refresh",
  linkEvents = [],
}: WorldMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const onSelectRef = useRef(onSelect);
  const countriesRef = useRef(countries);
  const selectedMapIdRef = useRef(selectedMapId);
  const hoverFrameRef = useRef<number | null>(null);
  const pendingHoverRef = useRef<HoveredCountry | null>(null);
  const [countryCenters, setCountryCenters] = useState<
    Record<string, MapPosition>
  >({});
  const [hovered, setHovered] = useState<HoveredCountry | null>(null);
  const countryIndex = useMemo(() => {
    const byName = new Map<string, MapCountry>();
    const byId = new Map<string, MapCountry>();
    for (const country of countries) {
      byName.set(country.name, country);
      byId.set(country.mapId, country);
    }
    return { byName, byId };
  }, [countries]);
  const countryIndexRef = useRef(countryIndex);
  useEffect(() => {
    onSelectRef.current = onSelect;
    countriesRef.current = countries;
    selectedMapIdRef.current = selectedMapId;
    countryIndexRef.current = countryIndex;
  }, [countries, countryIndex, onSelect, selectedMapId]);
  const colorExpression = useMemo(
    () => buildCountryColorExpression(countries),
    [countries],
  );
  const hoveredCountry = hovered
    ? (countryIndex.byId.get(hovered.country.mapId) ??
      countryIndex.byName.get(hovered.country.name) ??
      hovered.country)
    : null;
  const colorExpressionRef =
    useRef<ExpressionSpecification>(colorExpression);
  const eventLinks = useMemo(
    () =>
      buildEventLinkCollection({
        events: linkEvents,
        countries,
        selectedMapId,
        centers: countryCenters,
      }),
    [countries, countryCenters, linkEvents, selectedMapId],
  );
  const eventLinksRef = useRef(eventLinks);

  useEffect(() => {
    let cancelled = false;
    fetch("/countries.geojson")
      .then((response) => response.json())
      .then((collection) => {
        if (!cancelled) setCountryCenters(countryCentersFromGeoJson(collection));
      })
      .catch(() => {
        // Country fills and selection remain usable without the link overlay.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: {
        version: 8,
        sources: {},
        layers: [
          {
            id: "background",
            type: "background",
            paint: { "background-color": "#0b121d" },
          },
        ],
      },
      center: [8, 22],
      zoom: 0.55,
      minZoom: 0.35,
      maxZoom: 5,
      attributionControl: false,
      renderWorldCopies: false,
    });

    map.addControl(
      new maplibregl.NavigationControl({ showCompass: false }),
      "top-right",
    );
    map.addControl(
      new maplibregl.AttributionControl({
        compact: true,
        customAttribution: "Country geometry: geojson-world-map",
      }),
      "bottom-left",
    );
    const resizeObserver = new ResizeObserver(() => map.resize());
    resizeObserver.observe(containerRef.current);

    map.on("load", () => {
      map.addSource(SOURCE_ID, {
        type: "geojson",
        data: "/countries.geojson",
        generateId: false,
        promoteId: "name",
      });
      map.addSource(EVENT_LINK_SOURCE, {
        type: "geojson",
        data: eventLinksRef.current,
      });
      map.addLayer({
        id: FILL_LAYER,
        type: "fill",
        source: SOURCE_ID,
        paint: {
          "fill-color": colorExpressionRef.current,
          "fill-opacity": 0.94,
        },
      });
      map.addLayer({
        id: LINE_LAYER,
        type: "line",
        source: SOURCE_ID,
        paint: {
          "line-color": "#6f7d90",
          "line-opacity": 0.42,
          "line-width": 0.6,
        },
      });
      map.addLayer({
        id: EVENT_LINK_GLOW_LAYER,
        type: "line",
        source: EVENT_LINK_SOURCE,
        layout: {
          "line-cap": "round",
          "line-join": "round",
        },
        paint: {
          "line-blur": 5,
          "line-color": ["get", "color"],
          "line-opacity": 0.42,
          "line-width": [
            "interpolate",
            ["linear"],
            ["get", "importanceScore"],
            0,
            5,
            100,
            13,
          ],
        },
      });
      map.addLayer({
        id: EVENT_LINK_LAYER,
        type: "line",
        source: EVENT_LINK_SOURCE,
        layout: {
          "line-cap": "round",
          "line-join": "round",
        },
        paint: {
          "line-color": ["get", "color"],
          "line-opacity": 0.96,
          "line-width": [
            "interpolate",
            ["linear"],
            ["get", "importanceScore"],
            0,
            1.8,
            100,
            4.2,
          ],
        },
      });
      map.addLayer({
        id: EVENT_LINK_HIGHLIGHT_LAYER,
        type: "line",
        source: EVENT_LINK_SOURCE,
        layout: {
          "line-cap": "round",
          "line-join": "round",
        },
        paint: {
          "line-color": "#ecfffb",
          "line-opacity": [
            "interpolate",
            ["linear"],
            ["get", "importanceScore"],
            0,
            0.38,
            100,
            0.76,
          ],
          "line-width": [
            "interpolate",
            ["linear"],
            ["get", "importanceScore"],
            0,
            0.55,
            100,
            1.15,
          ],
        },
      });
      map.addLayer({
        id: SELECTED_LAYER,
        type: "line",
        source: SOURCE_ID,
        filter: [
          "==",
          ["get", "name"],
          countriesRef.current.find(
            (country) => country.mapId === selectedMapIdRef.current,
          )?.name ?? "__none__",
        ],
        paint: {
          "line-color": "#ffffff",
          "line-width": 2.4,
          "line-opacity": 0.95,
        },
      });
    });

    const countryAt = (event: MapMouseEvent) => {
      const feature = map.queryRenderedFeatures(event.point, {
        layers: [FILL_LAYER],
      })[0];
      if (!feature) return undefined;
      const name =
        typeof feature.properties?.name === "string"
          ? feature.properties.name.trim()
          : "";
      const indexedCountry =
        (name ? countryIndexRef.current.byName.get(name) : undefined) ??
        (feature.id != null
          ? countryIndexRef.current.byId.get(String(feature.id))
          : undefined);
      if (indexedCountry) return indexedCountry;

      if (!name) return undefined;
      return {
        mapId: feature.id == null ? `map-${name}` : String(feature.id),
        name,
        events: [],
      } satisfies MapCountry;
    };

    map.on("mousemove", FILL_LAYER, (event: MapMouseEvent) => {
      const country = countryAt(event);
      map.getCanvas().style.cursor = country ? "pointer" : "";
      const mapWidth = containerRef.current?.clientWidth ?? 720;
      const mapHeight = containerRef.current?.clientHeight ?? 520;
      pendingHoverRef.current = country
        ? {
            x: Math.max(12, Math.min(event.point.x + 14, mapWidth - 272)),
            y: Math.max(96, Math.min(event.point.y - 24, mapHeight - 150)),
            country,
          }
        : null;
      if (hoverFrameRef.current === null) {
        hoverFrameRef.current = window.requestAnimationFrame(() => {
          hoverFrameRef.current = null;
          setHovered(pendingHoverRef.current);
        });
      }
    });
    map.on("mouseleave", FILL_LAYER, () => {
      map.getCanvas().style.cursor = "";
      pendingHoverRef.current = null;
      if (hoverFrameRef.current !== null) {
        window.cancelAnimationFrame(hoverFrameRef.current);
        hoverFrameRef.current = null;
      }
      setHovered(null);
    });
    map.on("click", FILL_LAYER, (event: MapMouseEvent) => {
      const country = countryAt(event);
      if (country) onSelectRef.current(country);
    });

    mapRef.current = map;
    return () => {
      resizeObserver.disconnect();
      if (hoverFrameRef.current !== null) {
        window.cancelAnimationFrame(hoverFrameRef.current);
        hoverFrameRef.current = null;
      }
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    colorExpressionRef.current = colorExpression;
    const map = mapRef.current;
    if (!map?.getLayer(FILL_LAYER)) return;
    map.setPaintProperty(FILL_LAYER, "fill-color", colorExpression);
  }, [colorExpression]);

  useEffect(() => {
    eventLinksRef.current = eventLinks;
    const source = mapRef.current?.getSource(
      EVENT_LINK_SOURCE,
    ) as GeoJSONSource | null;
    source?.setData(eventLinks);
  }, [eventLinks]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map?.getLayer(SELECTED_LAYER)) return;
    const selectedCountryName = selectedMapId
      ? countryIndex.byId.get(selectedMapId)?.name
      : undefined;
    map.setFilter(SELECTED_LAYER, [
      "==",
      ["get", "name"],
      selectedCountryName ?? "__none__",
    ]);
  }, [countryIndex, selectedMapId]);

  return (
    <div
      className="relative h-full min-h-[420px] w-full overflow-hidden bg-[#0b121d]"
      aria-label="Interactive world news map. Click or tap a country to open its news panel."
      role="region"
    >
      <div
        ref={containerRef}
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
        }}
      />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-[#080d15]/55 to-transparent" />
      <div className="pointer-events-none absolute left-5 top-5 z-10 max-w-[250px]">
        <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-[#73e2cc]">
          Live impact map
        </div>
        <h1 className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-white sm:text-3xl">
          The world, in context.
        </h1>
        <p className="mt-2 text-xs leading-relaxed text-[#aab5c5]">
          Hue shows the topic. Intensity estimates impact.
        </p>
      </div>
      <div
        className="pointer-events-none absolute left-5 top-28 z-10 max-w-[calc(100%-2.5rem)] truncate rounded-full border border-[#354258] bg-[#101827]/90 px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-[#aab5c5] sm:left-auto sm:right-4 sm:top-4 sm:max-w-[420px]"
        role="status"
        aria-live="polite"
      >
        {statusLabel}
      </div>

      {hovered && hoveredCountry ? (
        <div
          className="pointer-events-none absolute z-20 w-64 rounded-xl border border-[#39475d] bg-[#0d1522]/95 p-3 shadow-2xl"
          style={{
            left: hovered.x,
            top: hovered.y,
          }}
        >
          <div className="flex items-center justify-between gap-3">
            <span className="font-semibold text-white">
              {hoveredCountry.name}
            </span>
            <span className="font-mono text-xs text-[#73e2cc]">
              {hoveredCountry.topEvent?.importanceScore ?? "—"}
            </span>
          </div>
          {hoveredCountry.topEvent ? (
            <>
              <p className="mt-2 text-xs leading-relaxed text-[#d4dbe5]">
                <span dir="auto">{hoveredCountry.topEvent.headline}</span>
              </p>
              <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.12em] text-[#8f9caf]">
                {hoveredCountry.topEvent.category} ·{" "}
                {hoveredCountry.topEvent.importanceLabel}
              </p>
            </>
          ) : (
            <p className="mt-2 text-xs text-[#8f9caf]">
              {hoveredCountry.signalReady === false
                ? "Checking current country coverage…"
                : "No verified country-specific headline is currently indexed."}
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}
