import { calculateImportance } from "./scoring";
import {
  canonicalPublisherKey,
  publisherBiasRating,
} from "./publisher-bias";
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
      "violence",
      "violent",
      "war",
      "warship",
      "xenophobia",
      "xenophobic",
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
      "capture",
      "captured",
      "cartel",
      "charge",
      "charges",
      "conviction",
      "corruption",
      "court",
      "crime",
      "criminal",
      "fraud",
      "fugitive",
      "hack",
      "hacker",
      "hacking",
      "homicide",
      "investigation",
      "investigate",
      "judge",
      "justice",
      "lawsuit",
      "murder",
      "police",
      "prison",
      "prosecutor",
      "probe",
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
      "heat",
      "heat dome",
      "heatwave",
      "hurricane",
      "landslide",
      "monsoon",
      "rainfall",
      "rescue",
      "snow",
      "storm",
      "temperature",
      "temps",
      "tornado",
      "tsunami",
      "typhoon",
      "volcano",
      "weather",
      "weather alert",
      "warning",
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
      "astronomy",
      "astronomical",
      "chip",
      "cyber",
      "data",
      "digital",
      "internet",
      "moon",
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
      "ant",
      "biodiversity",
      "carbon",
      "climate",
      "conservation",
      "ecology",
      "emissions",
      "environment",
      "forest",
      "gecko",
      "habitat",
      "insect",
      "invasive",
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
      "airways",
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
      "export",
      "exports",
      "finance",
      "gas",
      "housing",
      "industry",
      "import",
      "imports",
      "inflation",
      "investment",
      "jobs",
      "market",
      "mortgage",
      "oil",
      "petroleum",
      "prices",
      "quota",
      "quotas",
      "refinery",
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
  ["agence france-presse", 94],
  ["bbc", 91],
  ["new york times", 90],
  ["washington post", 89],
  ["the guardian", 87],
  ["nbc news", 87],
  ["cbs news", 86],
  ["al jazeera", 86],
  ["cnn", 85],
  ["deutsche welle", 84],
  ["usa today", 84],
  ["france 24", 83],
  ["cbc", 82],
  ["abc news", 82],
  ["newsweek", 81],
  ["npr", 81],
  ["un news", 81],
  ["euronews", 80],
  ["sky news", 80],
  ["fox news", 80],
  ["washington examiner", 77],
  ["national review", 76],
  ["fox weather", 79],
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
  "extraordinarily",
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
  "still",
  "that",
  "the",
  "their",
  "this",
  "to",
  "under",
  "update",
  "was",
  "were",
  "will",
  "with",
]);

const SHORT_SIGNAL_TOKENS = new Set(["ai", "eu", "fc", "uk", "un", "us", "vs"]);

const TOKEN_EQUIVALENTS: Record<string, string> = {
  advisories: "warning",
  advisory: "warning",
  alerts: "warning",
  alert: "warning",
  american: "usa",
  america: "usa",
  americans: "usa",
  bombard: "attack",
  canadian: "canada",
  chinese: "china",
  heatwave: "heat",
  hot: "heat",
  iranian: "iran",
  israeli: "israel",
  pummel: "attack",
  russian: "russia",
  scorching: "heat",
  sweltering: "heat",
  taiwanese: "taiwan",
  temperature: "heat",
  temperatures: "heat",
  turkish: "turkey",
  ukrainian: "ukraine",
  us: "usa",
  warnings: "warning",
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
  if (token === "movies") return "movie";
  if (token === "warning") return token;
  if (token === "series" || token === "species") return token;
  if (token.length > 5 && token.endsWith("ies")) {
    return `${token.slice(0, -3)}y`;
  }
  if (token.length > 6 && token.endsWith("ing")) return token.slice(0, -3);
  if (token.length > 6 && token.endsWith("ed")) return token.slice(0, -2);
  if (
    token.length > 6 &&
    /(sses|shes|ches|xes|zes|oes)$/.test(token)
  ) {
    return token.slice(0, -2);
  }
  if (
    token.length > 5 &&
    token.endsWith("s") &&
    !/(is|ss|us)$/.test(token)
  ) {
    return token.slice(0, -1);
  }
  return token;
}

