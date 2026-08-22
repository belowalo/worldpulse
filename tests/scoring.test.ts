import { describe, expect, it } from "vitest";
import {
  calculateNewsSignal,
  categoryColor,
  mapStyleForEvent,
  signalLabel,
} from "@/lib/scoring";
import { CATEGORIES } from "@/lib/types";

describe("news signal scoring", () => {
  it("handles missing values safely", () => {
    const result = calculateNewsSignal({});
    expect(result.score).toBe(0);
    expect(result.label).toBe("Early");
  });

  it("clamps a strongly corroborated, fast-moving international signal", () => {
    const result = calculateNewsSignal({
      independentSourceCount: 40,
      affectedCountryCount: 60,
      ageHours: 0,
      articlesPerHour: 20,
      articleCount: 40,
      coverageWindowHours: 2,
    });
    expect(result.score).toBe(100);
    expect(result.label).toBe("Very strong");
  });

  it("keeps a single fresh report in the early tier", () => {
    const result = calculateNewsSignal({
      independentSourceCount: 1,
      affectedCountryCount: 1,
      ageHours: 0,
      articlesPerHour: 0,
      articleCount: 1,
      coverageWindowHours: 0,
    });
    expect(result.score).toBe(34);
    expect(result.label).toBe("Early");
    expect(result.components.reportingMomentum).toBe(0);
    expect(result.components.geographicReach).toBe(0);
  });

  it.each([
    [0, "Early"],
    [34, "Early"],
    [35, "Building"],
    [54, "Building"],
    [55, "Strong"],
    [74, "Strong"],
    [75, "Very strong"],
    [100, "Very strong"],
  ])("labels score %i as %s", (score, expected) => {
    expect(signalLabel(score)).toBe(expected);
  });

  it("makes higher scores visually more intense", () => {
    expect(mapStyleForEvent("Politics", 20).fillColor).not.toBe(
      mapStyleForEvent("Politics", 90).fillColor,
    );
  });

  it("gives countries without a current headline a visible neutral color", () => {
    expect(mapStyleForEvent().fillColor).toBe("#303a47");
  });

  it("assigns every category a distinct, visible map color", () => {
    const colors = CATEGORIES.map((category) => categoryColor(category));
    const mapColors = CATEGORIES.map(
      (category) => mapStyleForEvent(category, 50).fillColor,
    );

    expect(new Set(colors).size).toBe(CATEGORIES.length);
    expect(new Set(mapColors).size).toBe(CATEGORIES.length);
  });
});
