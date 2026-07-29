import {
  canonicalCountryName,
  countrySearchTerms,
  textMatchesCountry,
} from "../lib/country-terms";
import { googleNewsLocaleForCountry } from "../lib/country-locale";
import { newsTextTokens } from "../lib/live-news";

export interface FeedArticle {
  id: string;
  title: string;
  description?: string;
  url: string;
  publisherName: string;
  publisherUrl: string;
  publishedAt: string;
  originalTitle?: string;
  originalDescription?: string;
  originalLanguage?: string;
}

interface CandidateArticle extends FeedArticle {
  searchableText: string;
}

interface ProviderDiagnostic {
  name: string;
  status: "ok" | "failed";
  articleCount: number;
}

interface ProviderResult {
  name: string;
  ok: boolean;
  articles: CandidateArticle[];
  error?: string;
}

interface NewsProvider {
  name: string;
  publisherUrl: string;
  timeoutMs: number;
  filterByCountry: boolean;
  url(scope: "country" | "global" | "event", countryName: string | null): URL;
  parse(body: string): CandidateArticle[];
}

type FetchImplementation = typeof fetch;

const MAX_PROVIDER_BYTES = 1_500_000;
const MAX_COUNTRY_ARTICLES = 180;
const MAX_GLOBAL_ARTICLES = 700;
const MAX_EVENT_ARTICLES = 40;
const MAX_MAP_BATCH_COUNTRIES = 40;
const MAX_MAP_ARTICLES_PER_COUNTRY = 32;
const CACHE_SECONDS = 300;
const MAX_ARTICLE_AGE_MS = 8 * 24 * 60 * 60 * 1_000;
const VALID_COUNTRY_NAME = /^[\p{L}\p{M}\d .,'’()&-]+$/u;
const EVENT_STOP_WORDS = new Set([
  "about",
  "after",
  "again",
  "against",
  "amid",
  "and",
  "are",
  "but",
  "for",
  "from",
  "has",
  "have",
  "latest",
  "live",
  "into",
  "its",
  "new",
  "still",
  "under",
  "over",
  "says",
  "stretch",
  "the",
  "their",
  "this",
  "that",
  "with",
]);
const GENERIC_OCCURRENCE_TOKENS = new Set([
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
const COUNTRY_NEWS_QUERY_OVERRIDES: Record<string, string> = {
  "British Indian Ocean Territory": "Diego Garcia",
  "Saint Helena, Ascension and Tristan da Cunha": "St Helena",
  "Saint Pierre and Miquelon": "Saint-Pierre-et-Miquelon",
  "South Georgia and the South Sandwich Islands": "South Georgia island",
};
const ENGLISH_SIGNAL_WORDS = new Set([
  "after", "and", "are", "as", "at", "for", "from", "has", "in",
  "is", "new", "of", "on", "says", "the", "to", "with",
]);
const NON_ENGLISH_SIGNAL_WORDS = new Set([
  "al", "avec", "că", "care", "ce", "da", "dans", "de", "del", "des",
  "di", "din", "do", "du", "el", "en", "et", "für", "gli", "il", "în",
  "la", "las", "le", "les", "los", "mais", "más", "nel", "o", "pe",
  "pela", "pentru", "por", "pour", "que", "qui", "și", "sous", "su",
  "sur", "un", "una", "une", "va", "și",
]);

export function isLikelyEnglishHeadline(value: string) {
  if (
    /[\p{Script=Arabic}\p{Script=Armenian}\p{Script=Bengali}\p{Script=Cyrillic}\p{Script=Devanagari}\p{Script=Georgian}\p{Script=Greek}\p{Script=Han}\p{Script=Hangul}\p{Script=Hebrew}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}]/u.test(
      value,
    )
  ) {
    return false;
  }
  const words = value
    .toLocaleLowerCase("en")
    .match(/\p{L}+/gu) ?? [];
  const englishSignals = words.filter((word) =>
    ENGLISH_SIGNAL_WORDS.has(word),
  ).length;
  const nonEnglishSignals = words.filter((word) =>
    NON_ENGLISH_SIGNAL_WORDS.has(word),
  ).length;
  const hasAccentedLatin = /[\u00c0-\u024f]/u.test(value);
  return !(
    (nonEnglishSignals >= 3 ||
      (nonEnglishSignals >= 2 && englishSignals === 0) ||
      (hasAccentedLatin &&
        nonEnglishSignals >= 1 &&
        englishSignals === 0)) &&
    englishSignals < nonEnglishSignals
  );
}

function newsSearchTerms(countryName: string, requestedRegion = "") {
  const terms = countrySearchTerms(countryName);
  const locale = googleNewsLocaleForCountry(countryName, requestedRegion);
  try {
    const localName = new Intl.DisplayNames([locale.language], {
      type: "region",
    }).of(locale.region);
    if (localName) terms.push(localName);
  } catch {
    // The canonical and known alias terms remain sufficient as a fallback.
  }
  return [...new Set(terms)];
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  operation: (item: T) => Promise<R>,
) {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (nextIndex < items.length) {
        const index = nextIndex;
        nextIndex += 1;
        results[index] = await operation(items[index]);
      }
    },
  );
  await Promise.all(workers);
  return results;
}

