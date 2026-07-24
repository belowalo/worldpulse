from abc import ABC, abstractmethod
from dataclasses import dataclass
from datetime import datetime


@dataclass(slots=True)
class ProviderArticle:
    external_id: str
    headline: str
    url: str
    publisher: str
    published_at: datetime
    body_excerpt: str


class NewsProvider(ABC):
    """Contract for future RSS or licensed news-API integrations.

    Implementations retrieve attributed article metadata only. Clustering,
    country extraction, scoring, and persistence remain provider-independent.
    """

    @abstractmethod
    async def fetch_recent(self, since: datetime) -> list[ProviderArticle]:
        raise NotImplementedError
