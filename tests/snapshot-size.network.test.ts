import { describe, expect, it } from "vitest";
import { gunzipSync, gzipSync } from "node:zlib";
import {
  decodePreparedWorldNews,
  encodePreparedWorldNews,
  isPreparedWorldNewsWire,
} from "@/lib/snapshot-transport";
import type { PreparedWorldNewsPayload } from "@/lib/types";

const liveTest = process.env.WORLD_PULSE_LIVE_QA === "1" ? it : it.skip;
const LIVE_URL = "https://worldpulse-news-map.belowalo.chatgpt.site/api/live-news?scope=prepared-world";

describe("production prepared snapshot transport", () => {
  liveTest("fits the complete normalized world feed below one megabyte", async () => {
    const response = await fetch(LIVE_URL, {
      headers: { "Cache-Control": "no-cache" },
      signal: AbortSignal.timeout(30_000),
    });
    expect(response.ok).toBe(true);
    const responseBytes = Buffer.from(await response.arrayBuffer());
    const responseText =
      responseBytes[0] === 0x1f && responseBytes[1] === 0x8b
        ? gunzipSync(responseBytes).toString("utf8")
        : responseBytes.toString("utf8");
    const responsePayload = JSON.parse(responseText) as unknown;
    const payload = isPreparedWorldNewsWire(responsePayload)
      ? decodePreparedWorldNews(responsePayload)
      : (responsePayload as PreparedWorldNewsPayload);
    expect(payload.scope).toBe("prepared-world");
    expect(Object.keys(payload.countryFeeds)).toHaveLength(215);

    const bytes = gzipSync(
      JSON.stringify(
        isPreparedWorldNewsWire(responsePayload)
          ? responsePayload
          : encodePreparedWorldNews(payload),
      ),
    ).byteLength;
    expect(bytes).toBeLessThan(1_000_000);
  }, 30_000);
});
