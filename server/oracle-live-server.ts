import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildLiveEvents } from "../lib/live-news";
import { textMatchesCountryName } from "../lib/country-terms";
import { isNonEventNewsTitle } from "../lib/news-quality";
import type {
  LiveArticle,
  LiveNewsPayload,
  LiveWorldNewsPayload,
  MapNewsCountryPayload,
  MapNewsPayload,
} from "../lib/types";
import { handleLiveNews } from "../worker/live-news";

const SERVER_DIR = dirname(fileURLToPath(import.meta.url));
const REPOSITORY_DIR = resolve(SERVER_DIR, "..");
const DEFAULT_DATA_PATH = resolve(REPOSITORY_DIR, ".runtime", "world-live.json");
const ARTICLE_RETENTION_MS = 8 * 24 * 60 * 60_000;
const FUTURE_TOLERANCE_MS = 6 * 60 * 60_000;
const MAX_ARTICLES_PER_COUNTRY = 20;
const GLOBAL_REFRESH_MS = 5 * 60_000;
const COUNTRY_RETRY_DELAY_MS = 750;
const EXPECTED_EMPTY_COUNTRIES = new Set([
  "Fr. S. Antarctic Lands",
  "Siachen Glacier",
]);

export interface PersistedCollectorState {
  version: 1;
  startedAt: string;
  updatedAt: string;
  completedCycleAt: string | null;
  cycleNumber: number;
  global: LiveNewsPayload | null;
  countries: Record<string, MapNewsCountryPayload>;
  lastAttemptAt: Record<string, string>;
}

interface CollectorRuntime {
  state: PersistedCollectorState;
  countryNames: string[];
  revision: number;
  cachedRevision: number;
  cachedWorldPayload: string | null;
  persistChain: Promise<void>;
}

interface CountryGeometry {
  features?: Array<{ properties?: { name?: string } }>;
}

type FetchImplementation = typeof fetch;

function nowIso() {
  return new Date().toISOString();
}