function decodeXml(value: string) {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&#(\d+);/g, (_, code: string) =>
      String.fromCodePoint(Number(code)),
    )
    .replace(/&#x([\da-f]+);/gi, (_, code: string) =>
      String.fromCodePoint(Number.parseInt(code, 16)),
    )
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .trim();
}

function tagValue(block: string, tag: string) {
  const escapedTag = tag.replace(":", "\\:");
  const match = block.match(
    new RegExp(
      `<${escapedTag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escapedTag}>`,
      "i",
    ),
  );
  return match ? decodeXml(match[1]) : "";
}

function stripMarkup(value: string) {
  return decodeXml(value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " "))
    .replace(/[\u{1F1E6}-\u{1F1FF}]/gu, "")
    .replace(/\p{Extended_Pictographic}/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

function safeIsoDate(value: string) {
  const gdeltDate = value.match(
    /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z?$/,
  );
  const normalized = gdeltDate
    ? `${gdeltDate[1]}-${gdeltDate[2]}-${gdeltDate[3]}T${gdeltDate[4]}:${gdeltDate[5]}:${gdeltDate[6]}Z`
    : value;
  const timestamp = Date.parse(normalized);
  return Number.isFinite(timestamp)
    ? new Date(timestamp).toISOString()
    : null;
}

function stableId(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash >>> 0).toString(36);
}

function safeHttpUrl(value: string) {
  try {
    const url = new URL(decodeXml(value));
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.toString()
      : "";
  } catch {
    return "";
  }
}

function canonicalArticleKey(article: FeedArticle) {
  try {
    const url = new URL(article.url);
    return `${url.hostname.replace(/^www\./, "")}${url.pathname}`.toLowerCase();
  } catch {
    return article.title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  }
}

function buildCandidate(
  title: string,
  url: string,
  publisherName: string,
  publisherUrl: string,
  publishedAt: string,
  description = "",
  id = "",
): CandidateArticle | null {
  const safeUrl = safeHttpUrl(url);
  const cleanTitle = stripMarkup(title);
  const cleanDescription = stripMarkup(description).slice(0, 500);
  const safePublishedAt = safeIsoDate(publishedAt);
  let publisherFromUrl = "";
  try {
    const hostParts = new URL(safeUrl).hostname
      .replace(/^www\./i, "")
      .split(".");
    const secondLevel = hostParts.at(-2) ?? "";
    const usesCountrySuffix =
      (hostParts.at(-1)?.length ?? 0) === 2 &&
      ["co", "com", "net", "org"].includes(secondLevel);
    publisherFromUrl = (
      usesCountrySuffix ? hostParts.at(-3) : secondLevel
    )
      ?.replace(/^www\./i, "")
      .replace(/[-_]+/g, " ")
      .replace(/\b\w/g, (character) => character.toUpperCase()) ?? "";
  } catch {
    // The candidate is rejected below when its article URL is invalid.
  }
  const statedPublisherName = stripMarkup(publisherName);
  const cleanPublisherName =
    statedPublisherName &&
    statedPublisherName.toLowerCase() !== "independent publisher"
      ? statedPublisherName
      : publisherFromUrl;
  const publisherPattern = cleanPublisherName.replace(
    /[.*+?^${}()|[\]\\]/g,
    "\\$&",
  );
  const searchableDescription = publisherPattern
    ? cleanDescription.replace(new RegExp(publisherPattern, "giu"), " ")
    : cleanDescription;
  const isGenericNewsIndex =
    /\bnews\s*\|\s*today(?:'|’)?s latest stories\s*\|\s*reuters$/iu.test(
      cleanTitle,
    ) ||
    /^(?:latest|breaking)\s+.+\s+news(?:\s+and\s+headlines)?$/iu.test(
      cleanTitle,
    );
  if (
    !cleanTitle ||
    isGenericNewsIndex ||
    !safeUrl ||
    !cleanPublisherName ||
    !safePublishedAt
  ) {
    return null;
  }
  return {
    id: stableId(id || safeUrl),
    title: cleanTitle,
    description: cleanDescription || undefined,
    url: safeUrl,
    publisherName: cleanPublisherName,
    publisherUrl: safeHttpUrl(publisherUrl) || new URL(safeUrl).origin,
    publishedAt: safePublishedAt,
    // Google descriptions repeat the publisher name. Excluding that
    // attribution prevents brands such as "Yahoo News Canada" from making
    // an unrelated story look country-relevant.
    searchableText: `${cleanTitle} ${searchableDescription}`.trim(),
  };
}

