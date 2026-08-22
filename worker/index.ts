/** Cloudflare Worker entry point for Hemisphere Herald. */
import {
  DEFAULT_DEVICE_SIZES,
  DEFAULT_IMAGE_SIZES,
  handleImageOptimization,
} from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";
import {
  readStoredNewsFeed,
  writeStoredNewsFeed,
} from "../db/news-cache";
import { countryCodeForName } from "../lib/country-locale";
import type {
  MapCountry,
} from "../lib/types";
import { mergeCachedPayloads } from "./live-cache";
import { handleLiveNews } from "./live-news";
import { handleLiveVideo } from "./live-video";
import worldGeometrySource from "../public/countries.geojson?raw";

interface Env {
  ASSETS: Fetcher;
  DB?: D1Database;
  WORLD_PULSE_ORIGIN?: string;
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: {
          format: string;
          quality: number;
        }): Promise<{ response(): Response }>;
      };
    };
  };
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

interface WorldGeometry {
  features?: Array<{
    id?: string | number;
    properties?: { name?: string };
  }>;
}

const LIVE_CACHE_NAME = "worldpulse-live-v20";
const LIVE_CACHE_FRESH_MS = 60_000;
const LIVE_CACHE_RETENTION_SECONDS = 3 * 24 * 60 * 60;
const LIVE_MAP_STALE_MS = LIVE_CACHE_RETENTION_SECONDS * 1_000;
let worldDirectoryCache: MapCountry[] | null = null;

function loadWorldDirectory() {
  if (worldDirectoryCache) return worldDirectoryCache;
  const geometry = JSON.parse(worldGeometrySource) as WorldGeometry;
  const directory = (geometry.features ?? []).flatMap((feature) => {
    const mapId = String(feature.id ?? "");
    const name = feature.properties?.name?.trim();
    if (!mapId || !name) return [];
    return [{
      mapId,
      name,
      iso2: countryCodeForName(name) ?? undefined,
      events: [],
    } satisfies MapCountry];
  });
  if (!directory.length) throw new Error("World geometry has no countries.");
  worldDirectoryCache = directory;
  return worldDirectoryCache;
}

