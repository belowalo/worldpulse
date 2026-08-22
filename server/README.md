# WorldPulse live server

This service continuously rotates through every country in `public/countries.geojson`, refreshes the global feed every five minutes, and atomically persists the newest complete live index. The public `world-live` endpoint remains unavailable until every country has been attempted once, so the website never switches to a partially bootstrapped server.

The Oracle deployment runs as a restricted system user under `systemd`. It exposes only the prepared `GET /api/live-news?scope=world-live` response and `GET /healthz`; clicking a country in the website never starts provider work.
