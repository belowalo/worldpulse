# Impact scoring

WorldPulse importance is a deterministic estimate, not an objective fact. It ranks editorial attention within the product; it does not measure the moral worth of people, countries, or subjects.

## Formula

Each input is normalized to 0–100, multiplied by its documented weight, and summed:

```text
score =
  source_diversity × 0.25 +
  geographic_impact × 0.25 +
  publisher_prominence × 0.20 +
  recency × 0.15 +
  coverage_velocity × 0.15
```

The result is rounded and clamped to 0–100. Missing, negative, infinite, or non-numeric values safely contribute zero.

### Components

**Source diversity (25%)** combines a saturating independent-source count with the number of countries represented by those sources. Syndicated copies should share a source identity and must not count as independent.

**Geographic impact (25%)** combines affected-country count with an editorially governed country-significance input. The latter must be reviewed for bias and should reflect practical reach rather than political preference.

**Publisher prominence (20%)** is an input from source metadata. Prominence reflects verification capacity and reach, not presumed truthfulness.

**Recency (15%)** decays linearly over seven days in the MVP.

**Coverage velocity (15%)** saturates at four genuinely independent articles per hour. It captures a developing signal but cannot dominate the score.

## Labels

| Score | Label |
| --- | --- |
| 80–100 | Major |
| 60–79 | Significant |
| 35–59 | Developing |
| 0–34 | Routine |

Labels are always derived from the calculated score. Many duplicate articles cannot, on their own, make an event major.

## Explainability

Events persist normalized input data and each weighted component contribution. The interface shows these contributions under “Why this score?” so readers can inspect the estimate.

## Testing

Both TypeScript and Python implementations test:

- missing values;
- clamping at 0 and 100;
- every label boundary;
- representative high-impact inputs;
- map colors changing with importance.

Production should consolidate scoring into a single service or shared specification and continuously compare implementations to prevent drift.

## Limitations and governance

Digital news availability is uneven by country and language. Publisher lists, significance values, and extraction models can reproduce structural bias. A production system needs periodic fairness reviews, provenance logs, editorial overrides, and clear display of data gaps.
