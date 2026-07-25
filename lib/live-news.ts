import { calculateImportance } from "./scoring";
import {
  countrySearchTerms,
  textMatchesCountry,
} from "./country-terms";
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
      "airstrike",
      "armed",
      "army",
      "bomb",
      "bombing",
      "blockade",
      "ceasefire",
      "civil unrest",
      "civil war",
      "clash",
      "coast guard",
      "coastguard",
      "conflict",
      "confrontation",
      "coup",
      "defence",
      "defense",
      "disputed waters",
      "hostage",
      "hijack",
      "incursion",
      "invasion",
      "insurgent",
      "insurgency",
      "intercept",
      "maritime standoff",
      "military",
      "missile",
      "navy",
      "naval",
      "rebel",
      "rebellion",
      "revolution",
      "riot",
      "security",
      "skirmish",
      "standoff",
      "terror",
      "troops",
      "uprising",
      "war",
      "warship",
      "pirate",
      "ataque",
      "conflit",
      "guerra",
      "guerre",
      "militar",
      "戦争",
      "ミサイル",
      "هجوم",
      "حرب",
    ],
  ],
  [
    "Crime and justice",
    [
      "arrest",
      "arrested",
      "cartel",
      "charge",
      "charges",
      "conviction",
      "corruption",
      "court",
      "crime",
      "criminal",
      "fraud",
      "homicide",
      "judge",
      "justice",
      "lawsuit",
      "murder",
      "police",
      "prison",
      "prosecutor",
      "robbery",
      "sentence",
      "shooting",
      "trial",
      "tribunal",
      "policía",
      "policia",
      "justicia",
      "警察",
      "逮捕",
    ],
  ],
  [
    "Weather and disasters",
    [
      "earthquake",
      "blizzard",
      "cyclone",
      "disaster",
      "drought",
      "eruption",
      "evacuation",
      "fire",
      "flood",
      "heatwave",
      "hurricane",
      "landslide",
      "monsoon",
      "rainfall",
      "rescue",
      "snow",
      "storm",
      "tornado",
      "tsunami",
      "typhoon",
      "volcano",
      "weather",
      "wildfire",
      "inondation",
      "séisme",
      "seisme",
      "tormenta",
      "terremoto",
      "洪水",
      "台風",
      "地震",
    ],
  ],
  [
    "Health",
    [
      "disease",
      "health",
      "hospital",
      "cancer",
      "covid",
      "doctor",
      "ebola",
      "malaria",
      "medical",
      "medicine",
      "mental health",
      "outbreak",
      "patient",
      "pharmaceutical",
      "surgery",
      "vaccine",
      "virus",
      "santé",
      "salud",
      "hôpital",
      "hospital",
      "健康",
      "病院",
    ],
  ],
  [
    "Science and technology",
    [
      "ai ",
      "artificial intelligence",
      "app",
      "chip",
      "cyber",
      "data",
      "digital",
      "internet",
      "research",
      "robot",
      "satellite",
      "science",
      "semiconductor",
      "software",
      "space",
      "technology",
      "tech",
      "intelligence artificielle",
      "tecnología",
      "tecnologia",
      "wissenschaft",
      "科学",
      "技術",
    ],
  ],
  [
    "Sports",
    [
      "athlete",
      "athletics",
      "baseball",
      "basketball",
      "boxing",
      "bowl",
      "championship",
      "champion",
      "coach",
      "cricket",
      "club",
      "cup",
      "cycling",
      "derby",
      "final",
      "fixture",
      "football",
      "formula",
      "game",
      "golf",
      "goal",
      "grand prix",
      "hockey",
      "kickoff",
      "league",
      "match",
      "medal",
      "motorsport",
      "olympic",
      "player",
      "pool",
      "preview",
      "race",
      "rugby",
      "score",
      "season",
      "soccer",
      "sport",
      "swimming",
      "team",
      "tennis",
      "tournament",
      "trophy",
      "vs",
      "wrestling",
      "world cup",
      "coupe du monde",
      "coupe",
      "équipe",
      "equipe",
      "finale",
      "joueur",
      "fútbol",
      "futbol",
      "calcio",
      "campeonato",
      "copa",
      "jugador",
      "liga",
      "mundial",
      "partido",
      "selección",
      "selecao",
      "futebol",
      "jogo",
      "pokal",
      "rennen",
      "spiel",
      "كأس",
      "كرة",
      "لاعب",
      "مباراة",
      "نهائي",
      "الدوري",
      "المنتخب",
      "スポーツ",
      "サッカー",
      "試合",
      "野球",
    ],
  ],
  [
    "Culture and entertainment",
    [
      "actor",
      "anime",
      "art",
      "artist",
      "award",
      "book",
      "celebrity",
      "concert",
      "culture",
      "entertainment",
      "fashion",
      "festival",
      "film",
      "museum",
      "music",
      "movie",
      "mural",
      "novel",
      "radio",
      "singer",
      "television",
      "theater",
      "theatre",
      "tv",
      "cinéma",
      "cinema",
      "música",
      "musica",
      "kultur",
      "アニメ",
      "映画",
      "音楽",
      "芸術",
      "文化",
    ],
  ],
  [
    "Environment",
    [
      "biodiversity",
      "carbon",
      "climate",
      "conservation",
      "ecology",
      "emissions",
      "environment",
      "forest",
      "natural resources",
      "nature",
      "pollution",
      "renewable",
      "wildlife",
      "clima",
      "environnement",
      "écologie",
      "ecologia",
      "umwelt",
      "環境",
      "気候",
    ],
  ],
  [
    "Travel and transport",
    [
      "airline",
      "airport",
      "aviation",
      "bridge",
      "bus",
      "car",
      "crash",
      "flight",
      "metro",
      "port",
      "rail",
      "railway",
      "road",
      "shipping",
      "tourism",
      "traffic",
      "train",
      "transport",
      "travel",
      "vehicle",
      "aéroport",
      "aeropuerto",
      "tren",
      "viagem",
      "voyage",
      "交通",
      "鉄道",
    ],
  ],
  [
    "Food and agriculture",
    [
      "agriculture",
      "beer",
      "chef",
      "crop",
      "cuisine",
      "dairy",
      "farm",
      "farming",
      "food",
      "harvest",
      "livestock",
      "restaurant",
      "recipe",
      "wine",
      "agricultura",
      "alimentaire",
      "alimentos",
      "nourriture",
      "غذاء",
      "زراعة",
      "農業",
      "食品",
    ],
  ],
  [
    "Economy",
    [
      "acquisition",
      "assets",
      "bank",
      "budget",
      "business",
      "company",
      "deal",
      "economy",
      "energy",
      "finance",
      "gas",
      "housing",
      "industry",
      "inflation",
      "investment",
      "jobs",
      "market",
      "mortgage",
      "oil",
      "prices",
      "revenue",
      "sales",
      "tax",
      "tariff",
      "trade",
      "trade war",
      "unemployment",
      "économie",
      "economía",
      "economia",
      "finanzas",
      "mercado",
      "commerce",
      "wirtschaft",
      "اقتصاد",
      "الطاقة",
      "نفط",
      "経済",
      "经济",
    ],
  ],
  [
    "Politics",
    [
      "election",
      "government",
      "cabinet",
      "campaign",
      "coalition",
      "congress",
      "diplomacy",
      "lawmakers",
      "mayor",
      "minister",
      "parliament",
      "policy",
      "president",
      "prime minister",
      "referendum",
      "senate",
      "vote",
      "culture war",
      "elección",
      "elecciones",
      "alcalde",
      "gobierno",
      "gouvernement",
      "député",
      "depute",
      "ministre",
      "parlement",
      "politique",
      "presidente",
      "président",
      "president",
      "governo",
      "eleições",
      "eleicoes",
      "regierung",
      "الحكومة",
      "الدولة",
      "البرلمان",
      "انتخابات",
      "رئيس",
      "مجلس",
      "وزير",
      "選挙",
      "政府",
    ],
  ],
  [
    "Society and education",
    [
      "asylum",
      "children",
      "city",
      "community",
      "education",
      "family",
      "housing",
      "immigration",
      "inequality",
      "labor",
      "labour",
      "migrant",
      "population",
      "protest",
      "public",
      "refugee",
      "religion",
      "rights",
      "school",
      "social",
      "student",
      "teacher",
      "town",
      "university",
      "women",
      "youth",
      "communauté",
      "comunidad",
      "école",
      "escuela",
      "universidad",
      "université",
      "assistance",
      "réfugié",
      "refugie",
      "التعليم",
      "جامعة",
      "مدرسة",
      "教育",
      "学校",
    ],
  ],
];

