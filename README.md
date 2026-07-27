# WorldPulse

WorldPulse is a production-quality MVP for exploring recent world news through an interactive map. Each country's hue represents the category of its highest-impact active event, while intensity represents a deterministic 0–100 importance estimate. Clicking any mapped country loads current RSS-indexed headlines, publisher links, timestamps, geographic scope, and a plain-language score explanation.

The hosted site opens the map and controls immediately, then fills the world index progressively from live country searches. No headline bundle ships with the application. A recent server-side live index can appear immediately for up to 30 minutes while a fresh sweep replaces it in the background; genuinely old map data is skipped. The site reads headline-level public RSS metadata and never scrapes or republishes article bodies.

## Screenshots

The deployed application is the preferred live preview. A social preview is available at `public/og.png`; add product screenshots here when release snapshots are captured.

## Architecture

- **Web:** Next.js 16, React 19, strict TypeScript, Tailwind CSS, MapLibre GL JS, and local country geometry.
- **Hosted news API:** A same-origin Cloudflare Worker endpoint queries public RSS indexes, validates and deduplicates articles, and returns country, global, map-summary, and event-coverage feeds.
- **Hosted cache:** Cloudflare edge caching plus D1 persistence streams a recent live index immediately, refreshes it in the background, and provides resilience for deeper country and event feeds.
- **Reference API:** FastAPI, Pydantic validation, SQLAlchemy 2, and PostgreSQL remain available for local full-stack development.
- **Local orchestration:** Docker Compose starts PostgreSQL, migrates and seeds the API, then starts the web app with health checks.
- **Hosted preview:** The browser initially downloads one current map signal per country rather than the complete world article index. Full reporting is fetched when needed and the map is refreshed progressively without blocking interaction.

The web app lives at the repository root to preserve the hosting runtime's required structure. `apps/api` contains the backend. See [architecture.md](docs/architecture.md) for details.

## Quick start with Docker

Requirements: Docker Desktop with Compose.

```bash
cp .env.example .env
docker compose up --build
```

Open:

- Web: `http://localhost:3000`
- API docs: `http://localhost:8000/docs`
- Health check: `http://localhost:8000/health`

The API container applies migrations and runs the idempotent demo seed command on startup.

## Run services separately

### Web

Requires Node.js 22.13 or newer.

```bash
npm install
npm run dev
```

Available quality commands:

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

### API

Requires Python 3.11 or newer and a running PostgreSQL instance.

```bash
cd apps/api
python -m venv .venv
.venv/Scripts/activate
pip install -e ".[dev]"
alembic upgrade head
python -m worldpulse.seed
uvicorn worldpulse.main:app --reload
```

On macOS/Linux, activate with `source .venv/bin/activate`.

Run backend quality checks:

```bash
ruff check .
ruff format --check .
pytest
```

Create a future migration after changing the models:

```bash
alembic revision --autogenerate -m "describe change"
alembic upgrade head
```

## Environment variables

Copy `.env.example` to `.env`. Never commit real credentials.

| Variable | Purpose | Default for local development |
| --- | --- | --- |
| `DATABASE_URL` | SQLAlchemy PostgreSQL connection | `postgresql+psycopg://worldpulse:worldpulse@localhost:5432/worldpulse` |
| `CORS_ORIGINS` | Comma-separated allowed web origins | `http://localhost:3000` |
| `NEXT_PUBLIC_API_URL` | Browser-facing API base URL | `http://localhost:8000/api/v1` |
| `POSTGRES_DB` | Compose database name | `worldpulse` |
| `POSTGRES_USER` | Compose database user | `worldpulse` |
| `POSTGRES_PASSWORD` | Compose database password | `worldpulse` |

## Impact scoring

WorldPulse calculates rather than hard-codes importance labels:

- 25% independent source count and source-country diversity
- 25% affected-country count and significance
- 20% publisher prominence
- 15% recency
- 15% coverage velocity

Scores are clamped to 0–100. Labels are `Major` (80–100), `Significant` (60–79), `Developing` (35–59), and `Routine` (0–34). Publication volume alone cannot produce a major label. Every stored event includes the component contributions shown in the interface. The score is an estimate, not an objective fact; see [impact-scoring.md](docs/impact-scoring.md).

## Responsible presentation

- Every event links to its underlying attributed sources.
- Automated metadata summaries are identified and are not presented as original reporting.
- Demo copy avoids invented quotations and uses neutral language for political subjects.
- Timestamps, source counts, geographic scope, and affected countries are retained.
- Countries with less digital reporting or fewer accessible sources may appear less active.
- The map summary and live feeds retain canonical source links and publisher attribution.

## Current limitations

- Live coverage depends on the upstream RSS index and can be delayed, incomplete, or uneven across countries.
- Headlines are clustered heuristically; they are not reviewed by a human editor.
- Country geometry is intentionally low-resolution for fast rendering.
- No authentication, personalization, alerting, or editorial administration is included.
- Event clustering and multilingual entity extraction remain heuristic rather than editorially reviewed.
- Source prominence and country-significance inputs require editorial governance in a real deployment.

## Roadmap

1. Add licensed news APIs and additional publisher-provided RSS feeds.
2. Cluster articles into events with multilingual embeddings and human-review tooling.
3. Add multilingual summaries, names, and search.
4. Add scheduled ingestion independent of visitor traffic and editorial cache controls.
5. Add ingestion observability, provenance audits, editorial overrides, and deployment automation.

See [news-provider-interface.md](docs/news-provider-interface.md) for the integration boundary.
