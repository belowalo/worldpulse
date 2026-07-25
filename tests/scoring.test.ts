import { describe, expect, it } from "vitest";
import {
  calculateImportance,
  importanceLabel,
  mapStyleForEvent,
} from "@/lib/scoring";

describe("impact scoring", () => {
  it("handles missing values safely", () => {
    const result = calculateImportance({});
    expect(result.score).toBe(0);
    expect(result.label).toBe("Routine");
  });

  it("clamps a representative high-impact event", () => {
    const result = calculateImportance({
      independentSourceCount: 40,
      sourceCountryCount: 30,
      affectedCountryCount: 60,
      countrySignificance: 100,
      publisherProminence: 100,
      ageHours: 0,
      articlesPerHour: 20,
    });
    expect(result.score).toBe(100);
    expect(result.label).toBe("Major");
  });

  it.each([
    [0, "Routine"],
    [34, "Routine"],
    [35, "Developing"],
    [59, "Developing"],
    [60, "Significant"],
    [79, "Significant"],
    [80, "Major"],
    [100, "Major"],
  ])("labels score %i as %s", (score, expected) => {
    expect(importanceLabel(score)).toBe(expected);
  });

  it("makes higher scores visually more intense", () => {
    expect(mapStyleForEvent("Politics", 20).fillColor).not.toBe(
      mapStyleForEvent("Politics", 90).fillColor,
    );
  });

  it("gives countries without a current headline a visible neutral color", () => {
    expect(mapStyleForEvent().fillColor).toBe("#24444b");
  });
});
