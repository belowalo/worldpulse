import type {
  Category,
  ImportanceLabel,
  ScoringComponents,
  ScoringInput,
} from "./types";

const WEIGHTS = {
  sourceDiversity: 0.25,
  geographicImpact: 0.25,
  publisherProminence: 0.2,
  recency: 0.15,
  coverageVelocity: 0.15,
} as const;

const CATEGORY_COLORS: Record<Category, string> = {
  Politics: "#9a7cff",
  Economy: "#4c9dff",
  "Conflict and security": "#ff5d6c",
  Environment: "#48c78e",
  Health: "#ff9b55",
  "Science and technology": "#3ed5e5",
  "Culture and sports": "#f1cf57",
  Other: "#8b95a6",
};

const clamp = (value: number, min = 0, max = 100) =>
  Math.min(max, Math.max(min, Number.isFinite(value) ? value : 0));

export function importanceLabel(score: number): ImportanceLabel {
  const safeScore = clamp(score);
  if (safeScore >= 80) return "Major";
  if (safeScore >= 60) return "Significant";
  if (safeScore >= 35) return "Developing";
  return "Routine";
}

export function calculateImportance(input: Partial<ScoringInput>): {
  score: number;
  label: ImportanceLabel;
  components: ScoringComponents;
} {
  const sources = clamp(
    ((input.independentSourceCount ?? 0) / 8) * 72 +
      ((input.sourceCountryCount ?? 0) / 5) * 28,
  );
  const geography = clamp(
    ((input.affectedCountryCount ?? 0) / 10) * 65 +
      clamp(input.countrySignificance ?? 0) * 0.35,
  );
  const prominence = clamp(input.publisherProminence ?? 0);
  const recency = clamp(100 - ((input.ageHours ?? 168) / 168) * 100);
  const velocity = clamp(((input.articlesPerHour ?? 0) / 4) * 100);

  const components: ScoringComponents = {
    sourceDiversity: Math.round(sources * WEIGHTS.sourceDiversity * 10) / 10,
    geographicImpact: Math.round(geography * WEIGHTS.geographicImpact * 10) / 10,
    publisherProminence:
      Math.round(prominence * WEIGHTS.publisherProminence * 10) / 10,
    recency: Math.round(recency * WEIGHTS.recency * 10) / 10,
    coverageVelocity: Math.round(velocity * WEIGHTS.coverageVelocity * 10) / 10,
  };

  const score = Math.round(
    clamp(
      components.sourceDiversity +
        components.geographicImpact +
        components.publisherProminence +
        components.recency +
        components.coverageVelocity,
    ),
  );

  return { score, label: importanceLabel(score), components };
}

function mixHex(foreground: string, background: string, amount: number) {
  const clean = (value: string) => value.replace("#", "");
  const fg = clean(foreground);
  const bg = clean(background);
  const blend = [0, 2, 4]
    .map((index) => {
      const a = Number.parseInt(fg.slice(index, index + 2), 16);
      const b = Number.parseInt(bg.slice(index, index + 2), 16);
      return Math.round(a * amount + b * (1 - amount))
        .toString(16)
        .padStart(2, "0");
    })
    .join("");
  return `#${blend}`;
}

export function mapStyleForEvent(
  category?: Category,
  importanceScore = 0,
): { fillColor: string; fillOpacity: number } {
  if (!category) return { fillColor: "#24444b", fillOpacity: 0.82 };
  const intensity = 0.34 + clamp(importanceScore) * 0.0062;
  return {
    fillColor: mixHex(CATEGORY_COLORS[category], "#263246", intensity),
    fillOpacity: 0.88,
  };
}

export function categoryColor(category: Category) {
  return CATEGORY_COLORS[category];
}

export const scoringWeights = WEIGHTS;
