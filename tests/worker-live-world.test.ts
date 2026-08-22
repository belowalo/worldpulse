import { describe, expect, it, vi } from "vitest";

vi.mock("vinext/server/app-router-entry", () => ({
  default: { fetch: vi.fn() },
}));

vi.mock("vinext/server/image-optimization", () => ({
  DEFAULT_DEVICE_SIZES: [],
  DEFAULT_IMAGE_SIZES: [],
  handleImageOptimization: vi.fn(),
}));

import worker, {
  allCountryRefreshJobs,
  countryRefreshJobsForMinute,
} from "../worker/index";

describe("live world delivery", () => {
  it("covers every mapped country in bounded bootstrap jobs", () => {
    const jobs = allCountryRefreshJobs(
      new Date("2026-08-21T20:00:00.000Z"),
    );
    const countryNames = jobs.flatMap((job) => job.countries);

    expect(jobs).toHaveLength(43);
    expect(countryNames).toHaveLength(215);
    expect(new Set(countryNames).size).toBe(215);
    expect(jobs.every((job) => job.countries.length <= 5)).toBe(true);
  });

  it("schedules two bounded server-side country jobs per minute", () => {
    const jobs = countryRefreshJobsForMinute(
      new Date("2026-08-21T20:00:00.000Z"),
    );

    expect(jobs).toHaveLength(2);
    expect(jobs.every((job) => job.countries.length <= 5)).toBe(true);
    expect(new Set(jobs.flatMap((job) => job.countries)).size).toBe(
      jobs.flatMap((job) => job.countries).length,
    );
  });

  it("advances to different country jobs on the next minute", () => {
    const first = countryRefreshJobsForMinute(
      new Date("2026-08-21T20:00:00.000Z"),
    );
    const second = countryRefreshJobsForMinute(
      new Date("2026-08-21T20:01:00.000Z"),
    );

    expect(second.flatMap((job) => job.countries)).not.toEqual(
      first.flatMap((job) => job.countries),
    );
  });

  it("rejects the removed prepared snapshot endpoint", async () => {
    const response = await worker.fetch(
      new Request("https://worldpulse.test/api/live-news?scope=prepared-world"),
      {} as never,
      { waitUntil: vi.fn(), passThroughOnException: vi.fn() },
    );

    expect(response.status).toBe(410);
    await expect(response.json()).resolves.toEqual({
      error: "Snapshot endpoints have been removed. Use scope=world-live.",
    });
  });
});