function delay(milliseconds: number) {
  return new Promise<void>((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

function isCurrentArticle(article: LiveArticle, now = Date.now()) {
  const publishedAt = Date.parse(article.publishedAt);
  return (
    Number.isFinite(publishedAt) &&
    now - publishedAt <= ARTICLE_RETENTION_MS &&
    publishedAt - now <= FUTURE_TOLERANCE_MS
  );
}

function articleKey(article: LiveArticle) {
  return article.url || article.id || article.title;
}

function isValidCountryArticle(countryName: string, article: LiveArticle) {
  return (
    !isNonEventNewsTitle(article.title) &&
    textMatchesCountryName(
      `${article.title} ${article.description ?? ""}`,
      countryName,
    )
  );
}

export function selectDiverseCountryArticles(
  countryName: string,
  articles: LiveArticle[],
  limit = MAX_ARTICLES_PER_COUNTRY,
  now = Date.now(),
) {
  const ranked = articles
    .filter((article) => isValidCountryArticle(countryName, article))
    .sort(
    (left, right) =>
      Date.parse(right.publishedAt) - Date.parse(left.publishedAt),
  );
  if (ranked.length <= limit) return ranked;

  const events = buildLiveEvents(
    {
      countryName,
      scope: "country",
      generatedAt: new Date(now).toISOString(),
      refreshAfterSeconds: 60,
      provider: "Hemisphere Herald live collector",
      articles: ranked,
    },
    { name: countryName },
  );
  const originalsByUrl = new Map(
    ranked.map((article) => [article.url, article] as const),
  );
  const selected: LiveArticle[] = [];
  const selectedKeys = new Set<string>();

  // Take one representative from every leading event before taking a second
  // source from any event. A single breaking story can no longer fill all of
  // a country's retained slots, while multi-source events still keep context.
  for (let sourceDepth = 0; sourceDepth < 5; sourceDepth += 1) {
    for (const event of events) {
      const visibleArticle = event.articles[sourceDepth];
      if (!visibleArticle) continue;
      const original = originalsByUrl.get(visibleArticle.originalUrl);
      if (!original) continue;
      const key = articleKey(original);
      if (selectedKeys.has(key)) continue;
      selected.push(original);
      selectedKeys.add(key);
      if (selected.length === limit) return selected;
    }
  }

  return selected;
}

export function mergeCountryFeed(
  countryName: string,
  current: MapNewsCountryPayload | undefined,
  incoming: MapNewsCountryPayload | undefined,
  now = Date.now(),
): MapNewsCountryPayload {
  const articles = new Map<string, LiveArticle>();
  for (const article of [...(incoming?.articles ?? []), ...(current?.articles ?? [])]) {
    if (
      !isCurrentArticle(article, now) ||
      !isValidCountryArticle(countryName, article)
    ) {
      continue;
    }
    const key = articleKey(article);
    if (!articles.has(key)) articles.set(key, article);
  }
  const mergedArticles = selectDiverseCountryArticles(
    countryName,
    [...articles.values()],
    MAX_ARTICLES_PER_COUNTRY,
    now,
  );
  return {
    countryName,
    generatedAt: incoming?.generatedAt ?? current?.generatedAt ?? nowIso(),
    available: mergedArticles.length > 0,
    articles: mergedArticles,
  };
}

function emptyGlobalFeed(): LiveNewsPayload {
  return {
    countryName: null,
    scope: "global",
    generatedAt: "1970-01-01T00:00:00.000Z",
    refreshAfterSeconds: 60,
    provider: "Hemisphere Herald live server is starting",
    degraded: true,
    articles: [],
  };
}

function emptyCountry(countryName: string): MapNewsCountryPayload {
  return {
    countryName,
    generatedAt: "1970-01-01T00:00:00.000Z",
    available: false,
    articles: [],
  };
}

export function buildWorldPayload(
  state: PersistedCollectorState,
  countryNames: string[],
): LiveWorldNewsPayload {
  return {
    scope: "world-live",
    generatedAt: state.updatedAt,
    refreshAfterSeconds: 60,
    provider: "Hemisphere Herald continuous Oracle country index",
    global: state.global ?? emptyGlobalFeed(),
    countries: countryNames.map((countryName) => {
      const country = state.countries[countryName] ?? emptyCountry(countryName);
      const articles = country.articles
        .filter((article) => isValidCountryArticle(countryName, article))
        .slice(0, MAX_ARTICLES_PER_COUNTRY);
      return {
        ...country,
        available: articles.length > 0,
        articles,
      };
    }),
  };
}

export function bootstrapProgress(
  state: PersistedCollectorState,
  countryNames: string[],
) {
  const attemptedCountries = countryNames.filter(
    (countryName) => Boolean(state.lastAttemptAt[countryName]),
  ).length;
  const countriesWithNews = countryNames.filter(
    (countryName) => (state.countries[countryName]?.articles.length ?? 0) > 0,
  ).length;
  const ready =
    Boolean(state.global?.articles.length) &&
    attemptedCountries === countryNames.length;
  return {
    ready,
    attemptedCountries,
    countriesWithNews,
    totalCountries: countryNames.length,
    cycleNumber: state.cycleNumber,
    completedCycleAt: state.completedCycleAt,
    globalGeneratedAt: state.global?.generatedAt ?? null,
  };
}

async function loadCountryNames() {
  const geometryPath = resolve(REPOSITORY_DIR, "public", "countries.geojson");
  const geometry = JSON.parse(await readFile(geometryPath, "utf8")) as CountryGeometry;
  const countryNames = [
    ...new Set(
      (geometry.features ?? [])
        .map((feature) => feature.properties?.name?.trim())
        .filter((name): name is string => Boolean(name)),
    ),
  ];
  if (!countryNames.length) throw new Error("World geometry contains no countries.");
  return countryNames;
}

function initialState(): PersistedCollectorState {
  const startedAt = nowIso();
  return {
    version: 1,
    startedAt,
    updatedAt: startedAt,
    completedCycleAt: null,
    cycleNumber: 0,
    global: null,
    countries: {},
    lastAttemptAt: {},
  };
}

async function loadState(dataPath: string) {
  try {
    const candidate = JSON.parse(await readFile(dataPath, "utf8")) as PersistedCollectorState;
    if (
      candidate.version === 1 &&
      candidate.countries &&
      candidate.lastAttemptAt
    ) {
      return candidate;
    }
  } catch {
    // A first boot or incomplete previous write starts with a clean index.
  }
  return initialState();
}

async function persistState(runtime: CollectorRuntime, dataPath: string) {
  const payload = JSON.stringify(runtime.state);
  const temporaryPath = `${dataPath}.tmp`;
  runtime.persistChain = runtime.persistChain.then(async () => {
    await mkdir(dirname(dataPath), { recursive: true });
    await writeFile(temporaryPath, payload, "utf8");
    await rename(temporaryPath, dataPath);
  });
  await runtime.persistChain;
}

function markChanged(runtime: CollectorRuntime) {
  runtime.state.updatedAt = nowIso();
  runtime.revision += 1;
}

async function refreshGlobal(
  runtime: CollectorRuntime,
  fetchImpl: FetchImplementation,
  dataPath: string,
) {
  const response = await handleLiveNews(
    new Request("https://worldpulse.internal/api/live-news?scope=global"),
    fetchImpl,
  );
  if (!response.ok) throw new Error(`Global refresh failed with HTTP ${response.status}.`);
  const payload = (await response.json()) as LiveNewsPayload;
  if (payload.scope !== "global" || !Array.isArray(payload.articles)) {
    throw new Error("Global refresh returned an invalid payload.");
  }
  runtime.state.global = payload;
  markChanged(runtime);
  await persistState(runtime, dataPath);
}

async function refreshCountry(
  runtime: CollectorRuntime,
  countryName: string,
  fetchImpl: FetchImplementation,
) {
  const url = new URL("https://worldpulse.internal/api/live-news");
  url.searchParams.set("scope", "map");
  url.searchParams.set("countries", countryName);
  const response = await handleLiveNews(new Request(url), fetchImpl);
  if (!response.ok) throw new Error(`${countryName} refresh failed with HTTP ${response.status}.`);
  const payload = (await response.json()) as MapNewsPayload;
  if (payload.scope !== "map" || !Array.isArray(payload.countries)) {
    throw new Error(`${countryName} refresh returned an invalid payload.`);
  }
  runtime.state.countries[countryName] = mergeCountryFeed(
    countryName,
    runtime.state.countries[countryName],
    payload.countries.find((country) => country.countryName === countryName),
  );
}

function countriesByOldestAttempt(runtime: CollectorRuntime) {
  return [...runtime.countryNames].sort((left, right) => {
    const leftAttempt = Date.parse(runtime.state.lastAttemptAt[left] ?? "1970-01-01");
    const rightAttempt = Date.parse(runtime.state.lastAttemptAt[right] ?? "1970-01-01");
    return leftAttempt - rightAttempt;
  });
}

async function countryCollectorLoop(
  runtime: CollectorRuntime,
  fetchImpl: FetchImplementation,
  dataPath: string,
  concurrency: number,
) {
  while (true) {
    const queue = countriesByOldestAttempt(runtime);
    let nextIndex = 0;
    let completedSincePersist = 0;
    const workers = Array.from(
      { length: Math.max(1, Math.min(concurrency, queue.length)) },
      async () => {
        while (nextIndex < queue.length) {
          const countryName = queue[nextIndex];
          nextIndex += 1;
          try {
            await refreshCountry(runtime, countryName, fetchImpl);
          } catch (error) {
            console.warn(JSON.stringify({
              event: "country_refresh_failed",
              countryName,
              error: error instanceof Error ? error.message : "unknown error",
            }));
          } finally {
            runtime.state.lastAttemptAt[countryName] = nowIso();
            markChanged(runtime);
            completedSincePersist += 1;
            if (completedSincePersist >= 5) {
              completedSincePersist = 0;
              await persistState(runtime, dataPath);
            }
          }
          await delay(COUNTRY_RETRY_DELAY_MS);
        }
      },
    );
    await Promise.all(workers);
    runtime.state.cycleNumber += 1;
    runtime.state.completedCycleAt = nowIso();
    markChanged(runtime);
    await persistState(runtime, dataPath);
  }
}

async function globalCollectorLoop(
  runtime: CollectorRuntime,
  fetchImpl: FetchImplementation,
  dataPath: string,
) {
  while (true) {
    try {
      await refreshGlobal(runtime, fetchImpl, dataPath);
    } catch (error) {
      console.warn(JSON.stringify({
        event: "global_refresh_failed",
        error: error instanceof Error ? error.message : "unknown error",
      }));
    }
    await delay(GLOBAL_REFRESH_MS);
  }
}

function sendJson(
  response: ServerResponse,
  status: number,
  body: string,
  cacheControl = "no-store",
) {
  response.writeHead(status, {
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": cacheControl,
    "Content-Length": Buffer.byteLength(body),
    "Content-Type": "application/json; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(body);
}

function worldPayloadJson(runtime: CollectorRuntime) {
  if (
    runtime.cachedWorldPayload === null ||
    runtime.cachedRevision !== runtime.revision
  ) {
    runtime.cachedWorldPayload = JSON.stringify(
      buildWorldPayload(runtime.state, runtime.countryNames),
    );
    runtime.cachedRevision = runtime.revision;
  }
  return runtime.cachedWorldPayload;
}

function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  runtime: CollectorRuntime,
) {
  if (request.method === "OPTIONS") {
    response.writeHead(204, {
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Origin": "*",
    });
    response.end();
    return;
  }
  if (request.method !== "GET") {
    sendJson(response, 405, JSON.stringify({ error: "Method not allowed." }));
    return;
  }
  const url = new URL(request.url ?? "/", "http://worldpulse.internal");
  const progress = bootstrapProgress(runtime.state, runtime.countryNames);
  if (url.pathname === "/healthz") {
    sendJson(response, 200, JSON.stringify({
      status: progress.ready ? "ready" : "bootstrapping",
      updatedAt: runtime.state.updatedAt,
      ...progress,
    }));
    return;
  }
  if (
    url.pathname === "/api/live-news" &&
    url.searchParams.get("scope") === "world-live"
  ) {
    if (!progress.ready) {
      sendJson(response, 503, JSON.stringify({
        error: "The first complete country cycle is still running.",
        ...progress,
      }));
      return;
    }
    sendJson(response, 200, worldPayloadJson(runtime), "public, max-age=30, must-revalidate");
    return;
  }
  if (url.pathname === "/api/diagnostics/world") {
    const payload = worldPayloadJson(runtime);
    const countriesWithNews = runtime.countryNames.filter(
      (countryName) =>
        (runtime.state.countries[countryName]?.articles.length ?? 0) > 0,
    ).length;
    const missingInhabitedCountries = runtime.countryNames.filter(
      (countryName) =>
        !EXPECTED_EMPTY_COUNTRIES.has(countryName) &&
        !(runtime.state.countries[countryName]?.articles.length ?? 0),
    );
    const expectedEmptyCountries = runtime.countryNames.filter(
      (countryName) => EXPECTED_EMPTY_COUNTRIES.has(countryName),
    );
    const inhabitedCountries =
      runtime.countryNames.length - expectedEmptyCountries.length;
    const diagnostics = {
      status:
        progress.ready && !missingInhabitedCountries.length
          ? "healthy"
          : "degraded",
      fresh: progress.ready,
      generatedAt: runtime.state.updatedAt,
      snapshotGeneratedAt: runtime.state.updatedAt,
      snapshotBytes: Buffer.byteLength(payload),
      totalCountries: runtime.countryNames.length,
      countriesWithNews,
      inhabitedCountries,
      inhabitedCountriesWithNews: countriesWithNews,
      missingInhabitedCountries,
      expectedEmptyCountries,
      globalEventCount: runtime.state.global?.articles.length ?? 0,
      providerHealth: runtime.state.global?.providers ?? [],
      bootstrap: progress,
    };
    sendJson(response, 200, JSON.stringify(diagnostics));
    return;
  }
  sendJson(response, 404, JSON.stringify({ error: "Not found." }));
}

export async function startOracleLiveServer(options: {
  dataPath?: string;
  port?: number;
  concurrency?: number;
  fetchImpl?: FetchImplementation;
} = {}) {
  const dataPath = options.dataPath ?? process.env.WORLD_PULSE_DATA_PATH ?? DEFAULT_DATA_PATH;
  const port = options.port ?? Number(process.env.PORT ?? 8787);
  const concurrency =
    options.concurrency ?? Number(process.env.WORLD_PULSE_CONCURRENCY ?? 2);
  const fetchImpl = options.fetchImpl ?? fetch;
  const countryNames = await loadCountryNames();
  const runtime: CollectorRuntime = {
    state: await loadState(dataPath),
    countryNames,
    revision: 1,
    cachedRevision: 0,
    cachedWorldPayload: null,
    persistChain: Promise.resolve(),
  };
  const server = createServer((request, response) =>
    handleRequest(request, response, runtime),
  );
  await new Promise<void>((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(port, "0.0.0.0", () => resolveListen());
  });
  console.log(JSON.stringify({
    event: "worldpulse_live_server_started",
    port,
    countries: countryNames.length,
    concurrency,
    dataPath,
  }));
  void globalCollectorLoop(runtime, fetchImpl, dataPath);
  void countryCollectorLoop(runtime, fetchImpl, dataPath, concurrency);
  return { server, runtime };
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (import.meta.url === invokedPath) {
  await startOracleLiveServer();
}
