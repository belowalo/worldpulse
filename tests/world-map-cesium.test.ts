import { describe, expect, it, vi } from "vitest";
import {
  createCountryDataSource,
  SATELLITE_IMAGERY_BRIGHTNESS,
  updatePoints,
  type GlobePoint,
  type WorldFeatureCollection,
} from "@/components/world-map";
import { loadCesiumRuntime } from "@/lib/cesium-runtime";

describe("Cesium country overlays", () => {
  it("renders the satellite imagery below its default brightness", () => {
    expect(SATELLITE_IMAGERY_BRIGHTNESS).toBeGreaterThan(0.5);
    expect(SATELLITE_IMAGERY_BRIGHTNESS).toBeLessThan(1);
  });

  it("indexes every polygon entity produced from a multi-polygon country", async () => {
    const runtime = await loadCesiumRuntime();
    const geometry: WorldFeatureCollection = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          id: "multi-country",
          properties: { name: "Multi Country" },
          geometry: {
            type: "MultiPolygon",
            coordinates: [
              [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]],
              [[[2, 0], [3, 0], [3, 1], [2, 1], [2, 0]]],
            ],
          },
        },
        {
          type: "Feature",
          id: "single-country",
          properties: { name: "Single Country" },
          geometry: {
            type: "Polygon",
            coordinates: [
              [[4, 0], [5, 0], [5, 1], [4, 1], [4, 0]],
            ],
          },
        },
      ],
    };

    const { countryEntities, dataSource } = await createCountryDataSource(
      runtime,
      geometry,
    );

    expect(dataSource.entities.values).toHaveLength(3);
    expect(countryEntities).toHaveLength(3);
    expect(
      countryEntities.filter(
        (record) => record.featureId === "multi-country",
      ),
    ).toHaveLength(2);
    expect(
      countryEntities.filter(
        (record) => record.featureId === "single-country",
      ),
    ).toHaveLength(1);
    expect(countryEntities.every((record) => record.entity.polygon)).toBe(true);
  }, 15_000);

  it("keeps capital markers at a fixed ellipsoid position", async () => {
    const runtime = await loadCesiumRuntime();
    const markers = new runtime.CustomDataSource("test markers");
    const requestRender = vi.fn();
    const points: GlobePoint[] = [
      {
        capital: "Ottawa",
        color: "#ff4f68",
        country: {
          events: [],
          mapId: "124",
          name: "Canada",
        },
        lat: 45.4215,
        lng: -75.6972,
      },
    ];
    const scene = {
      markerCountries: new Map(),
      markers,
      runtime,
      viewer: { scene: { requestRender } },
    } as unknown as Parameters<typeof updatePoints>[0];

    updatePoints(scene, points);

    const marker = markers.entities.values[0];
    const time = runtime.JulianDate.now();
    const position = marker.position?.getValue(time);
    const cartographic = position
      ? runtime.Cartographic.fromCartesian(position)
      : undefined;
    expect(cartographic?.height).toBeCloseTo(8_000, 3);
    expect(marker.label?.heightReference?.getValue(time)).toBe(
      runtime.HeightReference.NONE,
    );
    expect(marker.label?.disableDepthTestDistance?.getValue(time)).toBe(0);
    expect(marker.label?.text?.getValue(time)).toBe("★");
    const scaleByDistance = marker.label?.scaleByDistance?.getValue(time);
    expect(scaleByDistance?.nearValue).toBeGreaterThan(
      scaleByDistance?.farValue ?? Number.POSITIVE_INFINITY,
    );
    expect(requestRender).toHaveBeenCalledOnce();
  }, 15_000);
});
