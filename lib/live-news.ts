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

const SUMMARY_BOILERPLATE =
  /^(?:expanded topic search|current reporting indexed|current reporting from|browse current|open the source|the displayed reports|live coverage)/i;

function cleanFeedText(value: string) {
  return value
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function truncateSummary(value: string, maxLength = 180) {
  if (value.length <= maxLength) return value;
  const shortened = value.slice(0, maxLength - 1);
  const wordBoundary = shortened.lastIndexOf(" ");
  return `${shortened.slice(0, Math.max(80, wordBoundary))}…`;
}

function conciseEventSummary(
  articles: LiveArticle[],
  headline: string,
  fallback = "",
) {
  const normalizedHeadline = cleanFeedText(headline).toLowerCase();
  const candidates = articles
    .map((article) => cleanFeedText(article.description ?? ""))
    .filter(
      (description) =>
        description.length >= 35 &&
        !SUMMARY_BOILERPLATE.test(description) &&
        description.toLowerCase() !== normalizedHeadline,
    )
    .sort((left, right) => {
      const leftComplete = /[.!?]$/.test(left) ? 1 : 0;
      const rightComplete = /[.!?]$/.test(right) ? 1 : 0;
      return rightComplete - leftComplete || left.length - right.length;
    });
  const candidate = candidates[0];
  if (candidate) {
    const firstSentence =
      candidate.match(/^.*?[.!?](?:\s|$)/)?.[0]?.trim() ?? candidate;
    return truncateSummary(firstSentence);
  }
  const cleanedFallback = cleanFeedText(fallback);
  if (cleanedFallback && !SUMMARY_BOILERPLATE.test(cleanedFallback)) {
    return truncateSummary(cleanedFallback);
  }
  const cleanedHeadline = cleanFeedText(headline).replace(/[.!?]+$/, "");
  return truncateSummary(`${cleanedHeadline}.`);
}

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
      "drone",
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
      "mobilization",
      "mobilisation",
      "navy",
      "naval",
      "rebel",
      "rebellion",
      "revolution",
      "riot",
      "retaliation",
      "security",
      "settler",
      "shelling",
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
      "charged with",
      "criminal charge",
      "criminal charges",
      "extradition",
      "faces charges",
      "indicted",
      "indictment",
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
      "killed",
      "killing",
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
      "blood",
      "cigarette",
      "cigarette packs",
      "clinic",
      "disease",
      "emergency room",
      "flu",
      "health",
      "hospital",
      "cancer",
      "covid",
      "doctor",
      "ebola",
      "malaria",
      "medical",
      "medication",
      "medicine",
      "mental health",
      "ozempic",
      "outbreak",
      "patient",
      "pharma",
      "pharmacare",
      "pharmaceutical",
      "physician",
      "smoking",
      "surgery",
      "tobacco",
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
      "paddleboarder",
      "pool",
      "preview",
      "race",
      "record time",
      "roster",
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
      "world junior",
      "world title",
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
      "comedian",
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
      "daily show",
      "late night",
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
      "beluga",
      "whale",
      "whales",
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
      "development charge",
      "development charges",
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
      "invest",
      "investment",
      "jobs",
      "manufacturing",
      "market",
      "mortgage",
      "oil",
      "petroleum",
      "partnership",
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
      "party",
      "political",
      "politician",
      "trump",
      "carney",
      "mayor",
      "minister",
      "parliament",
      "pm pledges",
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
      "human rights",
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

// These describe common news templates rather than the identity of an
// occurrence. Excluding them prevents unrelated crime reports from merging
// merely because both mention a suspect, police, or someone being killed.
const OCCURRENCE_GENERIC_TOKENS = new Set([
  "attack",
  "dead",
  "deadly",
  "injur",
  "injured",
  "kill",
  "killed",
  "official",
  "police",
  "shoot",
  "shooting",
  "suspect",
  "victim",
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
  if (token === "games") return "game";
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

function occurrenceIdentityTokens(value: string) {
  return newsTextTokens(value).filter(
    (token) => !OCCURRENCE_GENERIC_TOKENS.has(token),
  );
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
  const leftTitle = occurrenceIdentityTokens(left.title);
  const rightTitle = occurrenceIdentityTokens(right.title);
  const title = tokenMetrics(leftTitle, rightTitle);
  const leftContext = occurrenceIdentityTokens(
    `${left.title} ${left.description ?? ""}`,
  );
  const rightContext = occurrenceIdentityTokens(
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
  if (/\b(?:latest )?news bulletin\b/iu.test(normalized)) return "Other";
  let bestCategory: Category = "Other";
  let bestScore = 0;

  for (const [category, terms] of CATEGORY_TERMS) {
    const countedSignals = new Set<string>();
    let score = terms.reduce((total, term) => {
      const trimmedTerm = term.trim();
      const signalKey = trimmedTerm.includes(" ")
        ? trimmedTerm.replace(/\s+/g, " ")
        : stemToken(trimmedTerm);
      if (countedSignals.has(signalKey)) return total;
      countedSignals.add(signalKey);
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
      category === "Conflict and security" &&
      /\b(?:strikes?|hits?)\b.{0,90}\b(?:base|bases|border|capital|cities|city|military|site|sites|territory)\b/iu.test(
        normalized,
      )
    ) {
      score += 2;
    }
    if (
      category === "Economy" &&
      /\btariffs?\b/iu.test(normalized)
    ) {
      score += 2;
    }

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
  const normalizedHeadline = cleanFeedText(canonicalEvent.headline).toLowerCase();
  const summary =
    [canonicalEvent.summary, duplicateEvent.summary]
      .map(cleanFeedText)
      .filter((candidate) => candidate && !SUMMARY_BOILERPLATE.test(candidate))
      .sort((left, right) => {
        const leftRepeatsHeadline =
          left.replace(/[.!?]+$/, "").toLowerCase() ===
          normalizedHeadline.replace(/[.!?]+$/, "");
        const rightRepeatsHeadline =
          right.replace(/[.!?]+$/, "").toLowerCase() ===
          normalizedHeadline.replace(/[.!?]+$/, "");
        return (
          Number(leftRepeatsHeadline) - Number(rightRepeatsHeadline) ||
          left.length - right.length
        );
      })[0] ?? `${cleanFeedText(canonicalEvent.headline).replace(/[.!?]+$/, "")}.`;
  return {
    ...canonicalEvent,
    summary: truncateSummary(summary),
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

export function mergeEventFeeds(...feeds: Event[][]) {
  const canonicalEvents: Event[] = [];
  for (const event of feeds.flat()) {
    const existingIndex = canonicalEvents.findIndex(
      (existing) =>
        existing.id === event.id ||
        eventsDescribeSameOccurrence(existing, event),
    );
    if (existingIndex >= 0) {
      canonicalEvents[existingIndex] = mergeCanonicalEvents(
        canonicalEvents[existingIndex],
        event,
      );
    } else {
      canonicalEvents.push(event);
    }
  }
  return canonicalEvents.sort(
    (left, right) =>
      right.importanceScore - left.importanceScore ||
      Date.parse(right.lastUpdatedAt) - Date.parse(left.lastUpdatedAt),
  );
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
      const classificationText = [
        headline,
        ...cluster.flatMap((article) => [
          article.title,
          article.description ?? "",
        ]),
      ].join(" ");
      const headlineCategory = classifyLiveHeadline(headline);
      const eventCategory =
        headlineCategory === "Local affairs"
          ? classifyLiveHeadline(classificationText)
          : headlineCategory;
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
        countrySignificance: 60,
        publisherProminence: averageProminence,
        ageHours: youngestAge,
        articlesPerHour: Math.max(0.2, cluster.length / 6),
      });
      const summary = conciseEventSummary(cluster, headline);
      const orderedDates = cluster
        .map((article) => article.publishedAt)
        .sort((left, right) => Date.parse(left) - Date.parse(right));

      return {
        id: eventId,
        headline,
        summary,
        category: eventCategory,
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
          countrySignificance: 60,
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
  const eventHeadlines = [
    event.headline,
    ...event.articles.map((article) => article.headline),
  ];
  const matchingCoverage = payload.articles.filter((article) =>
    eventHeadlines.some((headline) => {
      const headlineTokens = occurrenceIdentityTokens(headline);
      const articleTokens = new Set(
        occurrenceIdentityTokens(
          `${article.title} ${article.description ?? ""}`,
        ),
      );
      const shared = headlineTokens.filter((token) =>
        articleTokens.has(token),
      );
      const distinctiveShared = shared.filter(
        (token) => token.length >= 6,
      ).length;
      if (headlineTokens.length <= 4) {
        return (
          shared.length >= 3 ||
          (shared.length >= 2 &&
            distinctiveShared >= 1 &&
            shared.length / Math.max(1, headlineTokens.length) >= 0.66)
        );
      }
      return (
        shared.length >= 4 ||
        (shared.length >= 3 &&
          shared.length / headlineTokens.length >= 0.4) ||
        (shared.length >= 2 &&
          distinctiveShared >= 1 &&
          shared.length / headlineTokens.length >= 0.5)
      );
    }),
  );
  const combined = new Map<string, Article>();
  for (const article of event.articles) {
    combined.set(article.source.id, article);
  }
  for (const liveArticle of matchingCoverage) {
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
  const matchedPublisherCount = Math.max(
    event.matchedPublisherCount ?? 0,
    event.scoringInput.independentSourceCount,
    allArticles.length,
  );

  return {
    ...event,
    summary: conciseEventSummary(
      matchingCoverage,
      event.headline,
      event.summary,
    ),
    matchedPublisherCount,
    articles: visibleArticles,
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
