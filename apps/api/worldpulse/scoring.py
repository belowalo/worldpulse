from dataclasses import asdict, dataclass
from math import isfinite, log2

WEIGHTS = {
    "corroboration": 0.45,
    "reporting_momentum": 0.25,
    "freshness": 0.20,
    "geographic_reach": 0.10,
}


def clamp(value: float | int | None, minimum: float = 0, maximum: float = 100) -> float:
    numeric = float(value or 0)
    if not isfinite(numeric):
        return minimum
    return min(maximum, max(minimum, numeric))


def signal_label(score: float) -> str:
    safe = clamp(score)
    if safe >= 75:
        return "Very strong"
    if safe >= 55:
        return "Strong"
    if safe >= 35:
        return "Building"
    return "Early"


@dataclass(slots=True)
class ScoringInput:
    independent_source_count: int = 0
    affected_country_count: int = 0
    age_hours: float = 168
    articles_per_hour: float = 0
    article_count: int = 0
    coverage_window_hours: float = 0


@dataclass(slots=True)
class ScoreResult:
    score: int
    label: str
    components: dict[str, float]
    input: dict[str, float | int]


def calculate_news_signal(data: ScoringInput) -> ScoreResult:
    source_count = max(0, data.independent_source_count)
    corroboration = clamp((log2(source_count + 1) / log2(9)) * 100)
    country_count = max(0, data.affected_country_count)
    geographic_reach = 0 if country_count <= 1 else clamp(((country_count - 1) / 5) * 100)
    normalized = {
        "corroboration": corroboration,
        "reporting_momentum": clamp((data.articles_per_hour / 3) * 100),
        "freshness": clamp(100 - (data.age_hours / 168) * 100),
        "geographic_reach": geographic_reach,
    }
    components = {name: round(value * WEIGHTS[name], 1) for name, value in normalized.items()}
    score = round(clamp(sum(components.values())))
    return ScoreResult(score, signal_label(score), components, asdict(data))
