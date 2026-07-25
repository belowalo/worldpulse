import {
  canonicalCountryName,
  countrySearchTerms,
  textMatchesCountry,
} from "../lib/country-terms";

export interface FeedArticle {
  id: string;
  title: string;
  description?: string;
  url: string;
  publisherName: string;
  publisherUrl: string;
  publishedAt: string;
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
  url(scope: "country" | "global", countryName: string | null): URL;
  parse(body: string): CandidateArticle[];
}

type FetchImplementation = typeof fetch;

const MAX_PROVIDER_BYTES = 1_500_000;
const MAX_COUNTRY_ARTICLES = 80;
const MAX_GLOBAL_ARTICLES = 700;
const CACHE_SECONDS = 300;

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
  return decodeXml(value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " "));
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
    : new Date().toISOString();
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
  if (!cleanTitle || !safeUrl) return null;
  return {
    id: stableId(id || safeUrl),
    title: cleanTitle,
    description: cleanDescription || undefined,
    url: safeUrl,
    publisherName: stripMarkup(publisherName) || "Independent publisher",
    publisherUrl: safeHttpUrl(publisherUrl) || new URL(safeUrl).origin,
    publishedAt: safeIsoDate(publishedAt),
    searchableText: `${cleanTitle} ${cleanDescription}`.trim(),
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
    const publisherName = tagValue(item, "source") || "Independent publisher";
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

const PROVIDERS: NewsProvider[] = [
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
  {
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
      url.searchParams.set("timespan", "3d");
      url.searchParams.set("sort", "datedesc");
      return url;
    },
    parse: parseGdeltJson,
  },
  {
    name: "Google News",
    publisherUrl: "https://news.google.com/",
    timeoutMs: 3_500,
    filterByCountry: false,
    url: (scope, countryName) => {
      const url =
        scope === "global"
          ? new URL(
              "https://news.google.com/rss/headlines/section/topic/WORLD",
            )
          : new URL("https://news.google.com/rss/search");
      url.searchParams.set("hl", "en-CA");
      url.searchParams.set("gl", "CA");
      url.searchParams.set("ceid", "CA:en");
      if (countryName) url.searchParams.set("q", `"${countryName}" when:3d`);
      return url;
    },
    parse: parseGoogleNewsFeed,
  },
];

export function articleMatchesCountry(
  article: Pick<CandidateArticle, "searchableText">,
  terms: string[],
) {
  return textMatchesCountry(article.searchableText, terms);
}

async function fetchProvider(
  provider: NewsProvider,
  scope: "country" | "global",
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
    const parsed = provider.parse(body);
    if (!parsed.length) throw new Error("no parseable articles");
    const articles =
      scope === "country" && provider.filterByCountry
        ? parsed.filter((article) => articleMatchesCountry(article, terms))
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
    }));
}

function json(data: unknown, status = 200) {
  return Response.json(data, {
    status,
    headers: {
      "Cache-Control":
        status === 200
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
  const scope = url.searchParams.get("scope") === "global" ? "global" : "country";
  const requestedCountry = url.searchParams.get("country")?.trim() ?? "";
  if (
    scope === "country" &&
    (!requestedCountry ||
      requestedCountry.length > 80 ||
      !/^[\p{L}\p{M}\d .,'’()&-]+$/u.test(requestedCountry))
  ) {
    return json({ error: "A valid country name is required." }, 400);
  }

  const countryName =
    scope === "country" ? canonicalCountryName(requestedCountry) : null;
  const terms =
    scope === "country" && countryName
      ? countrySearchTerms(requestedCountry)
      : [];
  const results = await Promise.all(
    PROVIDERS.map((provider) =>
      fetchProvider(provider, scope, countryName, terms, fetchImpl),
    ),
  );
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
    countryName: scope === "country" ? requestedCountry : null,
    scope,
    generatedAt: new Date().toISOString(),
    refreshAfterSeconds: CACHE_SECONDS,
    provider: `WorldPulse live index · ${successful.length} feeds`,
    providers: diagnostics,
    degraded: successful.length < PROVIDERS.length,
    articles: mergeArticles(
      successful,
      scope === "global" ? MAX_GLOBAL_ARTICLES : MAX_COUNTRY_ARTICLES,
    ),
  });
}