export function parsePublisherRss(
  xml: string,
  publisherName: string,
  publisherUrl: string,
) {
  const items = xml.match(/<item(?:\s[^>]*)?>[\s\S]*?<\/item>/gi) ?? [];
  return items.flatMap((item) => {
    const article = buildCandidate(
      tagValue(item, "title"),
      tagValue(item, "link"),
      publisherName,
      publisherUrl,
      tagValue(item, "pubDate") ||
        tagValue(item, "published") ||
        tagValue(item, "updated") ||
        tagValue(item, "dc:date"),
      tagValue(item, "description") || tagValue(item, "content:encoded"),
      tagValue(item, "guid"),
    );
    return article ? [article] : [];
  });
}

export function parseGoogleNewsFeed(xml: string) {
  const items = xml.match(/<item(?:\s[^>]*)?>[\s\S]*?<\/item>/gi) ?? [];
  return items.flatMap((item) => {
    const publisherName = tagValue(item, "source");
    const sourceTag = item.match(/<source[^>]*\surl="([^"]+)"[^>]*>/i);
    const rawTitle = tagValue(item, "title");
    const suffix = ` - ${publisherName}`;
    const title = rawTitle.endsWith(suffix)
      ? rawTitle.slice(0, -suffix.length).trim()
      : rawTitle;
    const article = buildCandidate(
      title,
      tagValue(item, "link"),
      publisherName,
      sourceTag?.[1] ?? "",
      tagValue(item, "pubDate"),
      tagValue(item, "description"),
      tagValue(item, "guid"),
    );
    return article ? [article] : [];
  });
}

function originalBingArticleUrl(value: string) {
  const safeUrl = safeHttpUrl(value);
  if (!safeUrl) return "";
  try {
    const url = new URL(safeUrl);
    if (
      (url.hostname === "bing.com" || url.hostname.endsWith(".bing.com")) &&
      url.searchParams.get("url")
    ) {
      return safeHttpUrl(url.searchParams.get("url") ?? "") || safeUrl;
    }
  } catch {
    return safeUrl;
  }
  return safeUrl;
}

export function parseBingNewsFeed(xml: string) {
  const items = xml.match(/<item(?:\s[^>]*)?>[\s\S]*?<\/item>/gi) ?? [];
  return items.flatMap((item) => {
    const articleUrl = originalBingArticleUrl(tagValue(item, "link"));
    const publisherName = tagValue(item, "News:Source")
      .replace(/\s+on\s+MSN$/i, "")
      .trim();
    let publisherUrl = "";
    try {
      publisherUrl = new URL(articleUrl).origin;
    } catch {
      // buildCandidate rejects the article when its URL is invalid.
    }
    const article = buildCandidate(
      tagValue(item, "title"),
      articleUrl,
      publisherName,
      publisherUrl,
      tagValue(item, "pubDate"),
      tagValue(item, "description"),
      tagValue(item, "guid") || articleUrl,
    );
    return article ? [article] : [];
  });
}

export function parseGdeltJson(body: string) {
  const payload = JSON.parse(body) as {
    articles?: Array<{
      url?: string;
      title?: string;
      domain?: string;
      seendate?: string;
      language?: string;
    }>;
  };
  return (payload.articles ?? []).flatMap((item) => {
    if (item.language && item.language.toLowerCase() !== "english") return [];
    const publisherUrl = item.domain ? `https://${item.domain}` : "";
    const publisherName = item.domain
      ? item.domain.replace(/^www\./, "")
      : "Independent publisher";
    const article = buildCandidate(
      item.title ?? "",
      item.url ?? "",
      publisherName,
      publisherUrl,
      item.seendate ?? "",
      "",
      item.url,
    );
    return article ? [article] : [];
  });
}

