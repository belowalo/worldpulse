# Architecture

## System overview

WorldPulse separates presentation, domain scoring, ingestion contracts, and persistence.

```text
Browser
  └─ Next.js web app
       ├─ CesiumJS satellite terrain globe + local GeoJSON/capital coordinates
       ├─ filters, country panel, methodology, Live Situation
       ├─ capital signal markers + evidence-only story connections
       └─ same-origin Cloudflare Worker news endpoint
            ├─ public RSS metadata indexes
            ├─ edge stale-while-refresh cache
            ├─ D1 persistent feed cache
            └─ optional local reference stack
                 └─ FastAPI
                      ├─ query and serialization services
                      ├─ deterministic scoring module
                      ├─ NewsProvider interface
                      └─ SQLAlchemy
                           └─ PostgreSQL
```

The web app is at the repository root because the deployable Sites runtime expects the application, worker entry point, and build output there. The backend is isolated in `apps/api`. This preserves a monorepo workflow without duplicating the web package.

## Web boundaries

- `components/world-map.tsx` owns the CesiumJS lifecycle, satellite imagery and terrain providers, GeoJSON country overlays, capital signal markers, selected-story arcs, hover, and selection.
- `components/world-pulse-app.tsx` owns startup readiness, filters, country selection, the breaking-news ticker, image-backed Live Situation briefing, auto-refreshing Live News directory, event cards, and methodology.
- `lib/cesium-runtime.ts` is the dynamically loaded CesiumJS runtime boundary and configures the public CDN asset base.
- `lib/scoring.ts` is UI-independent and contains score labels plus reusable category/intensity globe styling.
- `lib/live-news.ts` classifies and clusters live headline metadata into scored events.
- `lib/seed-data.ts` contains only the initial country metadata used before the full map directory loads.
- `public/countries.geojson` is a local, deployment-safe country dataset derived from the ISC-licensed `geojson-world-map` package.
- `public/world-capitals.json` is the bundled ISO-to-capital coordinate index used for signal markers and selected-story connection endpoints.

The globe supports pointer navigation and direct country selection across all 215 geometries in the bundled dataset. Cesium renders EOX Sentinel-2 cloudless imagery over Mapzen/AWS Terrarium elevation tiles served through the same-origin terrain cache. Translucent, ground-clamped GeoJSON polygons retain WorldPulse country colors while allowing the satellite surface to remain visible. Every mapped country receives one or more capital markers when capital data exists and a geographic-center fallback otherwise. The camera never rotates automatically, and country hover/selection updates only the indexed overlay entities rather than reprocessing the complete dataset.

Startup keeps the staged readiness screen visible while the live D1 country index, immutable country directory, globe runtime, geometry, and capital index load in parallel. The index contains a row for every mapped country and is assembled directly from current per-country records; no R2 world object is read. The client refreshes the server index every minute. Country selection uses the already-loaded server record and never calls an upstream provider. The startup gate has a hard ten-second deadline; failure becomes a terminal retry screen instead of an indefinite loader.

The server is the freshness owner. Its one-minute Cron Trigger refreshes the global provider set and publishes two five-country jobs to `worldpulse-news-refresh`. Cloudflare Queues invokes at most two consumers concurrently, delivers one job per invocation, and retries failures up to five times. Each country scan combines a three-day Google News query with broader Google, Bing, GDELT, and available regional feeds. Successful jobs write independent records to D1. The free-plan schedule advances ten countries per minute, so all 215 countries are checked in roughly 22 minutes without exceeding the 50-subrequest Worker limit or the 10,000 daily Queue-operation allowance. Site traffic is read-only with respect to news collection. Upstream failure preserves the last valid D1 record; it does not publish or serve a prepared world object.

## API boundaries

- `main.py` defines HTTP transport, validation, CORS, and consistent error responses.
- `services.py` owns database queries, pagination, and response serialization.
- `models.py` defines normalized relational entities.
- `scoring.py` contains the deterministic impact estimate.
- `providers/` contains an abstract provider and a mock implementation.
- `seed.py` creates a complete fictional demo dataset.

FastAPI exposes OpenAPI documentation at `/docs` and its schema at `/openapi.json`.

## Persistence model

Articles remain separate from events. An event can have many articles, each with one source. Events have a primary country and many affected countries through `event_countries`. This supports future clustering without inflating event importance from duplicate articles.

The hosted worker stores successful global, map-batch, and focused-country results in D1 by normalized request identity. `/api/live-news?scope=world-live` assembles the current response directly from those rows with `Cache-Control: no-store`; the removed prepared-world and snapshot routes return HTTP 410. The `/api/live-video?mode=newsrooms` route searches several live-news surfaces in parallel, accepts only currently live results whose channel exactly matches the curated newsroom directory, retains one strongest feed per newsroom, and ranks the result by current viewers. Partial search failure is tolerated.

## Failure behavior

The API validates pagination bounds and returns a consistent `{"error": ...}` envelope for HTTP and validation failures. Docker health checks gate dependent services. The web app includes route loading, terminal empty-result handling, and recoverable error states.

## Deployment

Docker Compose is the full local reference deployment. The hosted app packages the Next.js surface, cached feed-metadata proxy, and D1 migration as a Cloudflare-compatible worker. A readiness screen remains above the interface until the country directory, full world sweep, global feed, capital index, and globe runtime are all prepared. Country relevance is checked before a result enters the prepared signal shared by the panel and globe. The breaking ticker and twelve-story Live Situation briefing read the global event feed without exposing a second global-feed panel. RSS media metadata is retained when providers publish a safe article image. The separate Live News directory loads only when opened, updates every ninety seconds while visible, retains the viewer's selected feed when it remains active, and switches cleanly when another newsroom is chosen. Missing current article coverage stays neutral but visibly distinct from the ocean.
