import { calculateImportance } from "./scoring";
import type {
  Article,
  Category,
  Country,
  CountryPulse,
  Event,
  GeographicScope,
  NewsSource,
  ScoringInput,
} from "./types";

export const countries: Country[] = [
  { iso2: "CA", iso3: "CAN", name: "Canada", mapId: "124", region: "North America" },
  { iso2: "US", iso3: "USA", name: "United States", mapId: "840", region: "North America" },
  { iso2: "MX", iso3: "MEX", name: "Mexico", mapId: "484", region: "North America" },
  { iso2: "BR", iso3: "BRA", name: "Brazil", mapId: "076", region: "South America" },
  { iso2: "AR", iso3: "ARG", name: "Argentina", mapId: "032", region: "South America" },
  { iso2: "GB", iso3: "GBR", name: "United Kingdom", mapId: "826", region: "Europe" },
  { iso2: "FR", iso3: "FRA", name: "France", mapId: "250", region: "Europe" },
  { iso2: "DE", iso3: "DEU", name: "Germany", mapId: "276", region: "Europe" },
  { iso2: "UA", iso3: "UKR", name: "Ukraine", mapId: "804", region: "Europe" },
  { iso2: "NG", iso3: "NGA", name: "Nigeria", mapId: "566", region: "Africa" },
  { iso2: "ZA", iso3: "ZAF", name: "South Africa", mapId: "710", region: "Africa" },
  { iso2: "EG", iso3: "EGY", name: "Egypt", mapId: "818", region: "Africa" },
  { iso2: "IN", iso3: "IND", name: "India", mapId: "356", region: "Asia" },
  { iso2: "CN", iso3: "CHN", name: "China", mapId: "156", region: "Asia" },
  { iso2: "JP", iso3: "JPN", name: "Japan", mapId: "392", region: "Asia" },
  { iso2: "AU", iso3: "AUS", name: "Australia", mapId: "036", region: "Oceania" },
];

const source = (
  id: string,
  publisherName: string,
  country: string,
  prominenceScore: number,
): NewsSource => ({
  id,
  publisherName,
  country,
  prominenceScore,
  url: `https://example.com/sources/${id}`,
});

const sources = {
  reuters: source("reuters", "Reuters", "GB", 95),
  ap: source("ap", "Associated Press", "US", 94),
  cbc: source("cbc", "CBC News", "CA", 81),
  dw: source("dw", "Deutsche Welle", "DE", 82),
  france24: source("france24", "France 24", "FR", 79),
  nhk: source("nhk", "NHK World", "JP", 80),
  abc: source("abc-au", "ABC News Australia", "AU", 80),
  guardian: source("guardian", "The Guardian", "GB", 85),
  aljazeera: source("aljazeera", "Al Jazeera", "QA", 84),
  globe: source("globe", "The Globe and Mail", "CA", 76),
};

const now = new Date("2026-07-24T20:00:00.000Z");

function makeEvent(config: {
  id: string;
  headline: string;
  summary: string;
  category: Category;
  primaryCountry: string;
  affectedCountries: string[];
  scope: GeographicScope;
  ageHours: number;
  scoring: Omit<ScoringInput, "ageHours">;
  eventSources: NewsSource[];
}): Event {
  const scoringInput: ScoringInput = { ...config.scoring, ageHours: config.ageHours };
  const calculated = calculateImportance(scoringInput);
  const publishedAt = new Date(now.getTime() - config.ageHours * 3_600_000);
  const articles: Article[] = config.eventSources.map((item, index) => ({
    id: `${config.id}-article-${index + 1}`,
    headline: config.headline,
    originalUrl: `https://example.com/reporting/${config.id}/${index + 1}`,
    source: item,
    publishedAt: new Date(publishedAt.getTime() + index * 540_000).toISOString(),
    extractedCountries: config.affectedCountries,
    category: config.category,
    eventId: config.id,
  }));
  return {
    id: config.id,
    headline: config.headline,
    summary: config.summary,
    category: config.category,
    importanceScore: calculated.score,
    importanceLabel: calculated.label,
    geographicScope: config.scope,
    primaryCountry: config.primaryCountry,
    affectedCountries: config.affectedCountries,
    firstSeenAt: publishedAt.toISOString(),
    lastUpdatedAt: new Date(publishedAt.getTime() + 1_800_000).toISOString(),
    scoringComponents: calculated.components,
    scoringInput,
    articles,
    generatedSummary: true,
  };
}