function fixedRssProvider(
  name: string,
  publisherUrl: string,
  feedUrl: string,
): NewsProvider {
  return {
    name,
    publisherUrl,
    timeoutMs: 3_500,
    filterByCountry: true,
    url: () => new URL(feedUrl),
    parse: (body) => parsePublisherRss(body, name, publisherUrl),
  };
}

const CORE_PROVIDERS: NewsProvider[] = [
  fixedRssProvider(
    "The Guardian",
    "https://www.theguardian.com/world",
    "https://www.theguardian.com/world/rss",
  ),
  fixedRssProvider(
    "BBC News",
    "https://www.bbc.com/news/world",
    "https://feeds.bbci.co.uk/news/world/rss.xml",
  ),
  fixedRssProvider(
    "BBC News",
    "https://www.bbc.com/news/world/africa",
    "https://feeds.bbci.co.uk/news/world/africa/rss.xml",
  ),
  fixedRssProvider(
    "BBC News",
    "https://www.bbc.com/news/world/asia",
    "https://feeds.bbci.co.uk/news/world/asia/rss.xml",
  ),
  fixedRssProvider(
    "BBC News",
    "https://www.bbc.com/news/world/europe",
    "https://feeds.bbci.co.uk/news/world/europe/rss.xml",
  ),
  fixedRssProvider(
    "BBC News",
    "https://www.bbc.com/news/world/latin_america",
    "https://feeds.bbci.co.uk/news/world/latin_america/rss.xml",
  ),
  fixedRssProvider(
    "BBC News",
    "https://www.bbc.com/news/world/middle_east",
    "https://feeds.bbci.co.uk/news/world/middle_east/rss.xml",
  ),
  fixedRssProvider(
    "BBC News",
    "https://www.bbc.com/news/world/us_and_canada",
    "https://feeds.bbci.co.uk/news/world/us_and_canada/rss.xml",
  ),
  fixedRssProvider(
    "NPR",
    "https://www.npr.org/sections/world/",
    "https://feeds.npr.org/1004/rss.xml",
  ),
  fixedRssProvider(
    "Deutsche Welle",
    "https://www.dw.com/",
    "https://rss.dw.com/xml/rss-en-all",
  ),
  fixedRssProvider(
    "Al Jazeera",
    "https://www.aljazeera.com/",
    "https://www.aljazeera.com/xml/rss/all.xml",
  ),
  fixedRssProvider(
    "France 24",
    "https://www.france24.com/en/",
    "https://www.france24.com/en/rss",
  ),
  fixedRssProvider(
    "CBC News",
    "https://www.cbc.ca/news/world",
    "https://www.cbc.ca/cmlink/rss-world",
  ),
  fixedRssProvider(
    "Euronews",
    "https://www.euronews.com/news/international",
    "https://www.euronews.com/rss?level=theme&name=news",
  ),
  fixedRssProvider(
    "Sky News",
    "https://news.sky.com/world",
    "https://feeds.skynews.com/feeds/rss/world.xml",
  ),
  fixedRssProvider(
    "UN News",
    "https://news.un.org/",
    "https://news.un.org/feed/subscribe/en/news/all/rss.xml",
  ),
  fixedRssProvider(
    "Fox News",
    "https://www.foxnews.com/world",
    "https://moxie.foxnews.com/google-publisher/world.xml",
  ),
  fixedRssProvider(
    "New York Post",
    "https://nypost.com/",
    "https://nypost.com/feed/",
  ),
  fixedRssProvider(
    "Washington Examiner",
    "https://www.washingtonexaminer.com/",
    "https://www.washingtonexaminer.com/feed",
  ),
  fixedRssProvider(
    "National Review",
    "https://www.nationalreview.com/",
    "https://www.nationalreview.com/feed/",
  ),
  fixedRssProvider(
    "RNZ Pacific",
    "https://www.rnz.co.nz/international/pacific-news",
    "https://www.rnz.co.nz/rss/pacific.xml",
  ),
];

const GDELT_PROVIDER: NewsProvider = {
  name: "GDELT",
  publisherUrl: "https://www.gdeltproject.org/",
  timeoutMs: 3_500,
  filterByCountry: false,
  url: (scope, countryName) => {
    const url = new URL("https://api.gdeltproject.org/api/v2/doc/doc");
    url.searchParams.set(
      "query",
      scope === "country" && countryName
        ? `"${countryName}" sourcelang:english`
        : "sourcelang:english",
    );
    url.searchParams.set("mode", "artlist");
    url.searchParams.set("maxrecords", "50");
    url.searchParams.set("format", "json");
    url.searchParams.set("timespan", scope === "country" ? "7d" : "3d");
    url.searchParams.set("sort", "datedesc");
    return url;
  },
  parse: parseGdeltJson,
};

