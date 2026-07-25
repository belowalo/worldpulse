import { calculateImportance } from "./scoring";
import type {
  Article,
  Category,
  Event,
  GeographicScope,
  LiveArticle,
  LiveNewsPayload,
  MapCountry,
  NewsSource,
} from "./types";

const CATEGORY_TERMS: Array<[Category, string[]]> = [
  [
    "Conflict and security",
    [
      "attack",
      "ceasefire",
      "conflict",
      "defence",
      "defense",
      "military",
      "missile",
      "security",
      "troops",
      "war",
    ],
  ],
  [
    "Environment",
    [
      "climate",
      "earthquake",
      "emissions",
      "environment",
      "fire",
      "flood",
      "storm",
      "weather",
      "wildfire",
    ],
  ],
  [
    "Health",
    [
      "disease",
      "health",
      "hospital",
      "medicine",
      "outbreak",
      "patient",
      "vaccine",
      "virus",
    ],
  ],
  [
    "Science and technology",
    [
      "ai ",
      "artificial intelligence",
      "cyber",
      "research",
      "satellite",
      "science",
      "space",
      "technology",
    ],
  ],
  [
    "Economy",
    [
      "bank",
      "business",
      "economy",
      "finance",
      "inflation",
      "market",
      "tariff",
      "trade",
    ],
  ],
  [
    "Culture and sports",
    [
      "championship",
      "culture",
      "festival",
      "film",
      "football",
      "music",
      "olympic",
      "sport",
    ],
  ],
  [
    "Politics",
    [
      "election",
      "government",
      "minister",
      "parliament",
      "policy",
      "president",
      "prime minister",
      "vote",
    ],
  ],
];

const PROMINENT_PUBLISHERS = new Map<string, number>([
  ["reuters", 96],
  ["associated press", 95],
  ["bbc", 91],
  ["the guardian", 87],
  ["al jazeera", 86],
  ["cnn", 85],
  ["deutsche welle", 84],
  ["france 24", 83],
  ["cbc", 82],
  ["abc news", 82],
  ["npr", 81],
]);

const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "for",
  "from",
  "has",
  "in",
  "is",
  "it",
  "of",
  "on",
  "that",
  "the",
  "to",
  "with",
]);

function stableId(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash >>> 0).toString(36);
}

function titleTokens(title: string) {
  return new Set(
    title
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .split(/\s+/)
      .filter((token) => token.length > 2 && !STOP_WORDS.has(token)),
  );
}

function titleSimilarity(left: string, right: string) {
  const leftTokens = titleTokens(left);
  const rightTokens = titleTokens(right);
  if (!leftTokens.size || !rightTokens.size) return 0;
  let intersection = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) intersection += 1;
  }
  return intersection / Math.min(leftTokens.size, rightTokens.size);
}

export function classifyLiveHeadline(title: string): Category {
  const normalized = ` ${title.toLowerCase()} `;
  for (const [category, terms] of CATEGORY_TERMS) {
    if (terms.some((term) => normalized.includes(term))) return category;
  }
  return "Other";
}

function publisherProminence(name: string) {
  const normalized = name.toLowerCase();
  for (const [publisher, score] of PROMINENT_PUBLISHERS) {
    if (normalized.includes(publisher)) return score;
  }
  return 58;
}

function articleAgeHours(article: LiveArticle, reference: number) {
  const published = Date.parse(article.publishedAt);
  if (!Number.isFinite(published)) return 72;
  return Math.max(0, (reference - published) / 3_600_000);
}

function createSource(article: LiveArticle): NewsSource {
  return {
    id: `live-source-${stableId(article.publisherUrl || article.publisherName)}`,
    publisherName: article.publisherName,
    url: article.publisherUrl,
    country: "Unknown",
    prominenceScore: publisherProminence(article.publisherName),
  };
}

function clusterArticles(articles: LiveArticle[]) {
  const clusters: LiveArticle[][] = [];
  for (const article of articles) {
    const cluster = clusters.find((candidate) =>
      candidate.some(
        (member) => titleSimilarity(member.title, article.title) >= 0.54,
      ),
    );
    if (cluster) cluster.push(article);
    else clusters.push([article]);
  }
  return clusters;
}

