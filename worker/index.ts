/** Cloudflare Worker entry point for the vinext-starter template. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";
import {
  readStoredMapFeeds,
  readStoredNewsFeed,
  writeStoredNewsFeed,
} from "../db/news-cache";
import { mergeCachedPayloads } from "./live-cache";
import { handleLiveNews, isLikelyEnglishHeadline } from "./live-news";

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

const LIVE_CACHE_NAME = "worldpulse-live-v19";
const LIVE_CACHE_FRESH_MS = 5 * 60_000;
const LIVE_CACHE_RETENTION_SECONDS = 3 * 24 * 60 * 60;
const LIVE_MAP_STALE_MS = LIVE_CACHE_RETENTION_SECONDS * 1_000;

interface StoredMapCountry {
  countryName: string;
  generatedAt: string;
  available: boolean;
  articles: unknown[];
}

function isStoredMapCountry(value: unknown): value is StoredMapCountry {
  if (!value || typeof value !== "object") return false;
  const country = value as Partial<StoredMapCountry>;
  return (
    typeof country.countryName === "string" &&
    typeof country.generatedAt === "string" &&
    Array.isArray(country.articles)
  );
}

async function handleWorldSnapshot(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
) {
  if (!env.DB) {
    return Response.json(
      { error: "The prepared world news snapshot is unavailable." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
  const storedFeeds = await readStoredMapFeeds(env.DB);
  const countries = new Map<string, StoredMapCountry>();
  let latestGeneratedAt = 0;
  for (const stored of storedFeeds) {
    try {
      const payload = JSON.parse(stored.payload) as {
        scope?: string;
        countries?: unknown[];
      };
      if (payload.scope !== "map" || !Array.isArray(payload.countries)) {
        continue;
      }
      latestGeneratedAt = Math.max(latestGeneratedAt, stored.generated_at);
      for (const candidate of payload.countries) {
        if (!isStoredMapCountry(candidate) || countries.has(candidate.countryName)) {
          continue;
        }
        const articles = candidate.articles.filter((article) => {
          if (!article || typeof article !== "object") return false;
          const title = (article as { title?: unknown }).title;
          return (
            typeof title === "string" &&
            isLikelyEnglishHeadline(title)
          );
        });
        countries.set(candidate.countryName, {
          ...candidate,
          articles,
          available: articles.length > 0,
        });
      }
    } catch {
      // Ignore a malformed historical cache row and continue with the others.
    }
  }
  const requestUrl = new URL(request.url);
  const requestedCountries = [
    ...new Set(
      (requestUrl.searchParams.get("countries") ?? "")
        .split("|")
        .map((country) => country.trim())
        .filter(Boolean),
    ),
  ];
  if (requestedCountries.length) {
    const batchSize = 12;
    const batchCount = Math.ceil(requestedCountries.length / batchSize);
    const batchIndex = Math.floor(Date.now() / 60_000) % batchCount;
    const refreshCountries = requestedCountries.slice(
      batchIndex * batchSize,
      (batchIndex + 1) * batchSize,
    );
    const refreshUrl = new URL(request.url);
    refreshUrl.searchParams.delete("snapshot");
    refreshUrl.searchParams.set("scope", "map");
    refreshUrl.searchParams.set("countries", refreshCountries.join("|"));
    refreshUrl.searchParams.set("fresh", "1");
    ctx.waitUntil(
      handleCachedLiveNews(
        new Request(refreshUrl.toString(), { method: "GET" }),
        env,
        ctx,
      ).then((response) => response.body?.cancel()),
    );
  }
  return Response.json(
    {
      scope: "map",
      generatedAt: new Date(latestGeneratedAt || Date.now()).toISOString(),
      refreshAfterSeconds: LIVE_CACHE_FRESH_MS / 1_000,
      provider: "WorldPulse",
      countries: [...countries.values()],
    },
    {
      headers: {
        "Cache-Control": "public, max-age=60, s-maxage=300, stale-while-revalidate=86400",
      },
    },
  );
}

function normalizedLiveCacheKey(request: Request) {
  const url = new URL(request.url);
  url.hash = "";
  url.searchParams.delete("release");
  url.searchParams.delete("fresh");
  url.searchParams.set("__wp_cache", "20");
  url.searchParams.sort();
  return new Request(url.toString(), { method: "GET" });
}

function responseWithCacheState(
  response: Response,
  state: "hit" | "miss" | "refreshing" | "stale-if-error",
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

function persistentResponse(payload: string, generatedAt: number) {
  return new Response(payload, {
    headers: {
      "Cache-Control": `public, max-age=${LIVE_CACHE_RETENTION_SECONDS}`,
      "Content-Type": "application/json; charset=utf-8",
      "X-WorldPulse-Cached-At": String(generatedAt),
    },
  });
}

async function mergeFreshResponse(
  fresh: Response,
  fallback: Response | null,
) {
  if (!fallback) return fresh;
  if (!fresh.ok) return responseWithCacheState(fallback, "stale-if-error");

  const [freshPayload, storedPayload] = await Promise.all([
    fresh.text(),
    fallback.text(),
  ]);
  const headers = new Headers(fresh.headers);
  headers.delete("content-length");
  return new Response(mergeCachedPayloads(freshPayload, storedPayload), {
    status: fresh.status,
    statusText: fresh.statusText,
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
  const cached = await cache.match(cacheKey);
  if (forceFresh) {
    requestUrl.searchParams.delete("fresh");
    let fallback = cached?.clone() ?? null;
    if (!fallback && env.DB) {
      try {
        const stored = await readStoredNewsFeed(env.DB, cacheKey.url);
        if (
          stored &&
          Date.now() - stored.generated_at <
            LIVE_CACHE_RETENTION_SECONDS * 1_000
        ) {
          fallback = persistentResponse(stored.payload, stored.generated_at);
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
    const fresh = await handleLiveNews(new Request(requestUrl, request));
    if (!fresh.ok && fallback) {
      return responseWithCacheState(fallback, "stale-if-error");
    }
    const merged = await mergeFreshResponse(fresh, fallback);
    ctx.waitUntil(
      storeLiveResponse(cache, cacheKey, merged.clone(), env.DB),
    );
    return responseWithCacheState(merged, "miss");
  }

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
      if (!fresh.ok) {
        return responseWithCacheState(cached, "stale-if-error");
      }
      const merged = await mergeFreshResponse(fresh, cached.clone());
      ctx.waitUntil(
        storeLiveResponse(cache, cacheKey, merged.clone(), env.DB),
      );
      return responseWithCacheState(merged, "miss");
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
        const storedResponse = persistentResponse(
          stored.payload,
          stored.generated_at,
        );
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
              ? cache.put(cacheKey, storedResponse.clone())
              : refreshLiveResponse(cache, cacheKey, env.DB),
          );
          return responseWithCacheState(
            storedResponse,
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
      if (
        url.searchParams.get("scope") === "snapshot" ||
        url.searchParams.get("snapshot") === "1"
      ) {
        return handleWorldSnapshot(request, env, ctx);
      }
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
