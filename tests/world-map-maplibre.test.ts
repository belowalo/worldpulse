import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { GLOBE_PERFORMANCE_PROFILE } from "@/components/world-map-maplibre";

describe("optimized MapLibre globe", () => {
  const source = readFileSync(
    resolve(process.cwd(), "components/world-map-maplibre.tsx"),
    "utf8",
  );

  it("loads the renderer on demand and keeps a bounded rendering profile", () => {
    expect(source).toContain('import("maplibre-gl")');
    expect(source).toContain('data-globe-engine="maplibre-gl"');
    expect(GLOBE_PERFORMANCE_PROFILE).toMatchObject({
      antialias: false,
      maxTileCacheSize: 32,
      pixelRatioLimit: 1,
      terrainMaxLevel: 11,
    });
  });

  it("uses native raster DEM terrain instead of decoding terrain on the UI thread", () => {
    expect(source).toContain('type: "raster-dem"');
    expect(source).toContain('encoding: "terrarium"');
    expect(source).not.toContain("createImageBitmap");
    expect(source).not.toContain("getImageData(0, 0, bitmap.width");
  });
});
