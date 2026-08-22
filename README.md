# WorldPulse

WorldPulse is a production-quality MVP for exploring recent world news through an interactive globe. Each country's hue represents the category of its highest-impact active event, while intensity represents a deterministic 0–100 importance estimate. Clicking any mapped country opens the current server-indexed headlines, publisher links, timestamps, geographic scope, and a plain-language score explanation.

The hosted site is driven by continuously updated per-country records in D1, with no prepared-world object or R2 snapshot in the delivery path. A one-minute scheduled Worker refreshes global reporting and publishes two bounded country jobs to Cloudflare Queues. Durable consumers scan five countries per job through Google News, Bing News, GDELT, and available regional feeds, retry failures, and write results into D1. On the free Cloudflare plan this advances ten countries per minute and completes all 215 countries in roughly 22 minutes. A browser opening WorldPulse only reads the current D1 country index and polls it every minute; country selection never invokes an upstream news provider. The globe and panel update in place when the next server record arrives. Only articles with an explicit country reference are eligible for that country's map signal. The site reads headline-level public feed metadata and leaves article bodies on publisher websites.

## Screenshots

The deployed application is the preferred live preview. A social preview is available at `public/og-globe.png`; add product screenshots here when release snapshots are captured.

## Architecture

- **Web:** Next.js 16, React 19, strict TypeScript, Tailwind CSS, an antialiased high-density Three.js globe renderer, local country geometry, and local capital coordinates.
- **Hosted news API:** A same-origin Cloudflare Worker endpoint queries public RSS indexes, validates and deduplicates articles, and returns country, global, map-summary, event-coverage, and active-newsroom video feeds.
- **Durable live ingestion:** A scheduled Worker publishes bounded refresh jobs every minute. Cloudflare Queues supplies durable delivery and retries, while D1 stores independent country feeds and failure recovery; no R2 world object is created.
- **Reference API:** FastAPI, Pydantic validation, SQLAlchemy 2, and PostgreSQL remain available for local full-stack development.
- **Local orchestration:** Docker Compose starts PostgreSQL, migrates and seeds the API, then starts the web app with health checks.
- **Hosted preview:** The browser requests the live D1 country index, loads the globe runtime and bundled geography in parallel, and then refreshes that index every minute. Selecting a country reads the already-loaded server record and makes no provider request. Multi-provider queue ingestion, stable cache identities, retries, and last-valid D1 records preserve reporting through upstream timeouts. Results are occurrence-matched and publisher-deduplicated. The breaking ticker moves continuously from right to left, every mapped country receives a capital marker or geographic-center fallback, and Live Situation presents twelve leading current global stories with article imagery when available. Live News is an on-demand directory of active broadcasts from established international newsrooms.

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
- Metadata summaries are short factual extracts from available feed descriptions and link directly to the underlying reporting.
- Political reporting uses neutral interface language.
- Timestamps, source counts, geographic scope, and affected countries are retained.
- Countries with less digital reporting or fewer accessible sources may appear less active.
- The map summary and live feeds retain canonical source links and publisher attribution.
- Cross-border lines appear only after a story is selected and only when at least two countries are explicitly named in its headline evidence.
- Capital markers are geographic reference points; they do not imply that an event happened in the capital.

## Current limitations

- Live coverage depends on the upstream RSS index and can be delayed, incomplete, or uneven across countries.
- Headlines are clustered heuristically; they are not reviewed by a human editor.
- No authentication, personalization, alerting, or editorial administration is included.
- Event clustering and multilingual entity extraction remain heuristic rather than editorially reviewed.
- Source prominence and country-significance inputs require editorial governance in a real deployment.

## Extensions requiring external services or editorial operations

1. Add licensed news APIs and additional publisher-provided RSS feeds.
2. Cluster articles into events with multilingual embeddings and human-review tooling.
3. Add multilingual summaries, names, and search.
4. Add editorial cache controls and per-provider freshness monitoring.
5. Add ingestion observability, provenance audits, editorial overrides, and deployment automation.

See [news-provider-interface.md](docs/news-provider-interface.md) for the integration boundary.
