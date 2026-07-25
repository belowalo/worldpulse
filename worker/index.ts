/** Cloudflare Worker entry point for the vinext-starter template. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";

interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

interface FeedArticle {
  id: string;
  title: string;
  url: string;
  publisherName: string;
  publisherUrl: string;
  publishedAt: string;
}

const COUNTRY_QUERY_ALIASES: Record<string, string> = {
  "Aland": "Åland Islands",
  "Antigua and Barb.": "Antigua and Barbuda",
  "Bosnia and Herz.": "Bosnia and Herzegovina",
  "Br. Indian Ocean Ter.": "British Indian Ocean Territory",
  "Central African Rep.": "Central African Republic",
  "Czech Rep.": "Czech Republic",
  "Dem. Rep. Congo": "Democratic Republic of the Congo",
  "Dem. Rep. Korea": "North Korea",
  "Dominican Rep.": "Dominican Republic",
  "Eq. Guinea": "Equatorial Guinea",
  "Faeroe Is.": "Faroe Islands",
  "Falkland Is.": "Falkland Islands",
  "Fr. Polynesia": "French Polynesia",
  "Korea": "South Korea",
  "N. Cyprus": "Northern Cyprus",
  "N. Mariana Is.": "Northern Mariana Islands",
  "S. Sudan": "South Sudan",
  "Solomon Is.": "Solomon Islands",
  "St. Vin. and Gren.": "Saint Vincent and the Grenadines",
  "Swaziland": "Eswatini",
  "Turks and Caicos Is.": "Turks and Caicos Islands",
  "U.S. Virgin Is.": "U.S. Virgin Islands",
  "W. Sahara": "Western Sahara",
};

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
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .trim();
}

function tagValue(block: string, tag: string) {
  const match = block.match(
    new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "i"),
  );
  return match ? decodeXml(match[1]) : "";
}

function safeIsoDate(value: string) {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp)
    ? new Date(timestamp).toISOString()
    : new Date().toISOString();
}

function stripPublisherSuffix(title: string, publisher: string) {
  if (!publisher) return title;
  const suffix = ` - ${publisher}`;
  return title.endsWith(suffix) ? title.slice(0, -suffix.length).trim() : title;
}

function parseGoogleNewsFeed(xml: string): FeedArticle[] {
  const items = xml.match(/<item>[\s\S]*?<\/item>/gi) ?? [];
  const seen = new Set<string>();
  const articles: FeedArticle[] = [];

  for (const item of items) {
    const publisherName = tagValue(item, "source") || "Independent publisher";
    const sourceTag = item.match(/<source[^>]*\surl="([^"]+)"[^>]*>/i);
    const publisherUrl = sourceTag ? decodeXml(sourceTag[1]) : "";
    const url = tagValue(item, "link");
    const guid = tagValue(item, "guid") || url;
    const rawTitle = tagValue(item, "title");
    const title = stripPublisherSuffix(rawTitle, publisherName);
    if (!title || !url || seen.has(guid)) continue;
    seen.add(guid);
    articles.push({
      id: guid.slice(0, 180),
      title,
      url,
      publisherName,
      publisherUrl,
      publishedAt: safeIsoDate(tagValue(item, "pubDate")),
    });
    if (articles.length >= 48) break;
  }
  return articles;
}

function json(data: unknown, status = 200) {
  return Response.json(data, {
    status,
    headers: {
      "Cache-Control":
        status === 200
          ? "public, max-age=300, s-maxage=600, stale-while-revalidate=86400"
          : "no-store",
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}

async function handleLiveNews(request: Request) {
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
    scope === "country"
      ? COUNTRY_QUERY_ALIASES[requestedCountry] ?? requestedCountry
      : null;
  const feedUrl =
    scope === "global"
      ? new URL("https://news.google.com/rss/headlines/section/topic/WORLD")
      : new URL("https://news.google.com/rss/search");
  feedUrl.searchParams.set("hl", "en-CA");
  feedUrl.searchParams.set("gl", "CA");
  feedUrl.searchParams.set("ceid", "CA:en");
  if (countryName) feedUrl.searchParams.set("q", `"${countryName}" when:3d`);

  try {
    const response = await fetch(feedUrl, {
      headers: {
        Accept: "application/rss+xml, application/xml;q=0.9, text/xml;q=0.8",
        "User-Agent": "WorldPulse/1.0 (live news metadata reader)",
      },
      signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok) {
      return json(
        { error: "The live news index is temporarily unavailable." },
        502,
      );
    }
    const xml = await response.text();
    const generatedAt =
      safeIsoDate(tagValue(xml.match(/<channel>[\s\S]*?<\/channel>/i)?.[0] ?? xml, "lastBuildDate"));
    return json({
      countryName: scope === "country" ? requestedCountry : null,
      scope,
      generatedAt,
      refreshAfterSeconds: 600,
      provider: "Google News RSS",
      articles: parseGoogleNewsFeed(xml),
    });
  } catch {
    return json(
      { error: "Live news could not be refreshed. Please try again shortly." },
      504,
    );
  }
}

// Image security config. SVG sources with .svg extension auto-skip the
// optimization endpoint on the client side (served directly, no proxy).
// To route SVGs through the optimizer (with security headers), set
// dangerouslyAllowSVG: true in next.config.js and uncomment below:
// const imageConfig: ImageConfig = { dangerouslyAllowSVG: true };

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/live-news") {
      return handleLiveNews(request);
    }

    if (url.pathname === "/_vinext/image") {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      return handleImageOptimization(request, {
        fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
        transformImage: async (body, { width, format, quality }) => {
          const result = await env.IMAGES.input(body).transform(width > 0 ? { width } : {}).output({ format, quality });
          return result.response();
        },
      }, allowedWidths);
    }

    return handler.fetch(request, env, ctx);
  },
};

export default worker;
