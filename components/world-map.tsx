"use client";

import * as maplibregl from "maplibre-gl";
import maplibreWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";
import {
  type ExpressionSpecification,
  type Map as MapLibreMap,
  type MapMouseEvent,
} from "maplibre-gl";
import { useEffect, useMemo, useRef, useState } from "react";
import { mapStyleForEvent } from "@/lib/scoring";
import type { MapCountry } from "@/lib/types";

export interface WorldMapProps {
  countries: MapCountry[];
  selectedMapId: string | null;
  onSelect: (country: MapCountry) => void;
  statusLabel?: string;
}

interface HoveredCountry {
  x: number;
  y: number;
  country: MapCountry;
}

const SOURCE_ID = "world-countries";
const FILL_LAYER = "country-fill";
const LINE_LAYER = "country-line";
const SELECTED_LAYER = "selected-country";

maplibregl.setWorkerUrl(maplibreWorkerUrl);

export function WorldMap({
  countries,
  selectedMapId,
  onSelect,
  statusLabel = "Live feed · auto-refresh",
}: WorldMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const onSelectRef = useRef(onSelect);
  const countriesRef = useRef(countries);
  const [hovered, setHovered] = useState<HoveredCountry | null>(null);
  useEffect(() => {
    onSelectRef.current = onSelect;
    countriesRef.current = countries;
  }, [countries, onSelect]);

  const colorExpression = useMemo(() => {
    const expression: unknown[] = ["match", ["to-string", ["id"]]];
    for (const country of countries) {
      expression.push(
        country.mapId,
        mapStyleForEvent(
          country.topEvent?.category,
          country.topEvent?.importanceScore,
        ).fillColor,
      );
    }
    expression.push("#354052");
    return expression as ExpressionSpecification;
  }, [countries]);

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
      "bottom-left",
    );
    map.addControl(
      new maplibregl.AttributionControl({
        compact: true,
        customAttribution: "Country geometry: geojson-world-map",
      }),
      "bottom-right",
    );
    const resizeObserver = new ResizeObserver(() => map.resize());
    resizeObserver.observe(containerRef.current);

    map.on("load", () => {
      map.addSource(SOURCE_ID, {
        type: "geojson",
        data: "/countries.geojson",
        generateId: false,
      });
      map.addLayer({
        id: FILL_LAYER,
        type: "fill",
        source: SOURCE_ID,
        paint: {
          "fill-color": colorExpression,
          "fill-opacity": 0.9,
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
        id: SELECTED_LAYER,
        type: "line",
        source: SOURCE_ID,
        filter: ["==", ["to-string", ["id"]], "__none__"],
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
      if (feature?.id == null) return undefined;
      const indexedCountry = countriesRef.current.find(
        (country) => country.mapId === String(feature.id),
      );
      if (indexedCountry) return indexedCountry;

      const name = feature.properties?.name;
      if (typeof name !== "string" || !name.trim()) return undefined;
      return {
        mapId: String(feature.id),
        name,
        events: [],
      } satisfies MapCountry;
    };

    map.on("mousemove", FILL_LAYER, (event: MapMouseEvent) => {
      const country = countryAt(event);
      map.getCanvas().style.cursor = country ? "pointer" : "";
      setHovered(
        country
          ? { x: event.point.x, y: event.point.y, country }
          : null,
      );
    });
    map.on("mouseleave", FILL_LAYER, () => {
      map.getCanvas().style.cursor = "";
      setHovered(null);
    });
    map.on("click", FILL_LAYER, (event: MapMouseEvent) => {
      const country = countryAt(event);
      if (country) onSelectRef.current(country);
    });

    mapRef.current = map;
    return () => {
      resizeObserver.disconnect();
      map.remove();
      mapRef.current = null;
    };
  }, [colorExpression]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map?.getLayer(FILL_LAYER)) return;
    map.setPaintProperty(FILL_LAYER, "fill-color", colorExpression);
  }, [colorExpression]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map?.getLayer(SELECTED_LAYER)) return;
    map.setFilter(SELECTED_LAYER, [
      "==",
      ["to-string", ["id"]],
      selectedMapId ?? "__none__",
    ]);
  }, [selectedMapId]);

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
      <div className="pointer-events-none absolute right-4 top-4 rounded-full border border-[#354258] bg-[#101827]/90 px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-[#aab5c5]">
        {statusLabel}
      </div>

      {hovered ? (
        <div
          className="pointer-events-none absolute z-20 w-64 rounded-xl border border-[#39475d] bg-[#0d1522]/95 p-3 shadow-2xl"
          style={{
            left: Math.min(hovered.x + 14, 640),
            top: Math.max(90, hovered.y - 24),
          }}
        >
          <div className="flex items-center justify-between gap-3">
            <span className="font-semibold text-white">
              {hovered.country.name}
            </span>
            <span className="font-mono text-xs text-[#73e2cc]">
              {hovered.country.topEvent?.importanceScore ?? "—"}
            </span>
          </div>
          {hovered.country.topEvent ? (
            <>
              <p className="mt-2 text-xs leading-relaxed text-[#d4dbe5]">
                {hovered.country.topEvent.headline}
              </p>
              <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.12em] text-[#8f9caf]">
                {hovered.country.topEvent.category} ·{" "}
                {hovered.country.topEvent.importanceLabel}
              </p>
            </>
          ) : (
            <p className="mt-2 text-xs text-[#8f9caf]">
              Click to load current reporting
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}