const rawEvents: Event[] = [
  makeEvent({ id: "pacific-climate-pact", headline: "Pacific nations agree accelerated coastal resilience plan", summary: "Regional leaders agreed a shared financing framework for flood defences, early-warning systems and community relocation planning.", category: "Environment", primaryCountry: "AU", affectedCountries: ["AU", "JP", "CA", "US"], scope: "International", ageHours: 3, scoring: { independentSourceCount: 8, sourceCountryCount: 5, affectedCountryCount: 9, countrySignificance: 78, publisherProminence: 89, articlesPerHour: 3.4 }, eventSources: [sources.reuters, sources.ap, sources.abc, sources.nhk] }),
  makeEvent({ id: "canada-health-data", headline: "Provinces launch shared emergency-room capacity dashboard", summary: "A new national data standard will publish comparable wait-time and bed-capacity indicators while preserving provincial control.", category: "Health", primaryCountry: "CA", affectedCountries: ["CA"], scope: "National", ageHours: 6, scoring: { independentSourceCount: 5, sourceCountryCount: 2, affectedCountryCount: 1, countrySignificance: 66, publisherProminence: 80, articlesPerHour: 1.8 }, eventSources: [sources.cbc, sources.globe, sources.reuters] }),
  makeEvent({ id: "us-chip-grid", headline: "Grid operators coordinate power plan for new chip plants", summary: "Federal and state regulators outlined a joint planning process for electricity demand around semiconductor manufacturing hubs.", category: "Science and technology", primaryCountry: "US", affectedCountries: ["US", "CA", "MX"], scope: "International", ageHours: 10, scoring: { independentSourceCount: 6, sourceCountryCount: 3, affectedCountryCount: 3, countrySignificance: 82, publisherProminence: 91, articlesPerHour: 2.3 }, eventSources: [sources.ap, sources.reuters, sources.cbc] }),
  makeEvent({ id: "mexico-water", headline: "Northern states adopt coordinated industrial water rules", summary: "The agreement introduces common drought triggers and reporting requirements for high-volume industrial users.", category: "Environment", primaryCountry: "MX", affectedCountries: ["MX", "US"], scope: "International", ageHours: 18, scoring: { independentSourceCount: 4, sourceCountryCount: 2, affectedCountryCount: 2, countrySignificance: 61, publisherProminence: 72, articlesPerHour: 1.1 }, eventSources: [sources.ap, sources.reuters] }),
  makeEvent({ id: "brazil-forest-fund", headline: "Amazon restoration fund expands community grants", summary: "New financing will support Indigenous-led monitoring, degraded-land recovery and lower-impact farming across several states.", category: "Environment", primaryCountry: "BR", affectedCountries: ["BR", "CO", "PE"], scope: "Regional", ageHours: 12, scoring: { independentSourceCount: 7, sourceCountryCount: 4, affectedCountryCount: 3, countrySignificance: 79, publisherProminence: 86, articlesPerHour: 2.6 }, eventSources: [sources.reuters, sources.ap, sources.guardian] }),
  makeEvent({ id: "argentina-inflation", headline: "Monthly inflation slows as food prices stabilize", summary: "Official data showed a further easing in headline inflation, though household purchasing power remains under pressure.", category: "Economy", primaryCountry: "AR", affectedCountries: ["AR"], scope: "National", ageHours: 20, scoring: { independentSourceCount: 5, sourceCountryCount: 3, affectedCountryCount: 1, countrySignificance: 63, publisherProminence: 84, articlesPerHour: 1.4 }, eventSources: [sources.reuters, sources.ap] }),
  makeEvent({ id: "uk-local-vote", headline: "Councils test common standard for digital ballot access", summary: "A cross-party pilot will evaluate accessibility and security safeguards ahead of wider public consultation.", category: "Politics", primaryCountry: "GB", affectedCountries: ["GB"], scope: "National", ageHours: 14, scoring: { independentSourceCount: 4, sourceCountryCount: 1, affectedCountryCount: 1, countrySignificance: 55, publisherProminence: 82, articlesPerHour: 1.2 }, eventSources: [sources.guardian, sources.reuters] }),
  makeEvent({ id: "france-games-legacy", headline: "Cities publish first results from community sport grants", summary: "Local clubs report higher youth participation after facilities and coaching grants targeted underserved districts.", category: "Sports", primaryCountry: "FR", affectedCountries: ["FR"], scope: "National", ageHours: 28, scoring: { independentSourceCount: 3, sourceCountryCount: 1, affectedCountryCount: 1, countrySignificance: 42, publisherProminence: 69, articlesPerHour: 0.8 }, eventSources: [sources.france24, sources.reuters] }),
  makeEvent({ id: "germany-rail", headline: "Rail modernization package clears final parliamentary vote", summary: "The multi-year package prioritizes signalling upgrades, high-traffic corridors and resilience during extreme weather.", category: "Economy", primaryCountry: "DE", affectedCountries: ["DE", "FR", "PL", "NL"], scope: "International", ageHours: 7, scoring: { independentSourceCount: 7, sourceCountryCount: 4, affectedCountryCount: 4, countrySignificance: 73, publisherProminence: 87, articlesPerHour: 2.9 }, eventSources: [sources.dw, sources.reuters, sources.france24] }),
  makeEvent({ id: "ukraine-grain-route", headline: "New inspections agreement stabilizes regional grain corridor", summary: "Neighbouring governments and port authorities agreed procedures intended to reduce delays while maintaining safety checks.", category: "Conflict and security", primaryCountry: "UA", affectedCountries: ["UA", "PL", "RO", "TR", "EG"], scope: "International", ageHours: 2, scoring: { independentSourceCount: 10, sourceCountryCount: 6, affectedCountryCount: 5, countrySignificance: 92, publisherProminence: 94, articlesPerHour: 4.2 }, eventSources: [sources.reuters, sources.ap, sources.dw, sources.aljazeera] }),
  makeEvent({ id: "nigeria-vaccine", headline: "West African vaccine facility completes validation run", summary: "The production milestone advances plans for regional supply of routine childhood vaccines, pending final regulatory review.", category: "Health", primaryCountry: "NG", affectedCountries: ["NG", "GH", "SN", "CI"], scope: "Regional", ageHours: 9, scoring: { independentSourceCount: 6, sourceCountryCount: 4, affectedCountryCount: 4, countrySignificance: 77, publisherProminence: 79, articlesPerHour: 2.1 }, eventSources: [sources.reuters, sources.aljazeera, sources.ap] }),
  makeEvent({ id: "south-africa-radio", headline: "Community radio archive opens to public", summary: "A digitized collection preserves four decades of local reporting, music and oral history from stations across the country.", category: "Culture and entertainment", primaryCountry: "ZA", affectedCountries: ["ZA"], scope: "National", ageHours: 44, scoring: { independentSourceCount: 3, sourceCountryCount: 2, affectedCountryCount: 1, countrySignificance: 38, publisherProminence: 62, articlesPerHour: 0.4 }, eventSources: [sources.guardian, sources.aljazeera] }),
  makeEvent({ id: "egypt-solar-storage", headline: "Desert solar-storage project begins grid testing", summary: "The first phase pairs utility-scale solar generation with battery storage designed to reduce evening supply gaps.", category: "Science and technology", primaryCountry: "EG", affectedCountries: ["EG", "JO"], scope: "Regional", ageHours: 16, scoring: { independentSourceCount: 5, sourceCountryCount: 3, affectedCountryCount: 2, countrySignificance: 67, publisherProminence: 78, articlesPerHour: 1.6 }, eventSources: [sources.reuters, sources.aljazeera] }),
  makeEvent({ id: "india-monsoon", headline: "Monsoon rail disruptions prompt national logistics response", summary: "Authorities rerouted freight and deployed emergency crews after severe rainfall affected several high-volume corridors.", category: "Weather and disasters", primaryCountry: "IN", affectedCountries: ["IN", "BD", "NP"], scope: "Regional", ageHours: 4, scoring: { independentSourceCount: 8, sourceCountryCount: 4, affectedCountryCount: 3, countrySignificance: 84, publisherProminence: 88, articlesPerHour: 3.5 }, eventSources: [sources.reuters, sources.ap, sources.aljazeera] }),
  makeEvent({ id: "china-consumption", headline: "Consumer support measures focus on household services", summary: "The package expands targeted incentives for care, tourism and energy-efficient home upgrades.", category: "Economy", primaryCountry: "CN", affectedCountries: ["CN"], scope: "National", ageHours: 11, scoring: { independentSourceCount: 7, sourceCountryCount: 5, affectedCountryCount: 1, countrySignificance: 90, publisherProminence: 90, articlesPerHour: 2.7 }, eventSources: [sources.reuters, sources.ap, sources.guardian] }),
  makeEvent({ id: "japan-ocean-sensor", headline: "Deep-ocean sensor network begins public data release", summary: "Researchers are publishing near-real-time measurements intended to improve earthquake, tsunami and climate models.", category: "Science and technology", primaryCountry: "JP", affectedCountries: ["JP", "US", "AU"], scope: "International", ageHours: 8, scoring: { independentSourceCount: 6, sourceCountryCount: 4, affectedCountryCount: 3, countrySignificance: 76, publisherProminence: 84, articlesPerHour: 2.2 }, eventSources: [sources.nhk, sources.reuters, sources.abc] }),
];

export const events = [...rawEvents].sort(
  (a, b) =>
    b.importanceScore - a.importanceScore ||
    Date.parse(b.lastUpdatedAt) - Date.parse(a.lastUpdatedAt),
);

export const countryPulses: CountryPulse[] = countries.map((country) => {
  const countryEvents = events.filter(
    (event) =>
      event.primaryCountry === country.iso2 ||
      event.affectedCountries.includes(country.iso2),
  );
  return { ...country, events: countryEvents, topEvent: countryEvents[0] };
});

export const defaultCountry = "CA";

export function countryByIso(iso2: string) {
  return countryPulses.find((country) => country.iso2 === iso2);
}

export function flagEmoji(iso2: string) {
  return [...iso2.toUpperCase()]
    .map((character) => String.fromCodePoint(127397 + character.charCodeAt(0)))
    .join("");
}
