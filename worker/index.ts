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

const LIVE_CACHE_NAME = "worldpulse-live-v3";
const LIVE_CACHE_FRESH_MS = 5 * 60_000;
const LIVE_CACHE_RETENTION_SECONDS = 24 * 60 * 60;

function normalizedLiveCacheKey(request: Request) {
  const url = new URL(request.url);
  url.hash = "";
  url.searchParams.delete("release");
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
  if (!response.ok) return;
  const payload = await response.text();
  const cachedAt = Date.now();
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
  const cached = await cache.match(cacheKey);
  if (cached) {
    const cachedAt = Number(cached.headers.get("X-WorldPulse-Cached-At"));
    const isFresh =
      Number.isFinite(cachedAt) && Date.now() - cachedAt < LIVE_CACHE_FRESH_MS;
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
        const isFresh =
          Date.now() - stored.generated_at < LIVE_CACHE_FRESH_MS;
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
