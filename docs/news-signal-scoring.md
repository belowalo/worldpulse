# News signal scoring

Hemisphere Herald’s signal score is a deterministic estimate of how strongly and recently an occurrence is corroborated in the available headline metadata. It does not measure severity, human impact, truth, or the importance of one country relative to another.

## Formula

Each input is normalized to 0–100, multiplied by its documented weight, and summed:

```text
signal =
  corroboration × 0.45 +
  reporting_momentum × 0.25 +
  freshness × 0.20 +
  geographic_reach × 0.10
```

The result is rounded and clamped to 0–100. Missing, negative, infinite, or non-numeric values safely contribute zero.

### Components

**Corroboration (45%)** uses the count of distinct publisher identities and saturates logarithmically at eight publishers. Publisher aliases and repeated articles from the same publication count once.

**Reporting momentum (25%)** is the number of additional matched reports divided by the observed hours between the first and latest report. A single report receives zero momentum points. Momentum saturates at three new reports per hour.

**Freshness (20%)** decays linearly over the current seven-day news window using the newest matched report.

**Geographic reach (10%)** begins only when more than one country is explicitly identified in the event evidence and saturates at six countries. It does not use country-importance or country-significance values.

Publisher prominence does not add signal points. When more than five publishers match, prominence, viewpoint representation for public-affairs topics, and recency help select the five displayed links.

## Labels

| Score | Label |
| --- | --- |
| 75–100 | Very strong |
| 55–74 | Strong |
| 35–54 | Building |
| 0–34 | Early |

Labels describe the reporting signal, not the event itself.

## Explainability

Every event retains the distinct-publisher count, matched-report count, affected-country count, newest-report age, observed coverage window, reports per hour, and each weighted contribution. The interface exposes these values under “Why this signal?”

## Testing and guardrails

Automated tests cover missing values, clamping, every label boundary, single-report behavior, real elapsed-time momentum, map-color intensity, and geographic reach. Production reviews should also monitor score distributions by region, language, topic, and publisher mix so uneven digital reporting does not silently become a proxy for importance.

## Limitations

Digital news availability is uneven by country and language. Headline clustering and country extraction remain heuristic. A high score means that the available reporting is fresh, corroborated, and moving quickly; it does not prove that every claim is correct or that the event is more consequential than a lower-scoring story.
