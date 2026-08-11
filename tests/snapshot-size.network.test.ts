import { describe, expect, it } from "vitest";
import { gunzipSync, gzipSync } from "node:zlib";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { countryCodeForName } from "@/lib/country-locale";
import { isPreparedWorldFresh } from "@/lib/prepared-world";
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
    expect(isPreparedWorldFresh(payload)).toBe(true);

    const geojson = JSON.parse(
      readFileSync(resolve("public/countries.geojson"), "utf8"),
    ) as {
      features: Array<{ properties: { name: string } }>;
    };
    const failures: string[] = [];
    let verifiedEvents = 0;
    for (const feature of geojson.features) {
      const countryName = feature.properties.name;
      const iso2 = countryCodeForName(countryName);
      const feed = payload.countryFeeds[countryName];
      if (!feed) {
        failures.push(`${countryName}: missing feed`);
        continue;
      }
      for (const event of feed.events) {
        verifiedEvents += 1;
        const age = Date.now() - Date.parse(event.lastUpdatedAt);
        if (!Number.isFinite(age) || age < -6 * 3_600_000 || age > 7 * 24 * 3_600_000) {
          failures.push(`${countryName}: story outside the seven-day window`);
        }
        if (
          event.primaryCountry !== countryName &&
          event.primaryCountry !== iso2 &&
          !event.affectedCountries.includes(countryName) &&
          !(iso2 && event.affectedCountries.includes(iso2))
        ) {
          failures.push(`${countryName}: unrelated story ${event.id}`);
        }
        if (
          !event.articles.length ||
          event.articles.some(
            (article) =>
              !article.source.publisherName.trim() ||
              !/^https?:\/\//u.test(article.originalUrl),
          )
        ) {
          failures.push(`${countryName}: invalid source metadata`);
        }
      }
    }
    process.stdout.write(
      `\nPrepared world audit: ${geojson.features.length} countries, ${verifiedEvents} country events, ${failures.length} failures.\n`,
    );
    expect(failures, failures.join("\n")).toEqual([]);

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
