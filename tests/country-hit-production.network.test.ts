import { describe, expect, it } from "vitest";
import {
  buildCountryHitIndex,
  countryFeatureAtCoordinates,
  type WorldFeatureCollection,
} from "@/lib/country-hit-test";

const liveTest = process.env.WORLD_PULSE_LIVE_QA === "1" ? it : it.skip;
const GEOMETRY_URL = "https://worldpulse.belowalo2005.workers.dev/api/world-geometry";

describe("deployed globe country geometry", () => {
  liveTest("maps small islands to the country rendered under the pointer", async () => {
    const response = await fetch(GEOMETRY_URL, {
      headers: { "Cache-Control": "no-cache" },
      signal: AbortSignal.timeout(20_000),
    });
    expect(response.ok).toBe(true);
    const index = buildCountryHitIndex((await response.json()) as WorldFeatureCollection);
    const countryAt = (longitude: number, latitude: number) =>
      countryFeatureAtCoordinates(index, longitude, latitude)?.name;

    expect(countryAt(2.9, 39.6)).toBe("Spain");
    expect(countryAt(4.1, 39.95)).toBe("Spain");
    expect(countryAt(-15.5, 28.1)).toBe("Spain");
    expect(countryAt(-59.55, 13.18)).toBe("Barbados");
    expect(countryAt(-61.37, 15.4)).toBe("Dominica");
    expect(countryAt(-61.68, 12.12)).toBe("Grenada");
    expect(countryAt(-61.28, 10.48)).toBe("Trinidad and Tobago");
  });
});
