# News provider interface

`worldpulse.providers.base.NewsProvider` isolates retrieval from classification, clustering, scoring, and persistence.

```python
class NewsProvider(ABC):
    @abstractmethod
    async def fetch_recent(self, since: datetime) -> list[ProviderArticle]:
        ...
```

Provider output contains a stable external ID, headline, canonical URL, publisher, publication time, and a licensed body excerpt. A provider must not directly assign WorldPulse event IDs or importance scores.

## Adding an RSS provider

1. Implement `NewsProvider`.
2. Fetch only publisher-provided RSS/Atom feeds whose terms permit ingestion.
3. Normalize timestamps to UTC and retain canonical links.
4. Use the feed GUID plus publisher identity for deduplication.
5. Return metadata to the common clustering pipeline.
6. Add retry, rate-limit, and malformed-feed tests.

RSS content must not be extended with unsupported page scraping.

## Adding a licensed news API

1. Add credentials only through environment variables or the deployment secret store.
2. Map provider publisher IDs to WorldPulse `Source` records.
3. Preserve canonical source URLs and provider provenance.
4. Implement cursoring, quota handling, and idempotent replay.
5. Respect retention and display requirements in the provider contract.

## Downstream pipeline

Provider articles should pass through:

```text
retrieve → normalize → deduplicate → extract countries/category
         → cluster into events → calculate score → persist → publish
```

Clustering must keep articles separate from events. Source count means independent reporting organizations, not URL count. Event descriptions are limited to coverage metadata; factual reporting remains in the attributed headline and linked source.

## Mock provider

`MockNewsProvider` demonstrates the contract without network access or keys. The seed command is intentionally separate so local development remains deterministic.

## Hosted live adapter

The hosted Cloudflare Worker exposes `/api/live-news` for global, country, map-batch, and event-coverage queries. It reads current Google News, Bing News, GDELT, and publisher RSS headline metadata, retains publisher attribution and outbound article links, and stores successful responses in both the edge cache and D1. The browser clusters similar headlines, preserves each publisher as a separate article, and runs the same deterministic scoring model used elsewhere in the product.

The hosted worker collects a fresh global provider set every minute, rotates local-country discovery, and compiles clustering, scoring, and geography into one complete prepared-world response before atomically publishing it. The client starts that minute-version request alongside the globe runtime, country geometry, and bundled capital index. The staged readiness screen stays visible until the complete version and visual runtime are ready. Articles must explicitly reference a country before they enter its signal. Matching records from prepared-world, selected-country, and event searches are merged and rescored as one canonical occurrence. If prepared-world storage is cold or unavailable, the persisted D1 map snapshot and bounded missing-country retry paths remain available. Selecting a completed country is entirely local, concurrent event-coverage searches are capped, and connection lines are limited to a selected story with at least two countries explicitly named in headline evidence.

This adapter does not fetch article bodies, bypass publisher access controls, or present feed metadata as original WorldPulse reporting. A future licensed provider can replace or supplement it without changing the map and panel contracts.
