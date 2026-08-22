/** Cloudflare Worker entry point for Hemisphere Herald. */
import {
  DEFAULT_DEVICE_SIZES,
  DEFAULT_IMAGE_SIZES,
  handleImageOptimization,
} from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";
import { countryCodeForName } from "../lib/country-locale";
import type {
  MapCountry,
} from "../lib/types";
import { handleLiveVideo } from "./live-video";
import worldGeometrySource from "../public/countries.geojson?raw";

interface Env {
  ASSETS: Fetcher;
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
      return Response.json(
        { error: "Unsupported live-news scope. Use scope=world-live." },
        { status: 400, headers: { "Cache-Control": "no-store" } },
      );
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
