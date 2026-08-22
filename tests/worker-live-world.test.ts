import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("vinext/server/app-router-entry", () => ({
  default: { fetch: vi.fn() },
}));

vi.mock("vinext/server/image-optimization", () => ({
  DEFAULT_DEVICE_SIZES: [],
  DEFAULT_IMAGE_SIZES: [],
  handleImageOptimization: vi.fn(),
}));

import worker from "../worker/index";

describe("live world delivery", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
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

  it("does not expose a duplicate on-demand collection path", async () => {
    const response = await worker.fetch(
      new Request("https://worldpulse.test/api/live-news?country=Canada"),
      {} as never,
      { waitUntil: vi.fn(), passThroughOnException: vi.fn() },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Unsupported live-news scope. Use scope=world-live.",
    });
  });

  it("proxies the prepared live response from the continuous Oracle server", async () => {
    const upstream = {
      scope: "world-live",
      generatedAt: "2026-08-22T00:00:00.000Z",
      refreshAfterSeconds: 60,
      provider: "Hemisphere Herald continuous Oracle country index",
      global: { scope: "global", articles: [] },
      countries: [],
    };
    const fetchMock = vi.fn(async () => Response.json(upstream));
    vi.stubGlobal("fetch", fetchMock);

    const response = await worker.fetch(
      new Request("https://worldpulse.test/api/live-news?scope=world-live"),
      { WORLD_PULSE_ORIGIN: "http://140-238-147-141.sslip.io" } as never,
      { waitUntil: vi.fn(), passThroughOnException: vi.fn() },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("X-WorldPulse-Source")).toBe(
      "continuous-oracle-server",
    );
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith(
      new URL(
        "http://140-238-147-141.sslip.io/api/live-news?scope=world-live",
      ),
      expect.objectContaining({
        headers: { Accept: "application/json" },
      }),
    );
    await expect(response.json()).resolves.toEqual(upstream);
  });
});