const NICHE_TERMS = [
  "astrology",
  "bundle",
  "coupon",
  "curiosity",
  "giveaway",
  "horoscope",
  "lottery",
  "oddity",
  "obituary",
  "shopping",
  "sweepstakes",
];

const CATEGORY_TIE_PRIORITY: Category[] = [
  "Conflict and security",
  "Crime and justice",
  "Weather and disasters",
  "Health",
  "Science and technology",
  "Sports",
  "Culture and entertainment",
  "Environment",
  "Economy",
  "Politics",
  "Travel and transport",
  "Food and agriculture",
  "Society and education",
  "Local affairs",
  "Other",
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
  ["un news", 81],
  ["euronews", 80],
  ["sky news", 80],
]);

const STOP_WORDS = new Set([
  "a",
  "about",
  "after",
  "against",
  "amid",
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
  "have",
  "how",
  "in",
  "is",
  "it",
  "latest",
  "may",
  "more",
  "new",
  "news",
  "of",
  "on",
  "over",
  "report",
  "reports",
  "says",
  "that",
  "the",
  "their",
  "this",
  "to",
  "update",
  "was",
  "were",
  "will",
  "with",
]);

const SHORT_SIGNAL_TOKENS = new Set(["ai", "eu", "fc", "uk", "un", "us", "vs"]);

