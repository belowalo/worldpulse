import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { GLOBE_PERFORMANCE_PROFILE } from "@/components/world-map-maplibre";

describe("optimized MapLibre globe", () => {
  const source = readFileSync(
    resolve(process.cwd(), "components/world-map-maplibre.tsx"),
    "utf8",
  );

  it("loads the renderer on demand with a full-resolution rendering profile", () => {
    expect(source).toContain('import("maplibre-gl")');
    expect(source).toContain('data-globe-engine="maplibre-gl"');
    expect(source).toContain('"/api/world-geometry"');
    expect(GLOBE_PERFORMANCE_PROFILE).toMatchObject({
      antialias: true,
      imageryMaxLevel: 14,
      maxTileCacheSize: 64,
      terrainMaxLevel: 15,
    });
    expect(source).toContain('powerPreference: "high-performance"');
    expect(source).toContain("pixelRatio: window.devicePixelRatio || 1");
    expect(source).toContain("liveMap.isSourceLoaded(sourceId)");
    expect(source).not.toContain('liveMap.once("idle"');
    expect(source).not.toContain("terrainActivationZoom");
  });

  it("uses native raster DEM terrain instead of decoding terrain on the UI thread", () => {
    expect(source).toContain('type: "raster-dem"');
    expect(source).toContain('encoding: "terrarium"');
    expect(source).toContain(
      '"https://elevation-tiles-prod.s3.amazonaws.com/terrarium/{z}/{x}/{y}.png"',
    );
    expect(source).not.toContain(
      'const TERRAIN_TILE_URL = "/api/terrain/{z}/{x}/{y}"',
    );
    expect(source).not.toContain("createImageBitmap");
    expect(source).not.toContain("getImageData(0, 0, bitmap.width");
  });
});