export function buildLiveEvents(
  payload: LiveNewsPayload,
  country: Pick<MapCountry, "name" | "iso2"> | null,
): Event[] {
  const reference = Date.parse(payload.generatedAt) || Date.now();
  const primaryCountry = country?.iso2 ?? country?.name ?? "GLOBAL";
  const scope: GeographicScope = country ? "National" : "International";

  return clusterArticles(payload.articles)
    .map((cluster): Event => {
      const articles = cluster
        .map((article, index): Article => {
          const source = createSource(article);
          return {
            id: `live-article-${article.id}-${index}`,
            headline: article.title,
            originalUrl: article.url,
            source,
            publishedAt: article.publishedAt,
            extractedCountries: country ? [primaryCountry] : [],
            category: classifyLiveHeadline(article.title),
            eventId: "",
          };
        })
        .sort(
          (left, right) =>
            Date.parse(right.publishedAt) - Date.parse(left.publishedAt),
        );
      const headline = articles[0]?.headline ?? "Current report";
      const eventId = `live-event-${stableId(
        `${primaryCountry}:${headline.toLowerCase()}`,
      )}`;
      for (const article of articles) article.eventId = eventId;
      const sources = new Map(
        articles.map((article) => [article.source.id, article.source]),
      );
      const averageProminence =
        [...sources.values()].reduce(
          (sum, source) => sum + source.prominenceScore,
          0,
        ) / Math.max(1, sources.size);
      const youngestAge = Math.min(
        ...cluster.map((article) => articleAgeHours(article, reference)),
      );
      const scoring = calculateImportance({
        independentSourceCount: sources.size,
        sourceCountryCount: sources.size ? 1 : 0,
        affectedCountryCount: country ? 1 : 2,
        countrySignificance: country ? 55 : 60,
        publisherProminence: averageProminence,
        ageHours: youngestAge,
        articlesPerHour: Math.max(0.2, cluster.length / 6),
      });
      const publisherNames = [...sources.values()]
        .slice(0, 3)
        .map((source) => source.publisherName);
      const summary =
        sources.size > 1
          ? `Independent reporting indexed from ${publisherNames.join(
              ", ",
            )}. Open the attributed sources for full context.`
          : `Current reporting indexed from ${
              publisherNames[0] ?? "the original publisher"
            }. Open the source for the complete report.`;

      return {
        id: eventId,
        headline,
        summary,
        category: classifyLiveHeadline(headline),
        importanceScore: scoring.score,
        importanceLabel: scoring.label,
        geographicScope: scope,
        primaryCountry,
        affectedCountries: country ? [primaryCountry] : [],
        firstSeenAt:
          articles.at(-1)?.publishedAt ?? payload.generatedAt,
        lastUpdatedAt: articles[0]?.publishedAt ?? payload.generatedAt,
        scoringComponents: scoring.components,
        scoringInput: {
          independentSourceCount: sources.size,
          sourceCountryCount: sources.size ? 1 : 0,
          affectedCountryCount: country ? 1 : 2,
          countrySignificance: country ? 55 : 60,
          publisherProminence: averageProminence,
          ageHours: youngestAge,
          articlesPerHour: Math.max(0.2, cluster.length / 6),
        },
        articles,
        generatedSummary: true,
      };
    })
    .sort(
      (left, right) =>
        right.importanceScore - left.importanceScore ||
        Date.parse(right.lastUpdatedAt) - Date.parse(left.lastUpdatedAt),
    );
}

export function articlesMentioningCountry(
  payload: LiveNewsPayload,
  countryName: string,
) {
  const normalizedName = countryName
    .replace(/^W\. Sahara$/, "Western Sahara")
    .replace(/^S\. Sudan$/, "South Sudan")
    .replace(/^Dem\. Rep\. Congo$/, "Democratic Republic of the Congo")
    .replace(/^Central African Rep\.$/, "Central African Republic")
    .replace(/^Dominican Rep\.$/, "Dominican Republic")
    .replace(/^Czech Rep\.$/, "Czech Republic")
    .replace(/^Korea$/, "South Korea")
    .replace(/^Dem\. Rep\. Korea$/, "North Korea");
  const terms = [countryName, normalizedName]
    .map((term) => term.toLowerCase())
    .filter((term, index, all) => all.indexOf(term) === index);
  return payload.articles.filter((article) => {
    const title = article.title.toLowerCase();
    return terms.some((term) => title.includes(term));
  });
}