export function newsTextTokens(value: string) {
  const prepared = value
    .toLowerCase()
    .replace(/\bu\.?\s*s\.?\b/g, " usa ")
    .replace(/\bunited\s+states\b/g, " usa ")
    .replace(/\bunited\s+kingdom\b/g, " uk ");
  return [
    ...new Set(
      prepared
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
  const leftTitle = newsTextTokens(left.title);
  const rightTitle = newsTextTokens(right.title);
  const title = tokenMetrics(leftTitle, rightTitle);
  const leftContext = newsTextTokens(
    `${left.title} ${left.description ?? ""}`,
  );
  const rightContext = newsTextTokens(
    `${right.title} ${right.description ?? ""}`,
  );
  const context = tokenMetrics(leftContext, rightContext);
  const sharedPhrase = hasSharedTitlePhrase(leftTitle, rightTitle);

  // A two-word place name such as "South Africa" is not enough to prove that
  // two reports describe the same occurrence. Require another shared signal.
  if (sharedPhrase && title.common >= 3) return 1;
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

function normalizedHeadline(value: string) {
  return newsTextTokens(value).sort().join(" ");
}

export function eventsDescribeSameOccurrence(left: Event, right: Event) {
  const leftNormalized = normalizedHeadline(left.headline);
  const rightNormalized = normalizedHeadline(right.headline);
  if (leftNormalized && leftNormalized === rightNormalized) {
    return true;
  }
  const timeDifference = Math.abs(
    Date.parse(left.lastUpdatedAt) - Date.parse(right.lastUpdatedAt),
  );
  if (!Number.isFinite(timeDifference) || timeDifference > 96 * 3_600_000) {
    return false;
  }
  const leftHeadlines = [
    left.headline,
    ...left.articles.map((article) => article.headline),
  ];
  const rightHeadlines = [
    right.headline,
    ...right.articles.map((article) => article.headline),
  ];
  const matchingPair = leftHeadlines.some((leftHeadline) =>
    rightHeadlines.some(
      (rightHeadline) =>
        articleSimilarity(
          {
            id: "left",
            title: leftHeadline,
            url: "",
            publisherName: "",
            publisherUrl: "",
            publishedAt: left.lastUpdatedAt,
          },
          {
            id: "right",
            title: rightHeadline,
            url: "",
            publisherName: "",
            publisherUrl: "",
            publishedAt: right.lastUpdatedAt,
          },
        ) > 0,
      ),
  );
  const rightTokenSet = new Set(rightNormalized.split(" "));
  return (
    matchingPair &&
    (left.category === right.category ||
      leftNormalized
        .split(" ")
        .filter((token) => rightTokenSet.has(token)).length >= 4)
  );
}

export function classifyLiveHeadline(title: string): Category {
  const normalized = title.normalize("NFKC").toLowerCase();
  const tokens = new Set(newsTextTokens(normalized));
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

export function publisherProminence(name: string) {
  const normalized = canonicalPublisherKey(name);
  for (const [publisher, score] of PROMINENT_PUBLISHERS) {
    if (normalized.includes(publisher)) return score;
  }
  return 58;
}

function selectBalancedSources<T>(
  items: T[],
  publisherName: (item: T) => string,
  publishedAt: (item: T) => string,
  limit = 5,
) {
  const ranked = [...items].sort(
    (left, right) =>
      publisherProminence(publisherName(right)) -
        publisherProminence(publisherName(left)) ||
      Date.parse(publishedAt(right)) - Date.parse(publishedAt(left)),
  );
  const selected: T[] = [];
  const selectedItems = new Set<T>();
  const takeFirst = (bucket: "left" | "center" | "right") => {
    const match = ranked.find(
      (item) =>
        !selectedItems.has(item) &&
        publisherBiasRating(publisherName(item))?.bucket === bucket,
    );
    if (match) {
      selected.push(match);
      selectedItems.add(match);
    }
  };

  takeFirst("left");
  takeFirst("right");
  for (const item of ranked) {
    if (selected.length >= limit) break;
    if (
      !selectedItems.has(item) &&
      publisherBiasRating(publisherName(item))?.bucket === "center"
    ) {
      selected.push(item);
      selectedItems.add(item);
    }
  }
  for (const item of ranked) {
    if (selected.length >= limit) break;
    if (!selectedItems.has(item)) {
      selected.push(item);
      selectedItems.add(item);
    }
  }
  return selected.sort(
    (left, right) =>
      publisherProminence(publisherName(right)) -
        publisherProminence(publisherName(left)) ||
      Date.parse(publishedAt(right)) - Date.parse(publishedAt(left)),
  );
}

export function mergeCanonicalEvents(
  canonicalEvent: Event,
  duplicateEvent: Event,
): Event {
  const distinctArticles = new Map<string, Article>();
  for (const article of [
    ...canonicalEvent.articles,
    ...duplicateEvent.articles,
  ].sort(
    (left, right) =>
      right.source.prominenceScore - left.source.prominenceScore ||
      Date.parse(right.publishedAt) - Date.parse(left.publishedAt),
  )) {
    const publisherKey = canonicalPublisherKey(article.source.publisherName);
    if (!distinctArticles.has(publisherKey)) {
      distinctArticles.set(publisherKey, {
        ...article,
        eventId: canonicalEvent.id,
      });
    }
  }
  const allArticles = [...distinctArticles.values()];
  const articles = selectBalancedSources(
    allArticles,
    (article) => article.source.publisherName,
    (article) => article.publishedAt,
  );
  const affectedCountries = [
    ...new Set(
      [
        ...canonicalEvent.affectedCountries,
        ...duplicateEvent.affectedCountries,
      ].filter((country) => country && country !== "GLOBAL"),
    ),
  ];
  const independentSourceCount = Math.max(
    canonicalEvent.scoringInput.independentSourceCount,
    duplicateEvent.scoringInput.independentSourceCount,
    allArticles.length,
  );
  const publisherProminence =
    allArticles.reduce(
      (total, article) => total + article.source.prominenceScore,
      0,
    ) / Math.max(1, allArticles.length);
  const scoringInput = {
    independentSourceCount,
    sourceCountryCount: Math.max(
      canonicalEvent.scoringInput.sourceCountryCount,
      duplicateEvent.scoringInput.sourceCountryCount,
    ),
    affectedCountryCount: Math.max(1, affectedCountries.length),
    countrySignificance: Math.max(
      canonicalEvent.scoringInput.countrySignificance,
      duplicateEvent.scoringInput.countrySignificance,
    ),
    publisherProminence,
    ageHours: Math.min(
      canonicalEvent.scoringInput.ageHours,
      duplicateEvent.scoringInput.ageHours,
    ),
    articlesPerHour: Math.max(
      canonicalEvent.scoringInput.articlesPerHour,
      duplicateEvent.scoringInput.articlesPerHour,
    ),
  };
  const scoring = calculateImportance(scoringInput);
  return {
    ...canonicalEvent,
    summary:
      independentSourceCount > 1
        ? `${independentSourceCount} independent publishers matched this occurrence. The displayed reports prioritize viewpoint diversity, publisher prominence, and recency.`
        : canonicalEvent.summary,
    geographicScope:
      affectedCountries.length > 1
        ? "International"
        : canonicalEvent.geographicScope,
    primaryCountry:
      canonicalEvent.primaryCountry === "GLOBAL" && affectedCountries[0]
        ? affectedCountries[0]
        : canonicalEvent.primaryCountry,
    affectedCountries,
    firstSeenAt:
      Date.parse(canonicalEvent.firstSeenAt) <=
      Date.parse(duplicateEvent.firstSeenAt)
        ? canonicalEvent.firstSeenAt
        : duplicateEvent.firstSeenAt,
    lastUpdatedAt:
      Date.parse(canonicalEvent.lastUpdatedAt) >=
      Date.parse(duplicateEvent.lastUpdatedAt)
        ? canonicalEvent.lastUpdatedAt
        : duplicateEvent.lastUpdatedAt,
    importanceScore: scoring.score,
    importanceLabel: scoring.label,
    scoringComponents: scoring.components,
    scoringInput,
    articles,
  };
}

function articleAgeHours(article: LiveArticle, reference: number) {
  const published = Date.parse(article.publishedAt);
  if (!Number.isFinite(published)) return 72;
  return Math.max(0, (reference - published) / 3_600_000);
}

function createSource(article: LiveArticle): NewsSource {
  return {
    id: `live-source-${stableId(
      canonicalPublisherKey(article.publisherName),
    )}`,
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
      const visibleSourceArticles = selectBalancedSources(
        sourceArticles,
        (article) => article.publisherName,
        (article) => article.publishedAt,
      );
      const representative = representativeArticle(cluster);
      const headline = representative?.title ?? "Current report";
      const eventId = `live-event-${stableId(headline.toLowerCase())}`;
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
        affectedCountryCount: 1,
        countrySignificance: country ? 55 : 60,
        publisherProminence: averageProminence,
        ageHours: youngestAge,
        articlesPerHour: Math.max(0.2, cluster.length / 6),
      });
      const publisherNames = visibleSourceArticles.map(
        (article) => article.publisherName,
      );
      const summary =
        sources.size > 1
          ? `${sources.size} independent publishers matched this occurrence, including ${publisherNames.join(
              ", ",
            )}. The displayed reports prioritize viewpoint diversity, publisher prominence, and recency.`
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
          affectedCountryCount: 1,
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

export function enrichEventWithCoverage(
  event: Event,
  payload: LiveNewsPayload,
): Event {
  const combined = new Map<string, Article>();
  for (const article of event.articles) {
    combined.set(article.source.id, article);
  }
  for (const liveArticle of payload.articles) {
    const source = createSource(liveArticle);
    const current = combined.get(source.id);
    if (
      current &&
      Date.parse(current.publishedAt) >= Date.parse(liveArticle.publishedAt)
    ) {
      continue;
    }
    combined.set(source.id, {
      id: `live-article-${liveArticle.id}`,
      headline: liveArticle.title,
      originalUrl: liveArticle.url,
      source,
      publishedAt: liveArticle.publishedAt,
      extractedCountries: event.affectedCountries,
      category: classifyLiveHeadline(liveArticle.title),
      eventId: event.id,
    });
  }

  const allArticles = [...combined.values()];
  const visibleArticles = selectBalancedSources(
    allArticles,
    (article) => article.source.publisherName,
    (article) => article.publishedAt,
  );
  const averageProminence =
    allArticles.reduce(
      (sum, article) => sum + article.source.prominenceScore,
      0,
    ) / Math.max(1, allArticles.length);
  const nextInput = {
    ...event.scoringInput,
    independentSourceCount: allArticles.length,
    publisherProminence: averageProminence,
    articlesPerHour: Math.max(
      event.scoringInput.articlesPerHour,
      allArticles.length / 6,
    ),
  };
  const scoring = calculateImportance(nextInput);

  return {
    ...event,
    summary:
      allArticles.length > 1
        ? `Expanded topic search matched ${allArticles.length} independent publishers. The ${visibleArticles.length} displayed reports prioritize left, right, and center-rated publishers when available, then publisher prominence and recency.`
        : "Expanded topic search found one matching publisher in the current seven-day window.",
    importanceScore: scoring.score,
    importanceLabel: scoring.label,
    scoringComponents: scoring.components,
    scoringInput: nextInput,
    articles: visibleArticles,
    lastUpdatedAt:
      allArticles
        .map((article) => article.publishedAt)
        .sort((left, right) => Date.parse(right) - Date.parse(left))[0] ??
      event.lastUpdatedAt,
  };
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
