"""Initial Hemisphere Herald schema."""

import sqlalchemy as sa

from alembic import op

revision = "0001_initial"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "countries",
        sa.Column("iso2", sa.String(2), primary_key=True),
        sa.Column("iso3", sa.String(3), nullable=False, unique=True),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("map_id", sa.String(16), nullable=False, unique=True),
        sa.Column("region", sa.String(80), nullable=False),
    )
    op.create_table(
        "sources",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("publisher_name", sa.String(160), nullable=False),
        sa.Column("url", sa.String(500), nullable=False),
        sa.Column("country_code", sa.String(2), nullable=False),
        sa.Column("prominence_score", sa.Float(), nullable=False),
    )
    op.create_table(
        "events",
        sa.Column("id", sa.String(80), primary_key=True),
        sa.Column("headline", sa.String(300), nullable=False),
        sa.Column("summary", sa.Text(), nullable=False),
        sa.Column("category", sa.String(64), nullable=False),
        sa.Column("importance_score", sa.Integer(), nullable=False),
        sa.Column("importance_label", sa.String(32), nullable=False),
        sa.Column("geographic_scope", sa.String(32), nullable=False),
        sa.Column(
            "primary_country_code", sa.String(2), sa.ForeignKey("countries.iso2"), nullable=False
        ),
        sa.Column("first_seen_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("scoring_components", sa.JSON(), nullable=False),
        sa.Column("scoring_input", sa.JSON(), nullable=False),
        sa.Column("generated_summary", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.true()),
    )
    op.create_index("ix_events_category", "events", ["category"])
    op.create_index("ix_events_importance_score", "events", ["importance_score"])
    op.create_table(
        "event_countries",
        sa.Column(
            "event_id",
            sa.String(80),
            sa.ForeignKey("events.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "country_code",
            sa.String(2),
            sa.ForeignKey("countries.iso2", ondelete="CASCADE"),
            primary_key=True,
        ),
    )
    op.create_table(
        "articles",
        sa.Column("id", sa.String(100), primary_key=True),
        sa.Column("headline", sa.String(300), nullable=False),
        sa.Column("original_url", sa.String(500), nullable=False),
        sa.Column("source_id", sa.String(64), sa.ForeignKey("sources.id"), nullable=False),
        sa.Column("published_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("extracted_countries", sa.JSON(), nullable=False),
        sa.Column("category", sa.String(64), nullable=False),
        sa.Column(
            "event_id",
            sa.String(80),
            sa.ForeignKey("events.id", ondelete="CASCADE"),
            nullable=False,
        ),
    )
    op.create_index("ix_articles_event_id", "articles", ["event_id"])


def downgrade() -> None:
    op.drop_table("articles")
    op.drop_table("event_countries")
    op.drop_table("events")
    op.drop_table("sources")
    op.drop_table("countries")
