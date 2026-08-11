import { describe, expect, it, vi } from "vitest";

import {
  COMPLETE_WORLD_COUNTRY_COUNT,
  fetchPreparedWorldCompressedFromServer,
  fetchPreparedWorldFromServer,
  hasCompleteWorldCardinality,
  isCompletePreparedWorld,
  isPreparedWorldFresh,
  isPreparedWorldGeneratedAtFresh,
} from "@/lib/prepared-world";
import { encodePreparedWorldNews } from "@/lib/snapshot-transport";
import type { PreparedWorldNewsPayload } from "@/lib/types";

function preparedWorld(countryNames: string[]): PreparedWorldNewsPayload {
  const generatedAt = "2026-08-11T12:00:00.000Z";
  const feed = {
    events: [],
    updatedAt: generatedAt,
    provider: "WorldPulse",
    loading: false as const,
    error: null,
  };
  return {
    scope: "prepared-world",
    version: "test",
    generatedAt,
    refreshAfterSeconds: 60,
    globalFeed: feed,
    countryFeeds: Object.fromEntries(
      countryNames.map((countryName) => [countryName, { ...feed }]),
    ),
  };
}

describe("complete server world state", () => {
  it("accepts only a snapshot containing every expected country", () => {
    const names = ["Canada", "United States"];
    const complete = preparedWorld(names);
    const incomplete = preparedWorld(["Canada"]);

    expect(isCompletePreparedWorld(complete, names)).toBe(true);
    expect(isCompletePreparedWorld(incomplete, names)).toBe(false);
  });

  it("requires the production world cardinality before server rendering", () => {
    const names = Array.from(
      { length: COMPLETE_WORLD_COUNTRY_COUNT },
      (_, index) => `Country ${index}`,
    );

    expect(hasCompleteWorldCardinality(preparedWorld(names))).toBe(true);
    expect(hasCompleteWorldCardinality(preparedWorld(names.slice(1)))).toBe(
      false,
    );
  });

  it("rejects stale server snapshots", () => {
    const payload = preparedWorld(["Canada"]);
    const generatedAt = Date.parse(payload.generatedAt);

    expect(isPreparedWorldFresh(payload, generatedAt + 60_000)).toBe(true);
    expect(isPreparedWorldFresh(payload, generatedAt + 4 * 60_000)).toBe(
      false,
    );
    expect(
      isPreparedWorldGeneratedAtFresh(
        payload.generatedAt,
        generatedAt + 60_000,
      ),
    ).toBe(true);
    expect(
      isPreparedWorldGeneratedAtFresh(
        payload.generatedAt,
        generatedAt + 4 * 60_000,
      ),
    ).toBe(false);
  });

  it("loads the complete snapshot through the server API with no cache", async () => {
    const payload = preparedWorld(["Canada"]);
    const fetchMock = vi.fn(async () => Response.json(payload));

    await expect(
      fetchPreparedWorldFromServer(
        "https://worldpulse.test",
        fetchMock as unknown as typeof fetch,
      ),
    ).resolves.toEqual(payload);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://worldpulse.test/api/live-news?scope=prepared-world&plain=1",
      { cache: "no-store" },
    );
  });

  it("keeps the compressed payload intact for the server-to-browser handoff", async () => {
    const payload = preparedWorld(["Canada"]);
    const wire = encodePreparedWorldNews(payload);
    const bytes = new TextEncoder().encode(JSON.stringify(wire));
    const fetchMock = vi.fn(async () =>
      new Response(bytes, {
        headers: {
          "X-WorldPulse-Country-Count": "215",
          "X-WorldPulse-Snapshot-Generated-At": payload.generatedAt,
        },
      }),
    );

    const result = await fetchPreparedWorldCompressedFromServer(
      "https://worldpulse.test",
      fetchMock as unknown as typeof fetch,
    );

    expect(result.countryCount).toBe(215);
    expect(result.generatedAt).toBe(payload.generatedAt);
    expect([
      ...Uint8Array.from(atob(result.compressed), (character) =>
        character.charCodeAt(0),
      ),
    ]).toEqual([...bytes]);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://worldpulse.test/api/live-news?scope=prepared-world",
      { cache: "no-store" },
    );
  });
});
