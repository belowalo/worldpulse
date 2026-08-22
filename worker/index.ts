/** Cloudflare Worker entry point for WorldPulse. */
import {
  DEFAULT_DEVICE_SIZES,
  DEFAULT_IMAGE_SIZES,
  handleImageOptimization,
} from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";
import {
  readLatestStoredGlobalFeed,
  readStoredCountryFeeds,
  readStoredMapFeeds,
  readStoredNewsFeed,
  writeStoredNewsFeed,
} from "../db/news-cache";
import { countryCodeForName } from "../lib/country-locale";
import type {
  LiveNewsPayload,
  LiveWorldNewsPayload,
  MapCountry,
  WorldPulseDiagnostics,
} from "../lib/types";
import { mergeCachedPayloads } from "./live-cache";
import {
  collectStoredCountryCountries,
  collectStoredMapCountries,
  mergeMapCountryPayloads,
} from "./map-cache";
import { handleLiveNews } from "./live-news";
import { handleLiveVideo } from "./live-video";
import worldGeometrySource from "../public/countries.geojson?raw";

interface Env {
  ASSETS: Fetcher;
  DB?: D1Database;
  NEWS_REFRESH_QUEUE?: Queue<CountryRefreshJob>;
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
const LIVE_COUNTRY_REFRESH_JOB_SIZE = 5;
const LIVE_COUNTRY_REFRESH_JOBS_PER_MINUTE = 2;

let worldDirectoryCache: MapCountry[] | null = null;

interface CountryRefreshJob {
  version: 1;
  scheduledAt: string;
  countries: string[];
}

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

async function refreshStoredGlobalFeed(env: Env) {
  if (!env.DB) return;
  const globalUrl = new URL("https://worldpulse.internal/api/live-news");
  globalUrl.searchParams.set("scope", "global");
  const cacheKey = normalizedLiveCacheKey(new Request(globalUrl)).url;
  const response = await handleLiveNews(new Request(globalUrl));
  if (!response.ok) return;
  let payload = await response.text();
  const previous = await readStoredNewsFeed(env.DB, cacheKey);
  if (previous) payload = mergeCachedPayloads(payload, previous.payload);
  await writeStoredNewsFeed(env.DB, cacheKey, payload, Date.now());
}

async function refreshStoredGlobalFeedSafely(env: Env) {
  try {
    await refreshStoredGlobalFeed(env);
  } catch (error) {
    console.error(JSON.stringify({
      event: "live_global_refresh_failed",
      error: error instanceof Error ? error.message : "unknown error",
    }));
  }
}

async function readLiveCountryIndex(env: Env) {
  if (!env.DB) return [];
  const countryNames = loadWorldDirectory().map((country) => country.name);
  const expectedCountries = new Set(countryNames);
  const [storedMapFeeds, storedCountryFeeds] = await Promise.all([
    readStoredMapFeeds(env.DB, 320),
    readStoredCountryFeeds(env.DB, [], 640),
  ]);
  const mapCountries = collectStoredMapCountries(
    storedMapFeeds,
    expectedCountries,
  ).countries;
  const directCountries = collectStoredCountryCountries(
    storedCountryFeeds,
    expectedCountries,
  ).countries;
  return mergeMapCountryPayloads(countryNames, mapCountries, directCountries);
}

export function allCountryRefreshJobs(date: Date) {
  const countryNames = loadWorldDirectory().map((country) => country.name);
  const groups: string[][] = [];
  for (
    let index = 0;
    index < countryNames.length;
    index += LIVE_COUNTRY_REFRESH_JOB_SIZE
  ) {
    groups.push(countryNames.slice(index, index + LIVE_COUNTRY_REFRESH_JOB_SIZE));
  }
  return groups.map((countries) => ({
    version: 1 as const,
    scheduledAt: date.toISOString(),
    countries,
  }));
}

export function countryRefreshJobsForMinute(date: Date) {
  const jobs = allCountryRefreshJobs(date);
  const minute = Math.floor(date.getTime() / 60_000);
  const firstGroup =
    (minute * LIVE_COUNTRY_REFRESH_JOBS_PER_MINUTE) % jobs.length;
  return Array.from(
    { length: LIVE_COUNTRY_REFRESH_JOBS_PER_MINUTE },
    (_, offset) => jobs[(firstGroup + offset) % jobs.length],
  );
}

async function refreshLiveCountries(env: Env, countryNames: string[]) {
  if (!env.DB || !countryNames.length) return;
  const mapUrl = new URL("https://worldpulse.internal/api/live-news");
  mapUrl.searchParams.set("scope", "map");
  mapUrl.searchParams.set("countries", countryNames.join("|"));
  const response = await handleLiveNews(new Request(mapUrl));
  if (!response.ok) throw new Error("Live country refresh failed.");
  const cacheKey = normalizedLiveCacheKey(new Request(mapUrl)).url;
  let payload = await response.text();
  const previous = await readStoredNewsFeed(env.DB, cacheKey);
  if (previous) payload = mergeCachedPayloads(payload, previous.payload);
  await writeStoredNewsFeed(env.DB, cacheKey, payload, Date.now());
  console.info(JSON.stringify({
    event: "live_country_refresh_completed",
    countries: countryNames,
  }));
}

async function enqueueCountryRefreshJobs(env: Env, date: Date) {
  if (!env.NEWS_REFRESH_QUEUE) {
    console.error(JSON.stringify({ event: "news_refresh_queue_unavailable" }));
    return;
  }
  const hasCountryIndex = env.DB
    ? (await readStoredMapFeeds(env.DB, 1)).length > 0
    : true;
  const jobs = hasCountryIndex
    ? countryRefreshJobsForMinute(date)
    : allCountryRefreshJobs(date);
  await env.NEWS_REFRESH_QUEUE.sendBatch(
    jobs.map((body) => ({ body, contentType: "json" as const })),
  );
  console.info(JSON.stringify({
    event: "news_refresh_jobs_enqueued",
    bootstrap: !hasCountryIndex,
    jobs: jobs.length,
    countries: jobs.flatMap((job) => job.countries),
  }));
}

async function currentGlobalFeed(env: Env) {
  if (!env.DB) return null;
  const stored = await readLatestStoredGlobalFeed(env.DB);
  if (stored) {
    try {
      const payload = JSON.parse(stored.payload) as LiveNewsPayload;
      if (payload.scope === "global" && Array.isArray(payload.articles)) {
        return payload;
      }
    } catch {
      console.error(JSON.stringify({ event: "live_global_record_invalid" }));
    }
  }
  return null;
}

async function handleLiveWorld(env: Env) {
  if (!env.DB) {
    return Response.json(
      { error: "The live world news index is unavailable." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
  const [countries, global] = await Promise.all([
    readLiveCountryIndex(env),
    currentGlobalFeed(env),
  ]);
  if (!global) {
    return Response.json(
      { error: "Current global reporting is unavailable." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
  const payload: LiveWorldNewsPayload = {
    scope: "world-live",
    generatedAt: new Date().toISOString(),
    refreshAfterSeconds: 60,
    provider: "WorldPulse live country index",
    global,
    countries,
  };
  return Response.json(payload, { headers: { "Cache-Control": "no-store" } });
}

async function handleLiveWorldDiagnostics(env: Env) {
  if (!env.DB) {
    return Response.json(
      { error: "Live world diagnostics are unavailable." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
  const [countries, global] = await Promise.all([
    readLiveCountryIndex(env),
    currentGlobalFeed(env),
  ]);
  const generatedAt = new Date().toISOString();
  const countriesWithNews = countries.filter(
    (country) => country.articles.length > 0,
  ).length;
  const diagnostics: WorldPulseDiagnostics = {
    status: countriesWithNews === countries.length ? "healthy" : "degraded",
    fresh: true,
    generatedAt,
    snapshotGeneratedAt: generatedAt,
    snapshotBytes: 0,
    totalCountries: countries.length,
    countriesWithNews,
    inhabitedCountries: countries.length,
    inhabitedCountriesWithNews: countriesWithNews,
    missingInhabitedCountries: countries
      .filter((country) => !country.articles.length)
      .map((country) => country.countryName),
    expectedEmptyCountries: [],
    globalEventCount: global?.articles.length ?? 0,
    providerHealth: global?.providers ?? [],
  };
  return Response.json(diagnostics, {
    headers: { "Cache-Control": "no-store" },
  });
}

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const url = new URL(request.url);

    if (url.pathname === "/api/live-news") {
      if (url.searchParams.get("scope") === "world-live") {
        return handleLiveWorld(env);
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
      return handleLiveWorldDiagnostics(env);
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
  async scheduled(
    controller: ScheduledController,
    env: Env,
    ctx: ExecutionContext,
  ) {
    const scheduledAt = new Date(controller.scheduledTime);
    ctx.waitUntil(Promise.all([
      refreshStoredGlobalFeedSafely(env),
      enqueueCountryRefreshJobs(env, scheduledAt),
    ]));
  },
  async queue(batch: MessageBatch<CountryRefreshJob>, env: Env) {
    for (const message of batch.messages) {
      try {
        const job = message.body;
        if (
          job.version !== 1 ||
          !Array.isArray(job.countries) ||
          !job.countries.length ||
          job.countries.length > LIVE_COUNTRY_REFRESH_JOB_SIZE
        ) {
          throw new Error("Invalid country refresh job.");
        }
        await refreshLiveCountries(env, job.countries);
        message.ack();
      } catch (error) {
        console.error(JSON.stringify({
          event: "news_refresh_job_failed",
          error: error instanceof Error ? error.message : "unknown error",
        }));
        message.retry({ delaySeconds: 60 });
      }
    }
  },
};

export default worker;