function bingNewsProvider(name: string, query: string): NewsProvider {
  return {
    name,
    publisherUrl: "https://www.bing.com/news",
    timeoutMs: 4_500,
    filterByCountry: false,
    url: () => {
      const url = new URL("https://www.bing.com/news/search");
      url.searchParams.set("q", query);
      url.searchParams.set("format", "rss");
      url.searchParams.set("setlang", "en");
      return url;
    },
    parse: parseBingNewsFeed,
  };
}

function googleCountryProvider(countryName: string): NewsProvider {
  const queryTerm = COUNTRY_NEWS_QUERY_OVERRIDES[countryName] ?? countryName;
  const locale = googleNewsLocaleForCountry(countryName);
  return {
    name: "Google News · Current country search",
    publisherUrl: "https://news.google.com/",
    timeoutMs: 4_500,
    filterByCountry: false,
    url: () => {
      const url = new URL("https://news.google.com/rss/search");
      url.searchParams.set("q", `"${queryTerm}" when:7d`);
      url.searchParams.set("hl", "en");
      url.searchParams.set("gl", locale.region);
      url.searchParams.set("ceid", `${locale.region}:en`);
      return url;
    },
    parse: parseGoogleNewsFeed,
  };
}

const BING_WORLD_PROVIDER = bingNewsProvider(
  "Bing News · World",
  "world news",
);

function countryBingProviders(countryName: string) {
  const alternateTerm =
    COUNTRY_NEWS_QUERY_OVERRIDES[countryName] ??
    countrySearchTerms(countryName)
      .filter((term) => term !== countryName)
      .sort((left, right) => right.length - left.length)[0] ??
    countryName;
  return [
    bingNewsProvider(
      "Bing News · Current country search",
      `${countryName} news`,
    ),
    bingNewsProvider(
      "Bing News · Latest country search",
      `${countryName} latest`,
    ),
    bingNewsProvider(
      "Bing News · Alternate country search",
      `${alternateTerm} news`,
    ),
  ];
}

function eventTokens(value: string) {
  return newsTextTokens(value).filter(
    (token) =>
      !EVENT_STOP_WORDS.has(token) &&
      !GENERIC_OCCURRENCE_TOKENS.has(token),
  );
}

export function articleMatchesEvent(
  article: Pick<CandidateArticle, "searchableText">,
  headline: string,
) {
  const headlineTokens = eventTokens(headline);
  const articleTokenSet = new Set(eventTokens(article.searchableText));
  if (!headlineTokens.length) return false;
  const shared = headlineTokens.filter((token) =>
    articleTokenSet.has(token),
  ).length;
  const distinctiveShared = headlineTokens.filter(
    (token) => token.length >= 6 && articleTokenSet.has(token),
  ).length;
  if (headlineTokens.length <= 4) {
    return (
      shared >= 3 ||
      (shared >= 2 &&
        distinctiveShared >= 1 &&
        shared / headlineTokens.length >= 0.66)
    );
  }
  return (
    shared >= 4 ||
    (shared >= 3 && shared / headlineTokens.length >= 0.4) ||
    (shared >= 2 &&
      distinctiveShared >= 1 &&
      shared / headlineTokens.length >= 0.5)
  );
}

