import { describe, expect, it, vi } from "vitest";

vi.mock("vinext/server/app-router-entry", () => ({
  default: { fetch: vi.fn() },
}));

vi.mock("vinext/server/image-optimization", () => ({
  DEFAULT_DEVICE_SIZES: [],
  DEFAULT_IMAGE_SIZES: [],
  handleImageOptimization: vi.fn(),
}));

import worker from "../worker/index";

describe("prepared world delivery", () => {
  it("returns a stale complete snapshot without waiting for its background refresh", async () => {
    const body = JSON.stringify({
      scope: "prepared-world",
      generatedAt: "2026-07-25T00:00:00.000Z",
      globalFeed: {},
      countryFeeds: {},
    });
    const bytes = new TextEncoder().encode(body);
    const current = {
      body: new Response(bytes).body,
      customMetadata: {
        generatedAt: "2026-07-25T00:00:00.000Z",
        encoding: "gzip",
        countryCount: "215",
      },
      arrayBuffer: vi.fn(async () => bytes.buffer),
    };
    const neverFinishes = new Promise<never>(() => undefined);
    const env = {
      SNAPSHOTS: {
        get: vi.fn(async () => current),
      },
      DB: {
        prepare: vi.fn(() => ({})),
        batch: vi.fn(() => neverFinishes),
      },
    };
    const backgroundTasks: Promise<unknown>[] = [];
    const context = {
      waitUntil: vi.fn((promise: Promise<unknown>) => {
        backgroundTasks.push(promise);
      }),
      passThroughOnException: vi.fn(),
    };

    const result = await Promise.race([
      worker.fetch(
        new Request(
          "https://worldpulse.test/api/live-news?scope=prepared-world",
        ),
        env as never,
        context,
      ),
      new Promise<"timeout">((resolve) => {
        window.setTimeout(() => resolve("timeout"), 100);
      }),
    ]);

    expect(result).not.toBe("timeout");
    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(200);
    expect(await (result as Response).text()).toBe(body);
    expect(context.waitUntil).toHaveBeenCalledOnce();
    expect(backgroundTasks).toHaveLength(1);
  });
});
