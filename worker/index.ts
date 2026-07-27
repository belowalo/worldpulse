/** Cloudflare Worker entry point for the vinext-starter template. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";
import {
  readStoredNewsFeed,
  writeStoredNewsFeed,
} from "../db/news-cache";
import { handleLiveNews } from "./live-news";

interface Env {
  ASSETS: Fetcher;
  DB?: D1Database;
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

const LIVE_CACHE_NAME = "worldpulse-live-v17";
const LIVE_CACHE_FRESH_MS = 5 * 60_000;
const LIVE_MAP_STALE_MS = 30 * 60_000;
const LIVE_CACHE_RETENTION_SECONDS = 24 * 60 * 60;
const ARTICLE_RETENTION_MS = 8 * 24 * 60 * 60_000;

type JsonRecord = Record<string, unknown>;

function isJsonRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function cachedArticleKey(article: JsonRecord) {
  for (const field of ["url", "id", "title"]) {
    const value = article[field];
    if (typeof value === "string" && value) return `${field}:${value}`;
  }
  return JSON.stringify(article);
}

function mergeCachedArticles(
  freshArticles: unknown,
  storedArticles: unknown,
  limit: number,
) {
  const merged = new Map<string, JsonRecord>();
  for (const candidate of [
    ...(Array.isArray(freshArticles) ? freshArticles : []),
    ...(Array.isArray(storedArticles) ? storedArticles : []),
  ]) {
    if (!isJsonRecord(candidate)) continue;
    const publishedAt = candidate.publishedAt;
    if (
      typeof publishedAt === "string" &&
      Number.isFinite(Date.parse(publishedAt)) &&
      Date.now() - Date.parse(publishedAt) > ARTICLE_RETENTION_MS
    ) {
      continue;
    }
    const key = cachedArticleKey(candidate);
    if (!merged.has(key)) merged.set(key, candidate);
  }
  return [...merged.values()]
    .sort((left, right) => {
      const leftDate =
        typeof left.publishedAt === "string"
          ? Date.parse(left.publishedAt)
          : 0;
      const rightDate =
        typeof right.publishedAt === "string"
          ? Date.parse(right.publishedAt)
          : 0;
      return rightDate - leftDate;
    })
    .slice(0, limit);
}

function mergeCachedPayloads(freshText: string, storedText: string) {
  try {
    const fresh = JSON.parse(freshText) as unknown;
    const stored = JSON.parse(storedText) as unknown;
    if (!isJsonRecord(fresh) || !isJsonRecord(stored)) return freshText;

    if (fresh.scope === "map") {
      const storedCountries = new Map<string, JsonRecord>();
      for (const country of Array.isArray(stored.countries)
        ? stored.countries
        : []) {
        if (
          isJsonRecord(country) &&
          typeof country.countryName === "string"
        ) {
          storedCountries.set(country.countryName, country);
        }
      }
      const countries = (Array.isArray(fresh.countries)
        ? fresh.countries
        : []
      ).flatMap((country) => {
        if (
          !isJsonRecord(country) ||
          typeof country.countryName !== "string"
        ) {
          return [];
        }
        const previous = storedCountries.get(country.countryName);
        return [
          {
            ...previous,
            ...country,
            articles: mergeCachedArticles(
              country.articles,
              previous?.articles,
              32,
            ),
          },
        ];
      });
      return JSON.stringify({ ...stored, ...fresh, countries });
    }

    const limit =
      fresh.scope === "global" ? 700 : fresh.scope === "event" ? 40 : 180;
    return JSON.stringify({
      ...stored,
      ...fresh,
      articles: mergeCachedArticles(
        fresh.articles,
        stored.articles,
        limit,
      ),
    });
  } catch {
    return freshText;
  }
}

function normalizedLiveCacheKey(request: Request) {
  const url = new URL(request.url);
  url.hash = "";
  url.searchParams.delete("release");
  url.searchParams.delete("fresh");
  url.searchParams.set("__wp_cache", "17");
  url.searchParams.sort();
  return new Request(url.toString(), { method: "GET" });
}

function responseWithCacheState(
  response: Response,
  state: "hit" | "miss" | "refreshing",
) {
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", "public, max-age=30, must-revalidate");
  headers.set("X-WorldPulse-Cache", state);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

async function storeLiveResponse(
  cache: Cache,
  cacheKey: Request,
  response: Response,
  db?: D1Database,
) {
  if (
    !response.ok ||
    response.headers.get("Cache-Control")?.toLowerCase().includes("no-store")
  ) {
    return;
  }
  let payload = await response.text();
  const cachedAt = Date.now();
  if (db) {
    try {
      const stored = await readStoredNewsFeed(db, cacheKey.url);
      if (stored) payload = mergeCachedPayloads(payload, stored.payload);
    } catch (error) {
      console.warn(
        JSON.stringify({
          event: "news_persistent_cache_merge_failed",
          error: error instanceof Error ? error.message : "unknown error",
        }),
      );
    }
  }
  const headers = new Headers(response.headers);
  headers.set(
    "Cache-Control",
    `public, max-age=${LIVE_CACHE_RETENTION_SECONDS}`,
  );
  headers.set("X-WorldPulse-Cached-At", String(cachedAt));
  const writes: Promise<unknown>[] = [
    cache.put(
      cacheKey,
      new Response(payload, {
        status: response.status,
        statusText: response.statusText,
        headers,
      }),
    ),
  ];
  if (db) {
    writes.push(
      writeStoredNewsFeed(db, cacheKey.url, payload, cachedAt).catch(
        (error) => {
          console.warn(
            JSON.stringify({
              event: "news_persistent_cache_write_failed",
              error: error instanceof Error ? error.message : "unknown error",
            }),
          );
        },
      ),
    );
  }
  await Promise.all(writes);
}

async function refreshLiveResponse(
  cache: Cache,
  cacheKey: Request,
  db?: D1Database,
) {
  const fresh = await handleLiveNews(cacheKey);
  await storeLiveResponse(cache, cacheKey, fresh, db);
}

async function handleCachedLiveNews(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
) {
  if (request.method !== "GET") return handleLiveNews(request);

  const cache = await caches.open(LIVE_CACHE_NAME);
  const cacheKey = normalizedLiveCacheKey(request);
  const requestUrl = new URL(request.url);
  const isMapSearch = requestUrl.searchParams.get("scope") === "map";
  const forceFresh = requestUrl.searchParams.get("fresh") === "1";
  if (forceFresh) {
    requestUrl.searchParams.delete("fresh");
    const fresh = await handleLiveNews(new Request(requestUrl, request));
    ctx.waitUntil(
      storeLiveResponse(cache, cacheKey, fresh.clone(), env.DB),
    );
    return responseWithCacheState(fresh, "miss");
  }

  const cached = await cache.match(cacheKey);
  if (cached) {
    const cachedAt = Number(cached.headers.get("X-WorldPulse-Cached-At"));
    const cacheAge = Number.isFinite(cachedAt)
      ? Date.now() - cachedAt
      : Number.POSITIVE_INFINITY;
    const isFresh =
      Number.isFinite(cachedAt) && cacheAge < LIVE_CACHE_FRESH_MS;
    const canStreamMapWhileRefreshing =
      isMapSearch && cacheAge < LIVE_MAP_STALE_MS;
    if (!isFresh && isMapSearch && !canStreamMapWhileRefreshing) {
      const fresh = await handleLiveNews(cacheKey);
      ctx.waitUntil(
        storeLiveResponse(cache, cacheKey, fresh.clone(), env.DB),
      );
      return responseWithCacheState(fresh, "miss");
    }
    if (!isFresh) {
      ctx.waitUntil(refreshLiveResponse(cache, cacheKey, env.DB));
    }
    return responseWithCacheState(cached, isFresh ? "hit" : "refreshing");
  }

  if (env.DB) {
    try {
      const stored = await readStoredNewsFeed(env.DB, cacheKey.url);
      if (
        stored &&
        Date.now() - stored.generated_at <
          LIVE_CACHE_RETENTION_SECONDS * 1_000
      ) {
        const headers = new Headers({
          "Cache-Control": `public, max-age=${LIVE_CACHE_RETENTION_SECONDS}`,
          "Content-Type": "application/json; charset=utf-8",
          "X-WorldPulse-Cached-At": String(stored.generated_at),
        });
        const persistentResponse = new Response(stored.payload, { headers });
        const storedAge = Date.now() - stored.generated_at;
        const isFresh =
          storedAge < LIVE_CACHE_FRESH_MS;
        if (
          !isFresh &&
          isMapSearch &&
          storedAge >= LIVE_MAP_STALE_MS
        ) {
          // A genuinely old map index is not shown. Continue to a direct live
          // request below instead.
        } else {
          ctx.waitUntil(
            isFresh
              ? cache.put(cacheKey, persistentResponse.clone())
              : refreshLiveResponse(cache, cacheKey, env.DB),
          );
          return responseWithCacheState(
            persistentResponse,
            isFresh ? "hit" : "refreshing",
          );
        }
      }
    } catch (error) {
      console.warn(
        JSON.stringify({
          event: "news_persistent_cache_read_failed",
          error: error instanceof Error ? error.message : "unknown error",
        }),
      );
    }
  }

  const fresh = await handleLiveNews(request);
  if (fresh.ok) {
    ctx.waitUntil(storeLiveResponse(cache, cacheKey, fresh.clone(), env.DB));
  }
  return responseWithCacheState(fresh, "miss");
}

// Image security config. SVG sources with .svg extension auto-skip the
// optimization endpoint on the client side (served directly, no proxy).
// To route SVGs through the optimizer (with security headers), set
// dangerouslyAllowSVG: true in next.config.js and uncomment below:
// const imageConfig: ImageConfig = { dangerouslyAllowSVG: true };

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/live-news") {
      return handleCachedLiveNews(request, env, ctx);
    }

    if (url.pathname === "/_vinext/image") {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      return handleImageOptimization(request, {
        fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
        transformImage: async (body, { width, format, quality }) => {
          const result = await env.IMAGES.input(body).transform(width > 0 ? { width } : {}).output({ format, quality });
          return result.response();
        },
      }, allowedWidths);
    }

    return handler.fetch(request, env, ctx);
  },
};

export default worker;
