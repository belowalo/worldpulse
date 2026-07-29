# Architecture

## System overview

WorldPulse separates presentation, domain scoring, ingestion contracts, and persistence.

```text
Browser
  └─ Next.js web app
       ├─ high-density Three.js globe + local GeoJSON/capital coordinates
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

- `components/world-map.tsx` owns the lean Three.js/WebGL lifecycle, high-density canvas country texture and hit map, orbit controls, capital signal markers, selected-story arcs, hover, and selection.
- `components/world-pulse-app.tsx` owns startup readiness, filters, country selection, the breaking-news ticker, Live Situation, event cards, and methodology.
- `lib/globe-runtime.ts` is the dynamically loaded, tree-shaken Three.js runtime boundary.
- `lib/scoring.ts` is UI-independent and contains score labels plus reusable category/intensity globe styling.
- `lib/live-news.ts` classifies and clusters live headline metadata into scored events.
- `lib/seed-data.ts` contains only the initial country metadata used before the full map directory loads.
- `public/countries.geojson` is a local, deployment-safe country dataset derived from the ISC-licensed `geojson-world-map` package.
- `public/world-capitals.json` is the bundled ISO-to-capital coordinate index used for signal markers and selected-story connection endpoints.

The globe supports pointer navigation and direct country selection across all 215 geometries in the bundled dataset. Country fills and the click-hit surface are drawn into high-density canvas textures and applied to one smooth sphere mesh. Signal markers share one geometry and resolve to national capitals, selected-story arcs use capped smooth tubes, device pixel ratio is bounded, and rendering pauses while the page is hidden. Country selection does not invalidate the globe texture, avoiding a costly redraw on the primary interaction path.

Startup keeps the staged readiness screen visible while a stable batched sweep retrieves up to 32 current, explicitly related articles for each map area and the global feed, globe runtime, country geometry, and capital index load in parallel. Every country resolves to a verified signal, a retry result, or a truthful terminal neutral state before the interface opens. That response populates both the color signal and country panel, avoiding a second 215-country request storm after startup. Stable retry batches can reuse persisted snapshots, and recent valid signals survive transient provider failures.

Ten-minute active-feed updates and periodic full-world refreshes keep signals current. Country selection is local, selected-country refreshes remain focused, and concurrent event-coverage searches are capped so clicks cannot trigger an unbounded request cascade. The map receives no connection data on country selection; a line is produced only after a story is selected and at least two countries are explicitly present in the story and article headlines.

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

The hosted worker also stores successful JSON feed snapshots in D1 by normalized request identity. Edge cache hits younger than five minutes return immediately. Recent map snapshots can be served stale while a background refresh runs, and a forced refresh merges current results with still-valid stored articles rather than replacing good signals with transient empty responses. Selected-country, global, and event queries use the same stale-while-refresh and stale-if-error behavior for temporary upstream resilience.

## Failure behavior

The API validates pagination bounds and returns a consistent `{"error": ...}` envelope for HTTP and validation failures. Docker health checks gate dependent services. The web app includes route loading, terminal empty-result handling, and recoverable error states.

## Deployment

Docker Compose is the full local reference deployment. The hosted app packages the Next.js surface, cached feed-metadata proxy, and D1 migration as a Cloudflare-compatible worker. A readiness screen remains above the interface until the country directory, full world sweep, global feed, capital index, and globe runtime are all prepared. Country relevance is checked before a result enters the prepared signal shared by the panel and globe. The breaking ticker and Live Situation read the global event feed without exposing a second global-feed panel. Missing current coverage stays neutral.