const TOKEN_EQUIVALENTS: Record<string, string> = {
  american: "usa",
  america: "usa",
  bombard: "attack",
  canadian: "canada",
  chinese: "china",
  iranian: "iran",
  israeli: "israel",
  pummel: "attack",
  russian: "russia",
  taiwanese: "taiwan",
  turkish: "turkey",
  ukrainian: "ukraine",
  us: "usa",
};

function stableId(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash >>> 0).toString(36);
}

function stemToken(token: string) {
  if (token.length > 7 && token.endsWith("ies")) {
    return `${token.slice(0, -3)}y`;
  }
  if (token.length > 6 && token.endsWith("ing")) return token.slice(0, -3);
  if (token.length > 6 && token.endsWith("ed")) return token.slice(0, -2);
  if (token.length > 6 && token.endsWith("es")) return token.slice(0, -2);
  if (token.length > 5 && token.endsWith("s")) return token.slice(0, -1);
  return token;
}

function textTokens(value: string) {
  return [
    ...new Set(
      value
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s]/gu, " ")
        .split(/\s+/)
        .filter(
          (token) =>
            (token.length > 2 || SHORT_SIGNAL_TOKENS.has(token)) &&
            !STOP_WORDS.has(token),
        )
        .map(stemToken)
        .map((token) => TOKEN_EQUIVALENTS[token] ?? token),
    ),
  ];
}

function tokenMetrics(left: string[], right: string[]) {
  if (!left.length || !right.length) {
    return { common: 0, longCommon: 0, containment: 0 };
  }
  const rightSet = new Set(right);
  const commonTokens = left.filter((token) => rightSet.has(token));
  return {
    common: commonTokens.length,
    longCommon: commonTokens.filter((token) => token.length >= 7).length,
    containment:
      commonTokens.length / Math.max(1, Math.min(left.length, right.length)),
  };
}

function hasSharedTitlePhrase(left: string[], right: string[]) {
  const rightPairs = new Set(
    right.slice(0, -1).map((token, index) => `${token} ${right[index + 1]}`),
  );
  return left
    .slice(0, -1)
    .some((token, index) => rightPairs.has(`${token} ${left[index + 1]}`));
}

function articleSimilarity(left: LiveArticle, right: LiveArticle) {
  const leftTitle = textTokens(left.title);
  const rightTitle = textTokens(right.title);
  const title = tokenMetrics(leftTitle, rightTitle);
  const leftContext = textTokens(`${left.title} ${left.description ?? ""}`);
  const rightContext = textTokens(`${right.title} ${right.description ?? ""}`);
  const context = tokenMetrics(leftContext, rightContext);
  const sharedPhrase = hasSharedTitlePhrase(leftTitle, rightTitle);

  if (sharedPhrase && title.common >= 2) return 1;
  if (title.common >= 3 && title.containment >= 0.38) {
    return title.containment;
  }
  if (title.longCommon >= 2 && title.containment >= 0.3) {
    return title.containment;
  }
  if (
    title.common >= 2 &&
    context.common >= 5 &&
    context.containment >= 0.24
  ) {
    return Math.max(title.containment, context.containment);
  }
  return 0;
}

