# Architecture

## System overview

Hemisphere Herald separates presentation, domain scoring, ingestion contracts, and persistence.

```text
Browser
  └─ Next.js web app
       ├─ MapLibre satellite terrain globe + local GeoJSON/capital coordinates
       ├─ filters, country panel, methodology, Live Situation
       ├─ capital signal markers + evidence-only story connections
       └─ same-origin Cloudflare Worker endpoint
            ├─ streams the complete live world index
            └─ Oracle Always Free live server
                 ├─ two continuous country collector lanes
                 ├─ five-minute global collector
                 ├─ public Google News, Bing, GDELT, and regional feeds
                 ├─ atomic restart-recovery records
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

- `components/world-map-maplibre.tsx` owns the MapLibre lifecycle, satellite imagery and terrain providers, GeoJSON country overlays, capital signal markers, selected-story arcs, hover, and selection.
- `components/world-pulse-app.tsx` owns startup readiness, filters, country selection, the breaking-news ticker, image-backed Live Situation briefing, auto-refreshing Live News directory, event cards, and methodology.
- `lib/scoring.ts` is UI-independent and contains score labels plus reusable category/intensity globe styling.
- `lib/live-news.ts` classifies and clusters live headline metadata into scored events.
- `lib/seed-data.ts` contains only the initial country metadata used before the full map directory loads.
- `public/countries.geojson` is a local, deployment-safe country dataset derived from the ISC-licensed `geojson-world-map` package.
- `public/world-capitals.json` is the bundled ISO-to-capital coordinate index used for signal markers and selected-story connection endpoints.

The globe supports pointer navigation and direct country selection across all 215 geometries in the bundled dataset. MapLibre renders EOX Sentinel-2 cloudless imagery with AWS Terrarium elevation tiles. Translucent GeoJSON polygons retain Hemisphere Herald country colors while allowing the satellite surface to remain visible. Every mapped country receives one or more capital markers when capital data exists and a geographic-center fallback otherwise. The camera never rotates automatically, and country hover/selection updates only the indexed map sources rather than reprocessing the complete dataset.

Startup keeps the staged readiness screen visible while the live Oracle country index, immutable country directory, globe runtime, geometry, and capital index load in parallel. The live endpoint is not exposed as ready until every mapped country has been attempted at least once. The client refreshes the server index every minute. Country selection uses the already-loaded server record and never calls an upstream provider. The startup gate has a hard ten-second network deadline; failure becomes a terminal retry screen instead of an indefinite loader.

The Oracle server is the freshness owner. A long-running `systemd` process continuously assigns the oldest-scanned countries to two collector lanes. Each country scan combines a three-day Google News query with broader Google, Bing, GDELT, and available regional feeds; the loop immediately begins again after completing all 215 countries. A separate collector refreshes global reporting every five minutes. Site traffic is read-only with respect to news collection. Upstream failure preserves current last-known-good articles and the service persists records atomically so a restart resumes with usable data. The Cloudflare Worker performs no world-feed collection, scheduling, queueing, or D1 assembly; it only streams the current Oracle response with `Cache-Control: no-store`.

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

`/api/live-news?scope=world-live` streams the current complete Oracle response with `Cache-Control: no-store`; the removed prepared-world and snapshot routes return HTTP 410. `/api/diagnostics/world` reports collector progress and countries without matching current coverage. The `/api/live-video?mode=newsrooms` route searches several live-news surfaces in parallel, accepts only currently live results whose channel exactly matches the curated newsroom directory, retains one strongest feed per newsroom, and ranks the result by current viewers. Partial search failure is tolerated.

## Failure behavior

The API validates pagination bounds and returns a consistent `{"error": ...}` envelope for HTTP and validation failures. Docker health checks gate dependent services. The web app includes route loading, terminal empty-result handling, and recoverable error states.

## Deployment

Docker Compose is the full local reference deployment. The hosted app packages the Next.js surface and thin Oracle proxy as a Cloudflare-compatible worker; the continuous collector runs independently on Oracle. A readiness screen remains above the interface until the country directory, full world sweep, global feed, capital index, and globe runtime are all prepared. Country relevance is checked before a result enters the signal shared by the panel and globe. The breaking ticker and twelve-story Live Situation briefing read the global event feed without exposing a second global-feed panel. RSS media metadata is retained when providers publish a safe article image. The separate Live News directory loads only when opened, updates every ninety seconds while visible, retains the viewer's selected feed when it remains active, and switches cleanly when another newsroom is chosen. Missing current article coverage stays neutral but visibly distinct from the ocean.
