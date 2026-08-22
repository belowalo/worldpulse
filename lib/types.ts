export const CATEGORIES = [
  "Politics",
  "Economy",
  "Conflict and security",
  "Crime and justice",
  "Environment",
  "Weather and disasters",
  "Health",
  "Science and technology",
  "Society and education",
  "Travel and transport",
  "Culture and entertainment",
  "Sports",
  "Food and agriculture",
  "Local affairs",
  "Other",
] as const;

export type Category = (typeof CATEGORIES)[number];
export type ImportanceLabel = "Major" | "Significant" | "Developing" | "Routine";
export type GeographicScope =
  | "Global"
  | "International"
  | "National"
  | "Regional"
  | "Local";

export interface Country {
  iso2: string;
  iso3: string;
  name: string;
  mapId: string;
  region: string;
}

export interface NewsSource {
  id: string;
  publisherName: string;
  url: string;
  country: string;
  prominenceScore: number;
}

export interface Article {
  id: string;
  headline: string;
  originalUrl: string;
  imageUrl?: string;
  source: NewsSource;
  publishedAt: string;
  extractedCountries: string[];
  category: Category;
  eventId: string;
  originalHeadline?: string;
  originalLanguage?: string;
}

export interface ScoringInput {
  independentSourceCount: number;
  sourceCountryCount: number;
  affectedCountryCount: number;
  countrySignificance: number;
  publisherProminence: number;
  ageHours: number;
  articlesPerHour: number;
}

export interface ScoringComponents {
  sourceDiversity: number;
  geographicImpact: number;
  publisherProminence: number;
  recency: number;
  coverageVelocity: number;
}

export interface Event {
  id: string;
  headline: string;
  summary: string;
  category: Category;
  matchedPublisherCount?: number;
  importanceScore: number;
  importanceLabel: ImportanceLabel;
  geographicScope: GeographicScope;
  primaryCountry: string;
  affectedCountries: string[];
  firstSeenAt: string;
  lastUpdatedAt: string;
  scoringComponents: ScoringComponents;
  scoringInput: ScoringInput;
  articles: Article[];
  generatedSummary: boolean;
  originalHeadline?: string;
  originalSummary?: string;
  originalLanguage?: string;
}

export interface CountryPulse extends Country {
  events: Event[];
  topEvent?: Event;
}

export interface MapCountry {
  mapId: string;
  name: string;
  iso2?: string;
  iso3?: string;
  region?: string;
  events: Event[];
  topEvent?: Event;
  signalReady?: boolean;
}

export interface LiveArticle {
  id: string;
  title: string;
  description?: string;
  imageUrl?: string;
  url: string;
  publisherName: string;
  publisherUrl: string;
  publishedAt: string;
  originalTitle?: string;
  originalDescription?: string;
  originalLanguage?: string;
}

export interface LiveNewsPayload {
  countryName: string | null;
  scope: "country" | "global" | "event";
  generatedAt: string;
  refreshAfterSeconds: number;
  provider: string;
  providers?: Array<{
    name: string;
    status: "ok" | "failed";
    articleCount: number;
  }>;
  degraded?: boolean;
  articles: LiveArticle[];
}

export interface MapNewsCountryPayload {
  countryName: string;
  generatedAt: string;
  available: boolean;
  articles: LiveArticle[];
}

export interface MapNewsPayload {
  scope: "map";
  generatedAt: string;
  refreshAfterSeconds: number;
  provider: string;
  countries: MapNewsCountryPayload[];
}

export interface LiveWorldNewsPayload {
  scope: "world-live";
  generatedAt: string;
  refreshAfterSeconds: number;
  provider: string;
  global: LiveNewsPayload;
  countries: MapNewsCountryPayload[];
}

export interface PreparedNewsFeed {
  events: Event[];
  updatedAt: string | null;
  provider: string | null;
  loading: false;
  error: null;
}

export interface PreparedWorldNewsPayload {
  scope: "live-world-view";
  version: string;
  generatedAt: string;
  refreshAfterSeconds: number;
  globalFeed: PreparedNewsFeed;
  countryFeeds: Record<string, PreparedNewsFeed>;
}

export interface WorldPulseProviderHealth {
  name: string;
  status: "ok" | "failed";
  articleCount: number;
}

export interface WorldPulseDiagnostics {
  status: "healthy" | "degraded";
  fresh: boolean;
  generatedAt: string;
  liveIndexGeneratedAt: string;
  liveIndexBytes: number;
  totalCountries: number;
  countriesWithNews: number;
  inhabitedCountries: number;
  inhabitedCountriesWithNews: number;
  missingInhabitedCountries: string[];
  expectedEmptyCountries: string[];
  globalEventCount: number;
  providerHealth: WorldPulseProviderHealth[];
}
