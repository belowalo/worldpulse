from datetime import UTC, datetime

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from worldpulse.database import Base, get_db
from worldpulse.main import app
from worldpulse.models import Article, Country, Event, Source

engine = create_engine(
    "sqlite://",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
Base.metadata.create_all(engine)


def override_db():
    with Session(engine) as session:
        yield session


app.dependency_overrides[get_db] = override_db


def seed_test_data() -> None:
    with Session(engine) as session:
        if session.get(Country, "CA"):
            return
        canada = Country(iso2="CA", iso3="CAN", name="Canada", map_id="124", region="North America")
        publisher = Source(
            id="test-source",
            publisher_name="Test News",
            url="https://example.com/source",
            country_code="CA",
            prominence_score=80,
        )
        event = Event(
            id="test-event",
            headline="Test event for Canada",
            summary="A concise attributed test summary.",
            category="Health",
            importance_score=64,
            importance_label="Significant",
            geographic_scope="National",
            primary_country_code="CA",
            first_seen_at=datetime.now(UTC),
            last_updated_at=datetime.now(UTC),
            scoring_components={"source_diversity": 12.5},
            scoring_input={"independent_source_count": 3},
            generated_summary=True,
            active=True,
            affected_countries=[canada],
        )
        event.articles = [
            Article(
                id="test-article",
                headline=event.headline,
                original_url="https://example.com/article",
                published_at=datetime.now(UTC),
                extracted_countries=["CA"],
                category="Health",
                source=publisher,
            )
        ]
        session.add_all([canada, publisher, event])
        session.commit()


seed_test_data()
client = TestClient(app)


def test_health_and_country_events() -> None:
    assert client.get("/health").json() == {"status": "ok"}
    response = client.get("/api/v1/countries/CA/events")
    assert response.status_code == 200
    payload = response.json()
    assert payload["total"] == 1
    assert payload["items"][0]["importance_label"] == "Significant"
    assert payload["items"][0]["articles"][0]["source"]["publisher_name"] == "Test News"


def test_consistent_not_found_error() -> None:
    response = client.get("/api/v1/events/does-not-exist")
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "http_404"
