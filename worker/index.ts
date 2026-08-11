/** Cloudflare Worker entry point for the vinext-starter template. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";
import {
  readLatestStoredGlobalFeed,
  readStoredMapFeeds,
  readStoredNewsFeed,
  writeStoredNewsFeed,
} from "../db/news-cache";
import { countryCodeForName } from "../lib/country-locale";
import {
  mergePreparedCountryFeedSnapshots,
  prepareCompleteWorldSnapshotFromFeeds,
  prepareWorldSnapshotFeeds,
} from "../lib/world-snapshot";
import { encodePreparedWorldNews } from "../lib/snapshot-transport";
import { buildWorldDiagnostics } from "../lib/world-health";
import type {
  LiveNewsPayload,
  MapCountry,
  PreparedNewsFeed,
  WorldPulseDiagnostics,
} from "../lib/types";
import { mergeCachedPayloads } from "./live-cache";
import { collectStoredMapCountries } from "./map-cache";
import { handleLiveNews } from "./live-news";
import { handleLiveVideo } from "./live-video";
import worldGeometrySource from "../public/countries.geojson?raw";

interface Env {
  ASSETS: Fetcher;
  DB?: D1Database;
  SNAPSHOTS?: R2Bucket;
  WORLD_SNAPSHOT_REFRESH_TOKEN?: string;
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
const PREPARED_WORLD_KEY = "world/latest.json";
const PREPARED_WORLD_HEALTH_KEY = "world/health.json";
const PREPARED_WORLD_FRESH_MS = 60_000;
const PREPARED_WORLD_CHUNK_SIZE = 12;
const PREPARED_COUNTRY_REFRESH_BATCH_SIZE = 4;
const PREPARED_GLOBAL_REFRESH_INTERVAL_MINUTES = 5;

let preparedWorldRefresh: Promise<void> | null = null;
let preparedCountryRefresh: Promise<void> | null = null;

interface WorldGeometry {
  features?: Array<{
    id?: string | number;
    properties?: { name?: string };
  }>;
}

function loadWorldDirectory() {
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
  return directory;
}

interface PreparedCountryChunk {
  generatedAt: string;
  countryFeeds: Record<string, PreparedNewsFeed>;
}

function preparedCountryChunkKey(batchIndex: number) {
  return `world/countries/${batchIndex}.json`;
}

async function readPreparedCountryChunk(
  snapshots: R2Bucket,
  chunkIndex: number,
) {
  const object = await snapshots.get(preparedCountryChunkKey(chunkIndex));
  if (!object) return null;
  try {
    const chunk = JSON.parse(await object.text()) as PreparedCountryChunk;
    return chunk?.countryFeeds ? chunk : null;
  } catch {
    return null;
  }
}

async function readCompletePreparedCountryFeeds(
  snapshots: R2Bucket,
  directory: MapCountry[],
) {
  const batchCount = Math.ceil(
    directory.length / PREPARED_WORLD_CHUNK_SIZE,
  );
  const feeds: Record<string, PreparedNewsFeed> = {};
  for (let batchIndex = 0; batchIndex < batchCount; batchIndex += 1) {
    const chunk = await readPreparedCountryChunk(snapshots, batchIndex);
    if (chunk) Object.assign(feeds, chunk.countryFeeds);
  }
  const missingCountries = directory.filter(
    (country) => !feeds[country.name],
  );
  if (missingCountries.length) {
    throw new Error(
      `Prepared world is missing ${missingCountries.length} country feeds.`,
    );
  }
  return feeds;
}

async function refreshPreparedWorld(env: Env) {
  if (!env.DB || !env.SNAPSHOTS) {
    throw new Error("Prepared world storage is unavailable.");
  }
  const directory = loadWorldDirectory();
  const globalUrl = new URL("https://worldpulse.internal/api/live-news");
  globalUrl.searchParams.set("scope", "global");
  const globalCacheKey = normalizedLiveCacheKey(new Request(globalUrl)).url;
  // Browser requests use the public host while scheduled jobs use the internal
  // host, so select the newest global row independently of its URL origin.
  const storedGlobal = await readLatestStoredGlobalFeed(env.DB);
  let globalPayload: LiveNewsPayload | null = null;
  if (
    storedGlobal &&
    Date.now() - storedGlobal.generated_at < LIVE_CACHE_RETENTION_SECONDS * 1_000
  ) {
    try {
      const candidate = JSON.parse(storedGlobal.payload) as LiveNewsPayload;
      if (candidate.scope === "global" && Array.isArray(candidate.articles)) {
        globalPayload = candidate;
      }
    } catch {
      // Fall through to a direct provider refresh for an invalid cache row.
    }
  }
  if (!globalPayload) {
    const globalResponse = await handleLiveNews(new Request(globalUrl));
    if (!globalResponse.ok) {
      throw new Error("Fresh global reporting is unavailable.");
    }
    const payload = await globalResponse.text();
    globalPayload = JSON.parse(payload) as LiveNewsPayload;
    await writeStoredNewsFeed(env.DB, globalCacheKey, payload, Date.now());
  }
  const generatedAt = new Date().toISOString();
  const localFeeds = await readCompletePreparedCountryFeeds(
    env.SNAPSHOTS,
    directory,
  );
  const snapshot = prepareCompleteWorldSnapshotFromFeeds(
    globalPayload,
    localFeeds,
    directory,
    generatedAt,
  );
  const wirePayload = JSON.stringify(encodePreparedWorldNews(snapshot));
  const compressedPayload = await new Response(
    new Response(wirePayload).body?.pipeThrough(new CompressionStream("gzip")),
  ).arrayBuffer();
  const diagnostics = buildWorldDiagnostics(
    snapshot,
    directory,
    globalPayload,
    compressedPayload.byteLength,
  );
  if (diagnostics.status === "degraded") {
    console.error(
      JSON.stringify({
        event: "world_coverage_alert",
        missingInhabitedCountries: diagnostics.missingInhabitedCountries,
      }),
    );
  }
  await Promise.all([
    env.SNAPSHOTS.put(PREPARED_WORLD_KEY, compressedPayload, {
      httpMetadata: {
        contentEncoding: "gzip",
        contentType: "application/json; charset=utf-8",
      },
      customMetadata: { generatedAt, encoding: "gzip" },
    }),
    env.SNAPSHOTS.put(
      PREPARED_WORLD_HEALTH_KEY,
      JSON.stringify(diagnostics),
      {
        httpMetadata: { contentType: "application/json; charset=utf-8" },
        customMetadata: { generatedAt },
      },
    ),
  ]);
  console.info(
    JSON.stringify({
      event: "prepared_world_refresh_completed",
      generatedAt,
      countryCount: directory.length,
    }),
  );
}

async function handleWorldDiagnostics(env: Env) {
  if (!env.SNAPSHOTS) {
    return Response.json(
      { error: "World health reporting is unavailable." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
  const health = await env.SNAPSHOTS.get(PREPARED_WORLD_HEALTH_KEY);
  if (!health) {
    return Response.json(
      { error: "World health reporting is still being prepared." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
  const diagnostics = JSON.parse(await health.text()) as WorldPulseDiagnostics;
  diagnostics.fresh =
    Date.now() - Date.parse(diagnostics.snapshotGeneratedAt) < 5 * 60_000;
  if (!diagnostics.fresh) diagnostics.status = "degraded";
  return Response.json(diagnostics, {
    headers: {
      "Cache-Control": "no-store",
    },
  });
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
    console.error(
      JSON.stringify({
        event: "prepared_global_refresh_failed",
        error: error instanceof Error ? error.message : "unknown error",
      }),
    );
  }
}

async function refreshPreparedCountryBatch(
  env: Env,
  requestedBatchIndex?: number,
  cacheOnly = false,
) {
  if (!env.DB || !env.SNAPSHOTS) return;
  const directory = loadWorldDirectory();
  const countryNames = directory.map((country) => country.name);
  const batchCount = Math.ceil(
    countryNames.length / PREPARED_COUNTRY_REFRESH_BATCH_SIZE,
  );
  const batchIndex = Number.isInteger(requestedBatchIndex)
    ? Math.max(0, Math.min(batchCount - 1, requestedBatchIndex as number))
    : Math.floor(Date.now() / 60_000) % batchCount;
  const refreshCountries = countryNames.slice(
    batchIndex * PREPARED_COUNTRY_REFRESH_BATCH_SIZE,
    (batchIndex + 1) * PREPARED_COUNTRY_REFRESH_BATCH_SIZE,
  );
  if (!cacheOnly) {
    const mapUrl = new URL("https://worldpulse.internal/api/live-news");
    mapUrl.searchParams.set("scope", "map");
    mapUrl.searchParams.set("countries", refreshCountries.join("|"));
    const mapResponse = await handleLiveNews(new Request(mapUrl));
    if (!mapResponse.ok) return;
    const cacheKey = normalizedLiveCacheKey(new Request(mapUrl)).url;
    let mapPayload = await mapResponse.text();
    const previous = await readStoredNewsFeed(env.DB, cacheKey);
    if (previous) {
      mapPayload = mergeCachedPayloads(mapPayload, previous.payload);
    }
    await writeStoredNewsFeed(env.DB, cacheKey, mapPayload, Date.now());
  }
  const firstCountryIndex = batchIndex * PREPARED_COUNTRY_REFRESH_BATCH_SIZE;
  const chunkIndex = Math.floor(firstCountryIndex / PREPARED_WORLD_CHUNK_SIZE);
  const chunkCountries = countryNames.slice(
    chunkIndex * PREPARED_WORLD_CHUNK_SIZE,
    (chunkIndex + 1) * PREPARED_WORLD_CHUNK_SIZE,
  );
  const expectedCountryNames = new Set(chunkCountries);
  const previousChunk = await readPreparedCountryChunk(
    env.SNAPSHOTS,
    chunkIndex,
  );
  const consolidated = collectStoredMapCountries(
    await readStoredMapFeeds(env.DB),
    expectedCountryNames,
  );
  const freshFeeds = prepareWorldSnapshotFeeds(
    consolidated.countries,
    directory,
  );
  const countryFeeds = mergePreparedCountryFeedSnapshots(
    freshFeeds,
    previousChunk?.countryFeeds ?? {},
    chunkCountries,
  );
  const missingCountries = chunkCountries.filter(
    (countryName) => !countryFeeds[countryName],
  );
  if (missingCountries.length) {
    throw new Error(
      `Prepared country batch is missing ${missingCountries.length} feeds.`,
    );
  }
  const generatedAt = new Date().toISOString();
  const chunk: PreparedCountryChunk = {
    generatedAt,
    countryFeeds,
  };
  await env.SNAPSHOTS.put(
    preparedCountryChunkKey(chunkIndex),
    JSON.stringify(chunk),
    {
      httpMetadata: { contentType: "application/json; charset=utf-8" },
      customMetadata: { generatedAt },
    },
  );
  console.info(
    JSON.stringify({
      event: "prepared_country_refresh_completed",
      refreshBatchIndex: batchIndex,
      chunkIndex,
      countries: refreshCountries,
    }),
  );
}

function refreshPreparedWorldOnce(env: Env) {
  preparedWorldRefresh ??= refreshPreparedWorld(env).finally(() => {
    preparedWorldRefresh = null;
  });
  return preparedWorldRefresh;
}

async function refreshPreparedWorldSafely(env: Env) {
  try {
    await refreshPreparedWorldOnce(env);
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "prepared_world_refresh_failed",
        error: error instanceof Error ? error.message : "unknown error",
      }),
    );
  }
}

function refreshPreparedCountryBatchOnce(env: Env) {
  preparedCountryRefresh ??= refreshPreparedCountryBatch(env).finally(() => {
    preparedCountryRefresh = null;
  });
  return preparedCountryRefresh;
}

async function refreshPreparedCountryBatchSafely(env: Env) {
  try {
    await refreshPreparedCountryBatchOnce(env);
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "prepared_country_refresh_failed",
        error: error instanceof Error ? error.message : "unknown error",
      }),
    );
  }
}

async function refreshMinuteWorldState(
  env: Env,
  refreshGlobal = false,
) {
  if (refreshGlobal) await refreshStoredGlobalFeedSafely(env);
  await refreshPreparedCountryBatchSafely(env);
  await refreshPreparedWorldSafely(env);
}

async function handlePreparedWorld(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
) {
  if (!env.SNAPSHOTS) {
    return Response.json(
      { error: "The minute world state is unavailable." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
  let current = await env.SNAPSHOTS.get(PREPARED_WORLD_KEY);
  const generatedAt = Date.parse(current?.customMetadata?.generatedAt ?? "");
  const age = Number.isFinite(generatedAt)
    ? Date.now() - generatedAt
    : Number.POSITIVE_INFINITY;
  const requestUrl = new URL(request.url);
  const suppliedToken = request.headers.get("X-WorldPulse-Refresh-Token");
  const canWaitForRefresh = Boolean(
    env.WORLD_SNAPSHOT_REFRESH_TOKEN &&
    suppliedToken === env.WORLD_SNAPSHOT_REFRESH_TOKEN,
  );
  if (canWaitForRefresh) {
    const requestedBatch = requestUrl.searchParams.get("countryBatch");
    if (requestedBatch !== null) {
      const batchIndex = Number(requestedBatch);
      if (!Number.isInteger(batchIndex) || batchIndex < 0) {
        return Response.json(
          { error: "A valid country batch is required." },
          { status: 400, headers: { "Cache-Control": "no-store" } },
        );
      }
      try {
        await refreshPreparedCountryBatch(
          env,
          batchIndex,
          requestUrl.searchParams.get("countryBatchCacheOnly") === "1",
        );
      } catch (error) {
        console.warn(
          JSON.stringify({
            event: "prepared_country_seed_failed",
            error: error instanceof Error ? error.message : "unknown error",
          }),
        );
      }
      if (requestUrl.searchParams.get("countryBatchOnly") === "1") {
        return Response.json(
          { status: "country batch refreshed", batchIndex },
          { status: 202, headers: { "Cache-Control": "no-store" } },
        );
      }
    }
    if (age >= PREPARED_WORLD_FRESH_MS || requestedBatch !== null) {
      try {
        await refreshPreparedWorld(env);
      } catch (error) {
        console.warn(
          JSON.stringify({
            event: "prepared_world_seed_failed",
            error: error instanceof Error ? error.message : "unknown error",
          }),
        );
      }
      current = await env.SNAPSHOTS.get(PREPARED_WORLD_KEY);
    }
  } else if (age >= PREPARED_WORLD_FRESH_MS) {
    ctx.waitUntil(refreshMinuteWorldState(env));
  }
  if (!current) {
    return Response.json(
      { error: "The minute world state is still being prepared." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
  const headers = new Headers({
    "Cache-Control": "no-store",
    "Content-Type":
      current.customMetadata?.encoding === "gzip"
        ? "application/vnd.worldpulse.snapshot+gzip"
        : "application/json; charset=utf-8",
    "X-WorldPulse-Snapshot-Generated-At":
      current.customMetadata?.generatedAt ?? "unknown",
  });
  let body: ReadableStream | null = current.body;
  if (
    current.customMetadata?.encoding === "gzip" &&
    requestUrl.searchParams.get("plain") === "1"
  ) {
    body = current.body.pipeThrough(new DecompressionStream("gzip"));
    headers.set("Content-Type", "application/json; charset=utf-8");
  }
  return new Response(body, { headers });
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
    refreshUrl.searchParams.delete("warm");
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
  if (requestUrl.searchParams.get("warm") === "1") {
    return new Response(null, {
      status: 202,
      headers: { "Cache-Control": "no-store" },
    });
  }
  const storedFeeds = await readStoredMapFeeds(env.DB);
  const snapshot = collectStoredMapCountries(storedFeeds);
  return Response.json(
    {
      scope: "map",
      generatedAt: snapshot.generatedAt,
      refreshAfterSeconds: LIVE_CACHE_FRESH_MS / 1_000,
      provider: "WorldPulse",
      countries: snapshot.countries,
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
      if (url.searchParams.get("scope") === "prepared-world") {
        return handlePreparedWorld(request, env, ctx);
      }
      if (
        url.searchParams.get("scope") === "snapshot" ||
        url.searchParams.get("snapshot") === "1"
      ) {
        return handleWorldSnapshot(request, env, ctx);
      }
      return handleCachedLiveNews(request, env, ctx);
    }

    if (url.pathname === "/api/diagnostics/world") {
      return handleWorldDiagnostics(env);
    }

    if (url.pathname === "/api/live-video") {
      return handleLiveVideo(request);
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
  async scheduled(
    _controller: ScheduledController,
    env: Env,
    ctx: ExecutionContext,
  ) {
    const minute = Math.floor(Date.now() / 60_000);
    ctx.waitUntil(
      refreshMinuteWorldState(
        env,
        minute % PREPARED_GLOBAL_REFRESH_INTERVAL_MINUTES === 0,
      ),
    );
  },
};

export default worker;
