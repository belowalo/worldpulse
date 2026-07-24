from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class SourceOut(BaseModel):
    id: str
    publisher_name: str
    url: str
    country_code: str
    prominence_score: float
    model_config = ConfigDict(from_attributes=True)


class ArticleOut(BaseModel):
    id: str
    headline: str
    original_url: str
    published_at: datetime
    extracted_countries: list[str]
    category: str
    source: SourceOut
    model_config = ConfigDict(from_attributes=True)


class EventOut(BaseModel):
    id: str
    headline: str
    summary: str
    category: str
    importance_score: int = Field(ge=0, le=100)
    importance_label: str
    geographic_scope: str
    primary_country_code: str
    affected_countries: list[str]
    first_seen_at: datetime
    last_updated_at: datetime
    scoring_components: dict[str, float]
    scoring_input: dict[str, float | int]
    generated_summary: bool
    articles: list[ArticleOut]


class EventSummary(BaseModel):
    id: str
    headline: str
    category: str
    importance_score: int
    importance_label: str
    last_updated_at: datetime
    model_config = ConfigDict(from_attributes=True)


class CountryOut(BaseModel):
    iso2: str
    iso3: str
    name: str
    map_id: str
    region: str
    top_event: EventSummary | None = None
    model_config = ConfigDict(from_attributes=True)


class PaginatedEvents(BaseModel):
    items: list[EventOut]
    page: int
    page_size: int
    total: int
    pages: int


class ErrorResponse(BaseModel):
    error: dict[str, str]
