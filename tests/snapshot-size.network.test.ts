import { describe, expect, it } from "vitest";
import { gzipSync } from "node:zlib";
import { encodePreparedWorldNews } from "@/lib/snapshot-transport";
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
    const payload = (await response.json()) as PreparedWorldNewsPayload;
    expect(payload.scope).toBe("prepared-world");
    expect(Object.keys(payload.countryFeeds)).toHaveLength(215);

    const bytes = gzipSync(JSON.stringify(encodePreparedWorldNews(payload))).byteLength;
    expect(bytes).toBeLessThan(1_000_000);
  });
});
