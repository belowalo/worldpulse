from datetime import UTC, datetime

from .base import NewsProvider, ProviderArticle


class MockNewsProvider(NewsProvider):
    async def fetch_recent(self, since: datetime) -> list[ProviderArticle]:
        published = max(since, datetime(2026, 7, 24, 18, tzinfo=UTC))
        return [
            ProviderArticle(
                external_id="mock-pacific-1",
                headline="Pacific nations agree accelerated coastal resilience plan",
                url="https://example.com/reporting/pacific-climate-pact/1",
                publisher="Reuters",
                published_at=published,
                body_excerpt="Regional leaders agreed a shared financing framework.",
            )
        ]
