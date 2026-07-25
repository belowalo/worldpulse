# Architecture

## System overview

WorldPulse separates presentation, domain scoring, ingestion contracts, and persistence.

```text
Browser
  └─ Next.js web app
       ├─ MapLibre + local Natural Earth GeoJSON
       ├─ filters, country panel, methodology
       ├─ live headline clustering and scoring
       └─ same-origin Cloudflare Worker news endpoint
             └─ public RSS metadata index
             └─ FastAPI
                  ├─ query and serialization services
                  ├─ deterministic scoring module
                  ├─ NewsProvider interface
                  └─ SQLAlchemy
                       └─ PostgreSQL
```

The web app is at the repository root because the deployable Sites runtime expects the application, worker entry point, and build output there. The backend is isolated in `apps/api`. This preserves a monorepo workflow without duplicating the web package.

## Web boundaries

- `components/world-map.tsx` owns MapLibre lifecycle, country hit testing, zoom/pan, hover, and selection styling.
- `components/world-pulse-app.tsx` owns view state, filters, country/global switching, event cards, and methodology.
- `lib/scoring.ts` is UI-independent and contains score labels plus reusable category/intensity map styling.
- `lib/live-news.ts` classifies and clusters live headline metadata into scored events.
- `lib/seed-data.ts` retains deterministic data for backend development and tests.
- `public/countries.geojson` is a local, deployment-safe country dataset derived from the ISC-licensed `geojson-world-map` package.

The map canvas supports pointer navigation and direct country selection across all 215 geometries in the bundled dataset. Every country triggers a focused live query; countries without current matches show an explicit empty state and continue refreshing. The global feed infers country signals from current headline mentions so map colors improve as live metadata arrives.

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

## Failure behavior

The API validates pagination bounds and returns a consistent `{"error": ...}` envelope for HTTP and validation failures. Docker health checks gate dependent services. The web app includes route loading, empty-result, and recoverable error states.

## Deployment

Docker Compose is the full local reference deployment. The hosted app packages the Next.js surface and a cached RSS-metadata proxy as a Cloudflare-compatible worker. Browser clients refresh every ten minutes; upstream failures produce recoverable error states without mislabeling seeded content as live.