function eventBingProviders(
  headline: string,
  countryName: string | null,
) {
  const cleanHeadline = headline
    .replace(/["“”]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const focusedTerms = eventTokens(cleanHeadline).slice(0, 8);
  const countryTerm = countryName ? `"${countryName}" ` : "";
  const focusedQuery = `${countryTerm}${focusedTerms.join(" ")}`;
  const leftSites =
    "(site:cnn.com OR site:theguardian.com OR site:apnews.com OR site:nbcnews.com)";
  const centerSites =
    "(site:reuters.com OR site:bbc.com OR site:cbsnews.com OR site:dw.com)";
  const rightSites =
    "(site:foxnews.com OR site:nypost.com OR site:washingtonexaminer.com OR site:nationalreview.com)";

  return [
    bingNewsProvider(
      "Bing News · Exact topic",
      `"${cleanHeadline.slice(0, 220)}"`,
    ),
    bingNewsProvider(
      "Bing News · Related coverage",
      focusedQuery,
    ),
    bingNewsProvider(
      "Bing News · Left-rated coverage",
      `${focusedQuery} ${leftSites}`,
    ),
    bingNewsProvider(
      "Bing News · Center-rated coverage",
      `${focusedQuery} ${centerSites}`,
    ),
    bingNewsProvider(
      "Bing News · Right-rated coverage",
      `${focusedQuery} ${rightSites}`,
    ),
  ];
}

function providersForRequest(
  scope: "country" | "global",
  countryName: string | null,
) {
  if (scope === "global" || !countryName) {
    return [...CORE_PROVIDERS, GDELT_PROVIDER, BING_WORLD_PROVIDER];
  }
  return [
    googleCountryProvider(countryName),
    ...countryBingProviders(countryName),
    GDELT_PROVIDER,
  ];
}

async function fetchMapCountry(
  requestedCountry: string,
  fetchImpl: FetchImplementation,
) {
  const countryName = canonicalCountryName(requestedCountry);
  const terms = newsSearchTerms(requestedCountry);
  const googleProvider = googleCountryProvider(countryName);
  const countryProviders = countryBingProviders(countryName);
  const results = [
    await fetchProvider(
      googleProvider,
      "country",
      countryName,
      terms,
      fetchImpl,
    ),
  ];
  let relevantResults = countryRelevantResults(results, terms);
  if (!hasProviderArticles(relevantResults)) {
    const [currentCountryResult, gdeltResult] = await Promise.all([
      fetchProvider(
        countryProviders[0],
        "country",
        countryName,
        terms,
        fetchImpl,
      ),
      fetchProvider(
        GDELT_PROVIDER,
        "country",
        countryName,
        terms,
        fetchImpl,
      ),
    ]);
    results.push(currentCountryResult, gdeltResult);
    relevantResults = [
      ...relevantResults,
      ...countryRelevantResults([currentCountryResult], terms),
      ...countryRelevantResults([gdeltResult], terms),
    ];
  }
  if (!hasProviderArticles(relevantResults)) {
    const [latestCountryResult, alternateCountryResult] = await Promise.all([
      fetchProvider(
        countryProviders[1],
        "country",
        countryName,
        terms,
        fetchImpl,
      ),
      fetchProvider(
        countryProviders[2],
        "country",
        countryName,
        terms,
        fetchImpl,
      ),
    ]);
    results.push(latestCountryResult, alternateCountryResult);
    relevantResults = [
      ...relevantResults,
      ...countryRelevantResults([latestCountryResult], terms),
      ...countryRelevantResults([alternateCountryResult], terms),
    ];
  }
  const successful = relevantResults.filter(
    (result) => result.ok && result.articles.length,
  );
  return {
    countryName: requestedCountry,
    generatedAt: new Date().toISOString(),
    available: successful.length > 0,
    articles: mergeRankedArticles(
      successful,
      MAX_MAP_ARTICLES_PER_COUNTRY,
    ),
  };
}

export function articleMatchesCountry(
  article: Pick<CandidateArticle, "searchableText">,
  terms: string[],
) {
  return textMatchesCountry(article.searchableText, terms);
}

export function articleHeadlineMatchesCountry(
  article: Pick<CandidateArticle, "title">,
  terms: string[],
) {
  return textMatchesCountry(article.title, terms);
}

function countryRelevantResults(
  results: ProviderResult[],
  terms: string[],
) {
  return results.map((result) => ({
    ...result,
    articles: result.articles.filter((article) =>
      articleHeadlineMatchesCountry(article, terms),
    ),
  }));
}

function hasProviderArticles(results: ProviderResult[]) {
  return results.some((result) => result.ok && result.articles.length);
}

function articleIsCurrent(article: CandidateArticle) {
  const publishedAt = Date.parse(article.publishedAt);
  if (!Number.isFinite(publishedAt)) return false;
  const age = Date.now() - publishedAt;
  return age >= -6 * 60 * 60 * 1_000 && age <= MAX_ARTICLE_AGE_MS;
}

async function fetchProvider(
  provider: NewsProvider,
  scope: "country" | "global" | "event",
  countryName: string | null,
  terms: string[],
  fetchImpl: FetchImplementation,
): Promise<ProviderResult> {
  const providerUrl = provider.url(scope, countryName);
  try {
    const response = await fetchImpl(providerUrl, {
      headers: {
        Accept:
          "application/rss+xml, application/json;q=0.9, application/xml;q=0.8, text/xml;q=0.7",
        "User-Agent": "WorldPulse/1.1 (live news metadata reader)",
      },
      signal: AbortSignal.timeout(provider.timeoutMs),
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const advertisedLength = Number(response.headers.get("content-length"));
    if (
      Number.isFinite(advertisedLength) &&
      advertisedLength > MAX_PROVIDER_BYTES
    ) {
      throw new Error("response too large");
    }
    const body = await response.text();
    if (body.length > MAX_PROVIDER_BYTES) {
      throw new Error("response too large");
    }
    const parsed = provider.parse(body).filter(articleIsCurrent);
    if (!parsed.length) throw new Error("no parseable articles");
    const articles =
      scope === "country" && provider.filterByCountry
        ? parsed.filter((article) =>
            articleHeadlineMatchesCountry(article, terms),
          )
        : parsed;
    return { name: provider.name, ok: true, articles };
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    console.warn(
      JSON.stringify({
        event: "news_provider_failed",
        provider: provider.name,
        error: message,
      }),
    );
    return {
      name: provider.name,
      ok: false,
      articles: [],
      error: message,
    };
  }
}

function mergeArticles(results: ProviderResult[], limit: number) {
  const seenUrls = new Set<string>();
  const seenTitles = new Set<string>();
  return results
    .flatMap((result) => result.articles)
    .filter((article) => isLikelyEnglishHeadline(article.title))
    .sort(
      (left, right) =>
        Date.parse(right.publishedAt) - Date.parse(left.publishedAt),
    )
    .filter((article) => {
      const urlKey = canonicalArticleKey(article);
      const titleKey = article.title
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, " ")
        .trim();
      if (seenUrls.has(urlKey) || seenTitles.has(titleKey)) return false;
      seenUrls.add(urlKey);
      seenTitles.add(titleKey);
      return true;
    })
    .slice(0, limit)
    .map((article) => ({
      id: article.id,
      title: article.title,
      description: article.description,
      url: article.url,
      publisherName: article.publisherName,
      publisherUrl: article.publisherUrl,
      publishedAt: article.publishedAt,
      originalTitle: article.originalTitle,
      originalDescription: article.originalDescription,
      originalLanguage: article.originalLanguage,
    }));
}

function mergeRankedArticles(results: ProviderResult[], limit: number) {
  const seenUrls = new Set<string>();
  const seenTitles = new Set<string>();
  const articles: FeedArticle[] = [];
  const maxDepth = Math.max(
    0,
    ...results.map((result) => result.articles.length),
  );

  for (
    let depth = 0;
    depth < maxDepth && articles.length < limit;
    depth += 1
  ) {
    for (const result of results) {
      const article = result.articles[depth];
      if (!article) continue;
      if (!isLikelyEnglishHeadline(article.title)) continue;
      const urlKey = canonicalArticleKey(article);
      const titleKey = article.title
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, " ")
        .trim();
      if (seenUrls.has(urlKey) || seenTitles.has(titleKey)) continue;
      seenUrls.add(urlKey);
      seenTitles.add(titleKey);
      articles.push({
        id: article.id,
        title: article.title,
        description: article.description,
        url: article.url,
        publisherName: article.publisherName,
        publisherUrl: article.publisherUrl,
        publishedAt: article.publishedAt,
        originalTitle: article.originalTitle,
        originalDescription: article.originalDescription,
        originalLanguage: article.originalLanguage,
      });
      if (articles.length === limit) break;
    }
  }

  return articles;
}

function json(data: unknown, status = 200, cacheable = true) {
  return Response.json(data, {
    status,
    headers: {
      "Cache-Control":
        status === 200 && cacheable
          ? `public, max-age=60, s-maxage=${CACHE_SECONDS}, stale-while-revalidate=86400`
          : "no-store",
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}

export async function handleLiveNews(
  request: Request,
  fetchImpl: FetchImplementation = fetch,
) {
  if (request.method !== "GET") {
    return json({ error: "Method not allowed." }, 405);
  }

  const url = new URL(request.url);
  const requestedScope = url.searchParams.get("scope");
  if (requestedScope === "map") {
    const requestedCountries = [
      ...new Set(
        (url.searchParams.get("countries") ?? "")
          .split("|")
          .map((country) => country.trim())
          .filter(Boolean),
      ),
    ];
    if (
      !requestedCountries.length ||
      requestedCountries.length > MAX_MAP_BATCH_COUNTRIES ||
      requestedCountries.some(
        (country) =>
          country.length > 80 || !VALID_COUNTRY_NAME.test(country),
      )
    ) {
      return json(
        {
          error: `Provide between 1 and ${MAX_MAP_BATCH_COUNTRIES} valid country names.`,
        },
        400,
      );
    }
    const generatedAt = new Date().toISOString();
    const countries = await mapWithConcurrency(
      requestedCountries,
      4,
      (country) => fetchMapCountry(country, fetchImpl),
    );
    return json(
      {
        scope: "map",
        generatedAt,
        refreshAfterSeconds: CACHE_SECONDS,
        provider: "Rolling local-news country scan",
        countries,
      },
      200,
      true,
    );
  }

  const scope =
    requestedScope === "global"
      ? "global"
      : requestedScope === "event"
        ? "event"
        : "country";
  const requestedCountry = url.searchParams.get("country")?.trim() ?? "";
  const requestedRegion =
    url.searchParams.get("iso2")?.trim().toUpperCase() ?? "";
  const requestedHeadline = url.searchParams.get("headline")?.trim() ?? "";
  if (
    scope === "country" &&
    (!requestedCountry ||
      requestedCountry.length > 80 ||
      !VALID_COUNTRY_NAME.test(requestedCountry))
  ) {
    return json({ error: "A valid country name is required." }, 400);
  }
  if (
    scope === "event" &&
    (requestedHeadline.length < 8 || requestedHeadline.length > 300)
  ) {
    return json({ error: "A valid event headline is required." }, 400);
  }
  if (
    requestedCountry &&
    (requestedCountry.length > 80 ||
      !VALID_COUNTRY_NAME.test(requestedCountry))
  ) {
    return json({ error: "A valid country name is required." }, 400);
  }
  if (requestedRegion && !/^[A-Z]{2}$/.test(requestedRegion)) {
    return json({ error: "A valid ISO country code is required." }, 400);
  }

  const countryName =
    scope !== "global" && requestedCountry
      ? canonicalCountryName(requestedCountry)
      : null;
  const terms =
    scope === "country" && countryName
      ? newsSearchTerms(requestedCountry, requestedRegion)
      : [];
  const providers =
    scope === "event"
      ? [
          ...eventBingProviders(requestedHeadline, countryName),
          ...CORE_PROVIDERS,
        ]
      : providersForRequest(scope, countryName);
  let results = await mapWithConcurrency(
    providers,
    scope === "country" ? 3 : scope === "event" ? 4 : 6,
    (provider) =>
      fetchProvider(provider, scope, countryName, terms, fetchImpl),
  );
  if (scope === "country") {
    const relevantResults = countryRelevantResults(results, terms);
    results = relevantResults;
  }
  if (scope === "event") {
    for (const result of results) {
      result.articles = result.articles.filter((article) =>
        articleMatchesEvent(article, requestedHeadline),
      );
    }
    const viewpointProviders = providers.filter((provider) =>
      /(?:Left|Center|Right)-rated coverage/.test(provider.name),
    );
    const viewpointRetries = viewpointProviders.filter((provider) => {
      const result = results.find(
        (candidate) => candidate.name === provider.name,
      );
      return !result?.articles.length;
    });
    if (viewpointRetries.length) {
      const retryResults = await mapWithConcurrency(
        viewpointRetries,
        2,
        async (provider) => {
          const retry = await fetchProvider(
            provider,
            scope,
            countryName,
            terms,
            fetchImpl,
          );
          retry.articles = retry.articles.filter((article) =>
            articleMatchesEvent(article, requestedHeadline),
          );
          return retry;
        },
      );
      const retriesByName = new Map(
        retryResults.map((result) => [result.name, result]),
      );
      results = results.map((result) => {
        const retry = retriesByName.get(result.name);
        return retry && (retry.articles.length || !result.ok)
          ? retry
          : result;
      });
    }
  }
  const successful = results.filter((result) => result.ok);
  if (!successful.length) {
    return json(
      {
        error:
          "All live news providers are temporarily unavailable. Please try again shortly.",
      },
      503,
    );
  }

  const diagnostics: ProviderDiagnostic[] = results.map((result) => ({
    name: result.name,
    status: result.ok ? "ok" : "failed",
    articleCount: result.articles.length,
  }));
  return json({
    countryName: scope === "global" ? null : requestedCountry || null,
    scope,
    generatedAt: new Date().toISOString(),
    refreshAfterSeconds: CACHE_SECONDS,
    provider:
      scope === "event"
        ? `Expanded topic search · ${successful.length} feeds`
        : `WorldPulse live index · ${successful.length} feeds`,
    providers: diagnostics,
    degraded: successful.length < providers.length,
    articles: mergeArticles(
      successful,
      scope === "global"
        ? MAX_GLOBAL_ARTICLES
        : scope === "event"
          ? MAX_EVENT_ARTICLES
          : MAX_COUNTRY_ARTICLES,
    ),
  });
}
