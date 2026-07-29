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

After loading the country geometry, the client starts a stable batched sweep for every map area and loads the global feed in parallel. The readiness screen stays visible until the full sweep, all bounded retries, the global feed, and the globe runtime have settled. Articles must explicitly reference the requested country before they can enter its feed. Each batch supplies both the globe signal and the country panel, avoiding a duplicate all-country hydration pass. Matching records from globe, selected-country, global, and event searches are merged and rescored as one canonical occurrence. Fresh responses are reused immediately; recent stored results can be shown while they refresh, and failed fresh requests fall back to the last still-valid snapshot. Failed or omitted countries receive bounded automatic retries using stable batch identities, followed by a focused country search or an explicit terminal neutral state. Selecting a completed country is entirely local, and concurrent event-coverage searches are capped.

This adapter does not fetch article bodies, bypass publisher access controls, or present feed metadata as original WorldPulse reporting. A future licensed provider can replace or supplement it without changing the map and panel contracts.