export function classifyLiveHeadline(title: string): Category {
  const normalized = title.normalize("NFKC").toLowerCase();
  const tokens = new Set(textTokens(normalized));
  let bestCategory: Category = "Other";
  let bestScore = 0;

  for (const [category, terms] of CATEGORY_TERMS) {
    const score = terms.reduce((total, term) => {
      const trimmedTerm = term.trim();
      const matches = !trimmedTerm.includes(" ")
        ? tokens.has(stemToken(trimmedTerm))
        : new RegExp(
            `(^|[^\\p{L}\\p{N}])${trimmedTerm
              .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
              .replace(/\s+/g, "\\s+")}([^\\p{L}\\p{N}]|$)`,
            "iu",
          ).test(normalized);
      return total + (matches ? (trimmedTerm.includes(" ") ? 2 : 1) : 0);
    }, 0);

    if (
      score > bestScore ||
      (score > 0 &&
        score === bestScore &&
        CATEGORY_TIE_PRIORITY.indexOf(category) <
          CATEGORY_TIE_PRIORITY.indexOf(bestCategory))
    ) {
      bestCategory = category;
      bestScore = score;
    }
  }

  if (bestScore > 0) return bestCategory;
  return NICHE_TERMS.some((term) => tokens.has(stemToken(term)))
    ? "Other"
    : "Local affairs";
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
  const chronological = [...articles].sort(
    (left, right) =>
      Date.parse(right.publishedAt) - Date.parse(left.publishedAt),
  );
  for (const article of chronological) {
    const cluster = clusters.find((candidate) =>
      candidate.some(
        (member) => {
          const similarity = articleSimilarity(member, article);
          return (
            Math.abs(
            Date.parse(member.publishedAt) - Date.parse(article.publishedAt),
            ) <=
              72 * 3_600_000 &&
            similarity > 0 &&
            (classifyLiveHeadline(member.title) ===
              classifyLiveHeadline(article.title) ||
              similarity >= 0.6)
          );
        },
      ),
    );
    if (cluster) cluster.push(article);
    else clusters.push([article]);
  }
  return clusters;
}

function distinctPublisherArticles(cluster: LiveArticle[]) {
  const publishers = new Map<string, LiveArticle>();
  for (const article of [...cluster].sort(
    (left, right) =>
      Date.parse(right.publishedAt) - Date.parse(left.publishedAt),
  )) {
    const sourceId = createSource(article).id;
    if (!publishers.has(sourceId)) publishers.set(sourceId, article);
  }
  return [...publishers.values()];
}

function representativeArticle(cluster: LiveArticle[]) {
  return [...cluster].sort((left, right) => {
    const leftConnections = cluster.filter(
      (article) => article !== left && articleSimilarity(left, article) > 0,
    ).length;
    const rightConnections = cluster.filter(
      (article) => article !== right && articleSimilarity(right, article) > 0,
    ).length;
    return (
      rightConnections - leftConnections ||
      publisherProminence(right.publisherName) -
        publisherProminence(left.publisherName) ||
      Date.parse(right.publishedAt) - Date.parse(left.publishedAt)
    );
  })[0];
}

export function buildLiveEvents(
  payload: LiveNewsPayload,
  country: Pick<MapCountry, "name" | "iso2"> | null,
): Event[] {
  const reference = Math.max(Date.parse(payload.generatedAt) || 0, Date.now());
  const primaryCountry = country?.iso2 ?? country?.name ?? "GLOBAL";
  const scope: GeographicScope = country ? "National" : "International";

  return clusterArticles(payload.articles)
    .map((cluster): Event => {
      const sourceArticles = distinctPublisherArticles(cluster);
      const visibleSourceArticles = [...sourceArticles]
        .sort(
          (left, right) =>
            publisherProminence(right.publisherName) -
              publisherProminence(left.publisherName) ||
            Date.parse(right.publishedAt) - Date.parse(left.publishedAt),
        )
        .slice(0, 4);
      const representative = representativeArticle(cluster);
      const headline = representative?.title ?? "Current report";
      const eventId = `live-event-${stableId(
        `${primaryCountry}:${headline.toLowerCase()}`,
      )}`;
      const articles = visibleSourceArticles
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
            eventId,
          };
        })
        .sort(
          (left, right) =>
            Date.parse(right.publishedAt) - Date.parse(left.publishedAt),
        );
      const sources = new Map(
        sourceArticles.map((article) => {
          const source = createSource(article);
          return [source.id, source] as const;
        }),
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
        .slice(0, 4)
        .map((source) => source.publisherName);
      const summary =
        sources.size > 1
          ? `${sources.size} independent publishers matched this occurrence, including ${publisherNames.join(
              ", ",
            )}. The first four reports are linked below.`
          : `Current reporting indexed from ${
              publisherNames[0] ?? "the original publisher"
            }. Open the source for the complete report.`;
      const orderedDates = cluster
        .map((article) => article.publishedAt)
        .sort((left, right) => Date.parse(left) - Date.parse(right));

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
        firstSeenAt: orderedDates[0] ?? payload.generatedAt,
        lastUpdatedAt: orderedDates.at(-1) ?? payload.generatedAt,
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
  const terms = countrySearchTerms(countryName);
  return payload.articles.filter((article) =>
    textMatchesCountry(
      `${article.title} ${article.description ?? ""}`,
      terms,
    ),
  );
}
