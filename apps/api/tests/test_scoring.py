from worldpulse.scoring import ScoringInput, calculate_importance, importance_label


def test_missing_input_is_safe() -> None:
    result = calculate_importance(ScoringInput())
    assert 0 <= result.score <= 100
    assert result.label == "Routine"


def test_score_is_clamped_at_100() -> None:
    result = calculate_importance(
        ScoringInput(
            independent_source_count=100,
            source_country_count=100,
            affected_country_count=100,
            country_significance=100,
            publisher_prominence=100,
            age_hours=0,
            articles_per_hour=100,
        )
    )
    assert result.score == 100


def test_label_boundaries() -> None:
    assert importance_label(34) == "Routine"
    assert importance_label(35) == "Developing"
    assert importance_label(60) == "Significant"
    assert importance_label(80) == "Major"
