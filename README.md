# WorldPulse

WorldPulse is a production-quality MVP for exploring recent world news through an interactive globe. Each country's hue represents the category of its highest-impact active event, while intensity represents a deterministic 0–100 importance estimate. Clicking any mapped country opens its prepared RSS-indexed headlines, publisher links, timestamps, geographic scope, and a plain-language score explanation.

The hosted site keeps its staged startup screen in place until the country directory, every country signal, the global feed, capital coordinates, and the interactive globe have all reached a usable terminal state. A scheduled worker collects fresh global reporting every minute, rotates local-country discovery, prepares clustering and geography on the server, and atomically replaces one complete ready-to-render world version in object storage. Startup downloads that latest completed minute-version in parallel with the globe assets and reveals the finished interface only after both are ready. If the minute-version is unavailable, the previous persisted whole-world and bounded live-batch paths remain as fallbacks. Only articles with an explicit country reference are eligible for that country's map signal. Country selection reads the completed in-memory index and does not replace the selected country's map signal merely because it was clicked. Selected-country refreshes and focused event searches can still add newer or broader coverage when explicitly requested. The site reads headline-level public feed metadata and leaves article bodies on publisher websites.

## Screenshots

The deployed application is the preferred live preview. A social preview is available at `public/og-globe.png`; add product screenshots here when release snapshots are captured.

## Architecture

- **Web:** Next.js 16, React 19, strict TypeScript, Tailwind CSS, an antialiased high-density Three.js globe renderer, local country geometry, and local capital coordinates.
- **Hosted news API:** A same-origin Cloudflare Worker endpoint queries public RSS indexes, validates and deduplicates articles, and returns country, global, map-summary, event-coverage, and active-newsroom video feeds.
- **Minute world state:** A scheduled worker builds a complete current world version every minute, stores it atomically in R2, and leaves D1-backed country batches available for rolling local discovery and failure recovery.
- **Reference API:** FastAPI, Pydantic validation, SQLAlchemy 2, and PostgreSQL remain available for local full-stack development.
- **Local orchestration:** Docker Compose starts PostgreSQL, migrates and seeds the API, then starts the web app with health checks.
- **Hosted preview:** The browser requests the global feed and bounded cached world batches, keeps the staged readiness screen visible until all country batches and the HD globe runtime are prepared, and then reveals the complete interface at once. The loader displays actual prepared-country progress and remains animated throughout the scan. Stable cache identities, stale-if-error responses, and bounded background refreshes preserve recent valid signals through upstream timeouts. Results are occurrence-matched and publisher-deduplicated. The globe and country panel use the same completed country index, the breaking ticker moves continuously from right to left, every mapped country receives a capital marker or geographic-center fallback, and Live Situation presents twelve leading current global stories with article imagery when available. Live News is an on-demand directory of active broadcasts from established international newsrooms. It ranks one current feed per newsroom by live viewers, refreshes every ninety seconds, preserves the selected player across background updates, and adds a live-updating coverage description from the broadcaster's current listing. Neutral countries remain visible and stable when selected.

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
