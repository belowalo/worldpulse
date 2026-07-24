# Architecture

## System overview

WorldPulse separates presentation, domain scoring, ingestion contracts, and persistence.

```text
Browser
  └─ Next.js web app
       ├─ MapLibre + local Natural Earth GeoJSON
       ├─ filters, country panel, methodology
       └─ typed seed adapter / future API adapter
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
- `lib/seed-data.ts` adapts deterministic seed events into country pulses.
- `public/countries.geojson` is a local, deployment-safe country dataset derived from the ISC-licensed `geojson-world-map` package.

The map canvas supports pointer navigation. A row of semantic country buttons provides an equivalent keyboard-accessible selection path for featured countries. Text labels, score labels, and a legend ensure that color is never the only signal.

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

Docker Compose is the full local reference deployment. The hosted demo packages the Next.js surface as a Cloudflare-compatible worker and keeps seed data in the bundle so the map remains usable when a Python service is unavailable.
