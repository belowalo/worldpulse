import type {
  Category,
  SignalLabel,
  ScoringComponents,
  ScoringInput,
} from "./types";

const WEIGHTS = {
  corroboration: 0.45,
  reportingMomentum: 0.25,
  freshness: 0.2,
  geographicReach: 0.1,
} as const;

const CATEGORY_COLORS: Record<Category, string> = {
  Politics: "#a78bfa",
  Economy: "#3b82f6",
  "Conflict and security": "#fb4d5f",
  "Crime and justice": "#f97316",
  Environment: "#22c55e",
  "Weather and disasters": "#f59e0b",
  Health: "#ec4899",
  "Science and technology": "#06b6d4",
  "Society and education": "#818cf8",
  "Travel and transport": "#14b8a6",
  "Culture and entertainment": "#d946ef",
  Sports: "#84cc16",
  "Food and agriculture": "#facc15",
  "Local affairs": "#38bdf8",
  Other: "#94a3b8",
};

const clamp = (value: number, min = 0, max = 100) =>
  Math.min(max, Math.max(min, Number.isFinite(value) ? value : 0));

export function signalLabel(score: number): SignalLabel {
  const safeScore = clamp(score);
  if (safeScore >= 75) return "Very strong";
  if (safeScore >= 55) return "Strong";
  if (safeScore >= 35) return "Building";
  return "Early";
}

export function calculateNewsSignal(input: Partial<ScoringInput>): {
  score: number;
  label: SignalLabel;
  components: ScoringComponents;
} {
  const sourceCount = Math.max(0, input.independentSourceCount ?? 0);
  const corroboration = clamp(
    (Math.log2(sourceCount + 1) / Math.log2(9)) * 100,
  );
  const affectedCountryCount = Math.max(0, input.affectedCountryCount ?? 0);
  const geographicReach =
    affectedCountryCount <= 1
      ? 0
      : clamp(((affectedCountryCount - 1) / 5) * 100);
  const freshness = clamp(100 - ((input.ageHours ?? 168) / 168) * 100);
  const reportingMomentum = clamp(
    ((input.articlesPerHour ?? 0) / 3) * 100,
  );

  const components: ScoringComponents = {
    corroboration:
      Math.round(corroboration * WEIGHTS.corroboration * 10) / 10,
    reportingMomentum:
      Math.round(reportingMomentum * WEIGHTS.reportingMomentum * 10) / 10,
    freshness: Math.round(freshness * WEIGHTS.freshness * 10) / 10,
    geographicReach:
      Math.round(geographicReach * WEIGHTS.geographicReach * 10) / 10,
  };

  const score = Math.round(
    clamp(
      components.corroboration +
        components.reportingMomentum +
        components.freshness +
        components.geographicReach,
    ),
  );

  return { score, label: signalLabel(score), components };
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
  if (!category) return { fillColor: "#303a47", fillOpacity: 0.82 };
  const intensity = 0.72 + clamp(importanceScore) * 0.0028;
  return {
    fillColor: mixHex(CATEGORY_COLORS[category], "#182333", intensity),
    fillOpacity: 0.94,
  };
}

export function categoryColor(category: Category) {
  return CATEGORY_COLORS[category];
}

export const scoringWeights = WEIGHTS;