function normalizedLiveCacheKey(request: Request) {
  const url = new URL(request.url);
  url.hash = "";
  url.searchParams.delete("release");
  url.searchParams.delete("fresh");
  url.searchParams.set("__wp_cache", "21");
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

async function mergeFreshResponse(fresh: Response, fallback: Response | null) {
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
      console.warn(JSON.stringify({
        event: "news_persistent_cache_merge_failed",
        error: error instanceof Error ? error.message : "unknown error",
      }));
    }
  }
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", `public, max-age=${LIVE_CACHE_RETENTION_SECONDS}`);
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
      writeStoredNewsFeed(db, cacheKey.url, payload, cachedAt).catch((error) => {
        console.warn(JSON.stringify({
          event: "news_persistent_cache_write_failed",
          error: error instanceof Error ? error.message : "unknown error",
        }));
      }),
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
          Date.now() - stored.generated_at < LIVE_CACHE_RETENTION_SECONDS * 1_000
        ) {
          fallback = persistentResponse(stored.payload, stored.generated_at);
        }
      } catch (error) {
        console.warn(JSON.stringify({
          event: "news_persistent_cache_read_failed",
          error: error instanceof Error ? error.message : "unknown error",
        }));
      }
    }
    const fresh = await handleLiveNews(new Request(requestUrl, request));
    if (!fresh.ok && fallback) {
      return responseWithCacheState(fallback, "stale-if-error");
    }
    const merged = await mergeFreshResponse(fresh, fallback);
    await storeLiveResponse(cache, cacheKey, merged.clone(), env.DB);
    return responseWithCacheState(merged, "miss");
  }

  if (cached) {
    const cachedAt = Number(cached.headers.get("X-WorldPulse-Cached-At"));
    const cacheAge = Number.isFinite(cachedAt)
      ? Date.now() - cachedAt
      : Number.POSITIVE_INFINITY;
    const isFresh = cacheAge < LIVE_CACHE_FRESH_MS;
    const canStreamMapWhileRefreshing = isMapSearch && cacheAge < LIVE_MAP_STALE_MS;
    if (!isFresh && isMapSearch && !canStreamMapWhileRefreshing) {
      const fresh = await handleLiveNews(cacheKey);
      if (!fresh.ok) return responseWithCacheState(cached, "stale-if-error");
      const merged = await mergeFreshResponse(fresh, cached.clone());
      ctx.waitUntil(storeLiveResponse(cache, cacheKey, merged.clone(), env.DB));
      return responseWithCacheState(merged, "miss");
    }
    if (!isFresh) ctx.waitUntil(refreshLiveResponse(cache, cacheKey, env.DB));
    return responseWithCacheState(cached, isFresh ? "hit" : "refreshing");
  }

  if (env.DB) {
    try {
      const stored = await readStoredNewsFeed(env.DB, cacheKey.url);
      if (
        stored &&
        Date.now() - stored.generated_at < LIVE_CACHE_RETENTION_SECONDS * 1_000
      ) {
        const storedResponse = persistentResponse(stored.payload, stored.generated_at);
        const storedAge = Date.now() - stored.generated_at;
        const isFresh = storedAge < LIVE_CACHE_FRESH_MS;
        if (!(isMapSearch && storedAge >= LIVE_MAP_STALE_MS)) {
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
      console.warn(JSON.stringify({
        event: "news_persistent_cache_read_failed",
        error: error instanceof Error ? error.message : "unknown error",
      }));
    }
  }

  const fresh = await handleLiveNews(request);
  if (fresh.ok) {
    ctx.waitUntil(storeLiveResponse(cache, cacheKey, fresh.clone(), env.DB));
  }
  return responseWithCacheState(fresh, "miss");
}

async function proxyOracleLiveServer(env: Env, pathAndQuery: string) {
  const configuredOrigin = env.WORLD_PULSE_ORIGIN?.trim();
  if (!configuredOrigin) {
    return Response.json(
      { error: "The continuous live news server is not configured." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
  try {
    const upstreamUrl = new URL(pathAndQuery, configuredOrigin);
    const upstream = await fetch(upstreamUrl, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
    const headers = new Headers({
      "Cache-Control": "no-store",
      "Content-Type":
        upstream.headers.get("Content-Type") ??
        "application/json; charset=utf-8",
      "X-WorldPulse-Source": "continuous-oracle-server",
    });
    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers,
    });
  } catch (error) {
    console.error(JSON.stringify({
      event: "oracle_live_server_unavailable",
      error: error instanceof Error ? error.message : "unknown error",
    }));
    return Response.json(
      { error: "The continuous live news server is temporarily unavailable." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}

const worker = {
  scheduled() {
    // A legacy Cloudflare cron trigger still targets this Worker. The Oracle
    // collector owns live refreshes, so the browser-facing Worker has no work
    // to perform for scheduled events.
  },
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const url = new URL(request.url);

    if (url.pathname === "/api/live-news") {
      if (url.searchParams.get("scope") === "world-live") {
        return proxyOracleLiveServer(
          env,
          "/api/live-news?scope=world-live",
        );
      }
      if (
        url.searchParams.get("scope") === "prepared-world" ||
        url.searchParams.get("scope") === "snapshot" ||
        url.searchParams.get("snapshot") === "1"
      ) {
        return Response.json(
          { error: "Snapshot endpoints have been removed. Use scope=world-live." },
          { status: 410, headers: { "Cache-Control": "no-store" } },
        );
      }
      return handleCachedLiveNews(request, env, ctx);
    }

    if (url.pathname === "/api/diagnostics/world") {
      return proxyOracleLiveServer(env, "/api/diagnostics/world");
    }

    if (url.pathname === "/api/world-directory") {
      return Response.json(
        {
          countries: loadWorldDirectory().map(({ mapId, name, iso2 }) => ({
            mapId,
            name,
            iso2,
          })),
        },
        {
          headers: {
            "Cache-Control":
              "public, max-age=86400, stale-while-revalidate=604800",
          },
        },
      );
    }

    if (url.pathname === "/api/world-geometry") {
      return new Response(worldGeometrySource, {
        headers: {
          "Cache-Control":
            "public, max-age=86400, stale-while-revalidate=604800",
          "Content-Type": "application/geo+json; charset=utf-8",
        },
      });
    }

    if (url.pathname === "/api/live-video") return handleLiveVideo(request);

    if (url.pathname === "/_vinext/image") {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      return handleImageOptimization(
        request,
        {
          fetchAsset: (path) =>
            env.ASSETS.fetch(new Request(new URL(path, request.url))),
          transformImage: async (body, { width, format, quality }) => {
            const result = await env.IMAGES.input(body)
              .transform(width > 0 ? { width } : {})
              .output({ format, quality });
            return result.response();
          },
        },
        allowedWidths,
      );
    }

    return handler.fetch(request, env, ctx);
  },
};

export default worker;
