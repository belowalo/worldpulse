# News provider interface

`worldpulse.providers.base.NewsProvider` isolates retrieval from classification, clustering, scoring, and persistence.

```python
class NewsProvider(ABC):
    @abstractmethod
    async def fetch_recent(self, since: datetime) -> list[ProviderArticle]:
        ...
```

Provider output contains a stable external ID, headline, canonical URL, publisher, publication time, and a licensed body excerpt. A provider must not directly assign Hemisphere Herald event IDs or importance scores.

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
2. Map provider publisher IDs to Hemisphere Herald `Source` records.
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

The Oracle collector reads current Google News, Bing News, GDELT, and publisher RSS headline metadata, retains publisher attribution and outbound article links, and maintains the complete current country index. The hosted Cloudflare Worker exposes only the complete `world-live` feed; it does not run a second collection or persistence path. The browser clusters similar headlines, preserves each publisher as a separate article, and runs the same deterministic scoring model used elsewhere in the product.

The Oracle live server continuously refreshes the oldest country records from multiple current indexes and refreshes the global provider set every five minutes. The client reads the complete live index through the Cloudflare proxy, polls it every minute, and uses the already-loaded country record whenever a country is selected. Articles must explicitly reference a country before they enter its signal. A failed provider call keeps current last-known-good articles visible while the collector continues retrying. There is no prepared-world, Cloudflare Queue, D1 world index, or R2 snapshot delivery path.

This adapter does not fetch article bodies, bypass publisher access controls, or present feed metadata as original Hemisphere Herald reporting. A future licensed provider can replace or supplement it without changing the map and panel contracts.
