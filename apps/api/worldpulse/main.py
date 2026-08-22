from fastapi import Depends, FastAPI, HTTPException, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text
from sqlalchemy.orm import Session

from .config import settings
from .database import get_db
from .schemas import CountryOut, EventOut, PaginatedEvents
from .services import get_country, get_event, list_countries, list_events

app = FastAPI(
    title="Hemisphere Herald API",
    version="0.1.0",
    description="Country and event signals for the Hemisphere Herald MVP.",
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=False,
    allow_methods=["GET"],
    allow_headers=["*"],
)


@app.exception_handler(HTTPException)
async def http_error(_: Request, exc: HTTPException) -> JSONResponse:
    return JSONResponse(
        status_code=exc.status_code,
        content={"error": {"code": f"http_{exc.status_code}", "message": str(exc.detail)}},
    )


@app.exception_handler(RequestValidationError)
async def validation_error(_: Request, exc: RequestValidationError) -> JSONResponse:
    return JSONResponse(
        status_code=422,
        content={
            "error": {
                "code": "validation_error",
                "message": "Request parameters are invalid.",
                "details": str(exc.errors()),
            }
        },
    )


@app.get("/health")
def health(db: Session = Depends(get_db)) -> dict[str, str]:
    db.execute(text("SELECT 1"))
    return {"status": "ok"}


@app.get(f"{settings.api_prefix}/countries", response_model=list[CountryOut])
def countries(db: Session = Depends(get_db)) -> list[CountryOut]:
    return list_countries(db)


@app.get(f"{settings.api_prefix}/countries/{{iso2}}", response_model=CountryOut)
def country_detail(iso2: str, db: Session = Depends(get_db)) -> CountryOut:
    return get_country(db, iso2)


@app.get(f"{settings.api_prefix}/countries/{{iso2}}/events", response_model=PaginatedEvents)
def country_events(
    iso2: str,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    category: str | None = None,
    importance: str | None = None,
    search: str | None = Query(None, max_length=120),
    db: Session = Depends(get_db),
) -> PaginatedEvents:
    get_country(db, iso2)
    return list_events(
        db,
        page=page,
        page_size=page_size,
        country=iso2,
        category=category,
        importance=importance,
        search=search,
    )


@app.get(f"{settings.api_prefix}/events", response_model=PaginatedEvents)
def global_events(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    category: str | None = None,
    importance: str | None = None,
    search: str | None = Query(None, max_length=120),
    db: Session = Depends(get_db),
) -> PaginatedEvents:
    return list_events(
        db,
        page=page,
        page_size=page_size,
        category=category,
        importance=importance,
        search=search,
    )


@app.get(f"{settings.api_prefix}/events/{{event_id}}", response_model=EventOut)
def event_detail(event_id: str, db: Session = Depends(get_db)) -> EventOut:
    return get_event(db, event_id)


@app.get(f"{settings.api_prefix}/filters")
def filters() -> dict[str, list[str]]:
    return {
        "categories": [
            "Politics",
            "Economy",
            "Conflict and security",
            "Environment",
            "Health",
            "Science and technology",
            "Culture and sports",
            "Other",
        ],
        "importance_labels": ["Major", "Significant", "Developing", "Routine"],
        "geographic_scopes": ["Global", "International", "National", "Regional", "Local"],
        "time_ranges": ["24 hours", "3 days", "7 days"],
    }
