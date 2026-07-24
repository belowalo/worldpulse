from math import ceil

from fastapi import HTTPException
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session, selectinload

from .models import Article, Country, Event
from .schemas import ArticleOut, CountryOut, EventOut, EventSummary, PaginatedEvents


def serialize_event(event: Event) -> EventOut:
    return EventOut(
        id=event.id,
        headline=event.headline,
        summary=event.summary,
        category=event.category,
        importance_score=event.importance_score,
        importance_label=event.importance_label,
        geographic_scope=event.geographic_scope,
        primary_country_code=event.primary_country_code,
        affected_countries=[country.iso2 for country in event.affected_countries],
        first_seen_at=event.first_seen_at,
        last_updated_at=event.last_updated_at,
        scoring_components=event.scoring_components,
        scoring_input=event.scoring_input,
        generated_summary=event.generated_summary,
        articles=[ArticleOut.model_validate(article) for article in event.articles],
    )


def event_query():
    return select(Event).options(
        selectinload(Event.affected_countries),
        selectinload(Event.articles).selectinload(Article.source),
    )


def list_countries(db: Session) -> list[CountryOut]:
    rows = db.scalars(select(Country).order_by(Country.name)).all()
    output: list[CountryOut] = []
    for country in rows:
        event = db.scalar(
            select(Event)
            .join(Event.affected_countries)
            .where(Country.iso2 == country.iso2, Event.active.is_(True))
            .order_by(Event.importance_score.desc(), Event.last_updated_at.desc())
            .limit(1)
        )
        summary = EventSummary.model_validate(event) if event else None
        output.append(
            CountryOut(
                iso2=country.iso2,
                iso3=country.iso3,
                name=country.name,
                map_id=country.map_id,
                region=country.region,
                top_event=summary,
            )
        )
    return output


def get_country(db: Session, iso2: str) -> CountryOut:
    country = db.get(Country, iso2.upper())
    if not country:
        raise HTTPException(status_code=404, detail="Country not found")
    return next(item for item in list_countries(db) if item.iso2 == country.iso2)


def list_events(
    db: Session,
    *,
    page: int,
    page_size: int,
    country: str | None = None,
    category: str | None = None,
    importance: str | None = None,
    search: str | None = None,
) -> PaginatedEvents:
    statement = event_query().where(Event.active.is_(True))
    count_statement = select(func.count(Event.id)).where(Event.active.is_(True))
    if country:
        statement = statement.join(Event.affected_countries).where(Country.iso2 == country.upper())
        count_statement = count_statement.join(Event.affected_countries).where(
            Country.iso2 == country.upper()
        )
    if category:
        statement = statement.where(Event.category == category)
        count_statement = count_statement.where(Event.category == category)
    if importance:
        statement = statement.where(Event.importance_label == importance)
        count_statement = count_statement.where(Event.importance_label == importance)
    if search:
        term = f"%{search.strip()}%"
        predicate = or_(Event.headline.ilike(term), Event.summary.ilike(term))
        statement = statement.where(predicate)
        count_statement = count_statement.where(predicate)
    total = int(db.scalar(count_statement) or 0)
    statement = (
        statement.order_by(Event.importance_score.desc(), Event.last_updated_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    items = [serialize_event(event) for event in db.scalars(statement).unique().all()]
    return PaginatedEvents(
        items=items,
        page=page,
        page_size=page_size,
        total=total,
        pages=ceil(total / page_size) if total else 0,
    )


def get_event(db: Session, event_id: str) -> EventOut:
    event = db.scalar(event_query().where(Event.id == event_id))
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    return serialize_event(event)
