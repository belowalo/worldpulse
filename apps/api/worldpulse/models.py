from datetime import datetime

from sqlalchemy import (
    JSON,
    Boolean,
    Column,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Table,
    Text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base

event_countries = Table(
    "event_countries",
    Base.metadata,
    Column("event_id", ForeignKey("events.id", ondelete="CASCADE"), primary_key=True),
    Column("country_code", ForeignKey("countries.iso2", ondelete="CASCADE"), primary_key=True),
)


class Country(Base):
    __tablename__ = "countries"

    iso2: Mapped[str] = mapped_column(String(2), primary_key=True)
    iso3: Mapped[str] = mapped_column(String(3), unique=True)
    name: Mapped[str] = mapped_column(String(120))
    map_id: Mapped[str] = mapped_column(String(16), unique=True)
    region: Mapped[str] = mapped_column(String(80))


class Source(Base):
    __tablename__ = "sources"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    publisher_name: Mapped[str] = mapped_column(String(160))
    url: Mapped[str] = mapped_column(String(500))
    country_code: Mapped[str] = mapped_column(String(2))
    prominence_score: Mapped[float] = mapped_column(Float)
    articles: Mapped[list["Article"]] = relationship(back_populates="source")


class Event(Base):
    __tablename__ = "events"

    id: Mapped[str] = mapped_column(String(80), primary_key=True)
    headline: Mapped[str] = mapped_column(String(300))
    summary: Mapped[str] = mapped_column(Text)
    category: Mapped[str] = mapped_column(String(64), index=True)
    importance_score: Mapped[int] = mapped_column(Integer, index=True)
    importance_label: Mapped[str] = mapped_column(String(32))
    geographic_scope: Mapped[str] = mapped_column(String(32))
    primary_country_code: Mapped[str] = mapped_column(ForeignKey("countries.iso2"))
    first_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    last_updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    scoring_components: Mapped[dict[str, float]] = mapped_column(JSON)
    scoring_input: Mapped[dict[str, float]] = mapped_column(JSON)
    generated_summary: Mapped[bool] = mapped_column(Boolean, default=True)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    affected_countries: Mapped[list[Country]] = relationship(secondary=event_countries)
    articles: Mapped[list["Article"]] = relationship(
        back_populates="event", cascade="all, delete-orphan"
    )


class Article(Base):
    __tablename__ = "articles"

    id: Mapped[str] = mapped_column(String(100), primary_key=True)
    headline: Mapped[str] = mapped_column(String(300))
    original_url: Mapped[str] = mapped_column(String(500))
    source_id: Mapped[str] = mapped_column(ForeignKey("sources.id"))
    published_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    extracted_countries: Mapped[list[str]] = mapped_column(JSON)
    category: Mapped[str] = mapped_column(String(64))
    event_id: Mapped[str] = mapped_column(ForeignKey("events.id", ondelete="CASCADE"), index=True)
    source: Mapped[Source] = relationship(back_populates="articles")
    event: Mapped[Event] = relationship(back_populates="articles")
