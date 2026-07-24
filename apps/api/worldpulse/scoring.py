from dataclasses import asdict, dataclass
from math import isfinite

WEIGHTS = {
    "source_diversity": 0.25,
    "geographic_impact": 0.25,
    "publisher_prominence": 0.20,
    "recency": 0.15,
    "coverage_velocity": 0.15,
}


def clamp(value: float | int | None, minimum: float = 0, maximum: float = 100) -> float:
    numeric = float(value or 0)
    if not isfinite(numeric):
        return minimum
    return min(maximum, max(minimum, numeric))


def importance_label(score: float) -> str:
    safe = clamp(score)
    if safe >= 80:
        return "Major"
    if safe >= 60:
        return "Significant"
    if safe >= 35:
        return "Developing"
    return "Routine"


@dataclass(slots=True)
class ScoringInput:
    independent_source_count: int = 0
    source_country_count: int = 0
    affected_country_count: int = 0
    country_significance: float = 0
    publisher_prominence: float = 0
    age_hours: float = 168
    articles_per_hour: float = 0


@dataclass(slots=True)
class ScoreResult:
    score: int
    label: str
    components: dict[str, float]
    input: dict[str, float | int]


def calculate_importance(data: ScoringInput) -> ScoreResult:
    sources = clamp((data.independent_source_count / 8) * 72 + (data.source_country_count / 5) * 28)
    geography = clamp(
        (data.affected_country_count / 10) * 65 + clamp(data.country_significance) * 0.35
    )
    normalized = {
        "source_diversity": sources,
        "geographic_impact": geography,
        "publisher_prominence": clamp(data.publisher_prominence),
        "recency": clamp(100 - (data.age_hours / 168) * 100),
        "coverage_velocity": clamp((data.articles_per_hour / 4) * 100),
    }
    components = {name: round(value * WEIGHTS[name], 1) for name, value in normalized.items()}
    score = round(clamp(sum(components.values())))
    return ScoreResult(score, importance_label(score), components, asdict(data))
