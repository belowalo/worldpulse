from worldpulse.scoring import ScoringInput, calculate_news_signal, signal_label


def test_missing_input_is_safe() -> None:
    result = calculate_news_signal(ScoringInput())
    assert 0 <= result.score <= 100
    assert result.label == "Early"


def test_score_is_clamped_at_100() -> None:
    result = calculate_news_signal(
        ScoringInput(
            independent_source_count=100,
            affected_country_count=100,
            age_hours=0,
            articles_per_hour=100,
            article_count=100,
            coverage_window_hours=1,
        )
    )
    assert result.score == 100


def test_label_boundaries() -> None:
    assert signal_label(34) == "Early"
    assert signal_label(35) == "Building"
    assert signal_label(55) == "Strong"
    assert signal_label(75) == "Very strong"


def test_single_fresh_report_has_no_momentum_or_geographic_reach() -> None:
    result = calculate_news_signal(
        ScoringInput(
            independent_source_count=1,
            affected_country_count=1,
            age_hours=0,
            articles_per_hour=0,
            article_count=1,
            coverage_window_hours=0,
        )
    )
    assert result.score == 34
    assert result.label == "Early"
    assert result.components["reporting_momentum"] == 0
    assert result.components["geographic_reach"] == 0
