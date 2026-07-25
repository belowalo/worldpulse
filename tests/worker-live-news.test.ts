import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  articleMatchesCountry,
  handleLiveNews,
  parseGdeltJson,
  parseGoogleNewsFeed,
  parsePublisherRss,
} from "../worker/live-news";
import {
  countryCodeForName,
  googleNewsLocaleForCountry,
} from "../lib/country-locale";
import { countrySearchTerms } from "../lib/country-terms";

const rssItem = `
  <rss><channel><item>
    <title><![CDATA[Canadian parliament approves clean-energy package]]></title>
    <description>New measures will apply across Canada.</description>
    <link>https://publisher.example/canada-energy?utm_source=rss</link>
    <guid>canada-energy</guid>
    <pubDate>Fri, 24 Jul 2026 20:00:00 GMT</pubDate>
  </item></channel></rss>
`;

afterEach(() => {
  vi.restoreAllMocks();
});

describe("worker live-news providers", () => {
  it("parses publisher RSS and retains text for country matching", () => {
    const articles = parsePublisherRss(
      rssItem,
      "Example News",
      "https://publisher.example/",
    );

    expect(articles).toHaveLength(1);
    expect(articles[0].publisherName).toBe("Example News");
    expect(
      articleMatchesCountry(articles[0], ["Canada", "Canadian"]),
    ).toBe(true);
    expect(articleMatchesCountry(articles[0], ["Chad"])).toBe(false);
  });

  it("matches Egypt reporting written in Arabic", () => {
    expect(
      articleMatchesCountry(
        { searchableText: "أهم الأخبار المحلية في مصر اليوم" },
        countrySearchTerms("Egypt"),
      ),
    ).toBe(true);
  });

  it("parses Google RSS attribution without keeping the title suffix", () => {
    const xml = `
      <rss><channel><item>
        <title>Election result announced - Example Wire</title>
        <description>Current reporting</description>
        <link>https://news.google.com/rss/articles/abc</link>
        <guid>abc</guid>
        <pubDate>Fri, 24 Jul 2026 21:00:00 GMT</pubDate>
        <source url="https://wire.example/">Example Wire</source>
      </item></channel></rss>
    `;

    const [article] = parseGoogleNewsFeed(xml);
    expect(article.title).toBe("Election result announced");
    expect(article.publisherName).toBe("Example Wire");
    expect(article.publisherUrl).toBe("https://wire.example/");
  });

  it("parses GDELT results and ignores non-English entries", () => {
    const articles = parseGdeltJson(
      JSON.stringify({
        articles: [
          {
            url: "https://example.com/story",
            title: "Current report",
            domain: "example.com",
            seendate: "20260724T210000Z",
            language: "English",
          },
          {
            url: "https://example.fr/histoire",
            title: "Actualités",
            domain: "example.fr",
            seendate: "20260724T210000Z",
            language: "French",
          },
        ],
      }),
    );

    expect(articles).toHaveLength(1);
    expect(articles[0].publishedAt).toBe("2026-07-24T21:00:00.000Z");
  });

  it("returns live results when one provider succeeds and the rest fail", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const fetchMock = vi.fn(async (input: URL | RequestInfo) => {
      const url = String(input);
      if (url.includes("theguardian.com/world/rss")) {
        return new Response(rssItem, {
          status: 200,
          headers: { "Content-Type": "application/rss+xml" },
        });
      }
      return new Response("Unavailable", { status: 503 });
    });

    const response = await handleLiveNews(
      new Request("https://worldpulse.test/api/live-news?country=Canada"),
      fetchMock as typeof fetch,
    );
    const payload = (await response.json()) as {
      articles: Array<{ title: string }>;
      degraded: boolean;
      provider: string;
    };

    expect(response.status).toBe(200);
    expect(payload.articles).toHaveLength(1);
    expect(payload.degraded).toBe(true);
    expect(payload.provider).toContain("1 feeds");
  });

  it("uses a country's local Google News edition and local-language search", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const requestedUrls: string[] = [];
    const googleItem = `
      <rss><channel><item>
        <title>Le Sénégal lance un nouveau programme - APS</title>
        <description>Une annonce faite à Dakar.</description>
        <link>https://news.google.com/rss/articles/senegal-local</link>
        <guid>senegal-local</guid>
        <pubDate>Fri, 24 Jul 2026 21:00:00 GMT</pubDate>
        <source url="https://aps.sn/">APS</source>
      </item></channel></rss>
    `;
    const fetchMock = vi.fn(async (input: URL | RequestInfo) => {
      const url = String(input);
      requestedUrls.push(url);
      if (url.startsWith("https://news.google.com/rss")) {
        return new Response(googleItem, { status: 200 });
      }
      return new Response("Unavailable", { status: 503 });
    });

    const response = await handleLiveNews(
      new Request(
        "https://worldpulse.test/api/live-news?country=Senegal&iso2=SN",
      ),
      fetchMock as typeof fetch,
    );
    const payload = (await response.json()) as {
      articles: Array<{ publisherName: string }>;
    };

    expect(response.status).toBe(200);
    expect(countryCodeForName("Senegal")).toBe("SN");
    expect(googleNewsLocaleForCountry("Senegal")).toMatchObject({
      region: "SN",
      language: "fr",
      ceid: "SN:fr",
    });
    expect(
      requestedUrls.some(
        (url) =>
          url.startsWith("https://news.google.com/rss?") &&
          url.includes("gl=SN") &&
          url.includes("ceid=SN%3Afr"),
      ),
    ).toBe(true);
    expect(
      requestedUrls.some(
        (url) =>
          url.includes("/rss/search?") &&
          url.includes("gl=SN") &&
          decodeURIComponent(url).includes('"Dakar"'),
      ),
    ).toBe(true);
    expect(
      requestedUrls.some(
        (url) => url.includes("/rss/search?") && url.includes("gl=US"),
      ),
    ).toBe(true);
    expect(payload.articles[0].publisherName).toBe("APS");
  });

  it("resolves a local-news region for every country on the map", () => {
    const geojson = JSON.parse(
      readFileSync(resolve("public/countries.geojson"), "utf8"),
    ) as { features: Array<{ properties: { name: string } }> };
    const unresolved = geojson.features
      .map((feature) => feature.properties.name)
      .filter((name) => !countryCodeForName(name));

    expect(unresolved).toEqual([]);
  });

  it("ships a preloaded headline index for every mapped country", () => {
    const geojson = JSON.parse(
      readFileSync(resolve("public/countries.geojson"), "utf8"),
    ) as { features: Array<{ properties: { name: string } }> };
    const snapshot = JSON.parse(
      readFileSync(resolve("public/map-news-seed.json"), "utf8"),
    ) as {
      countries: Array<{
        countryName: string;
        available: boolean;
        articles: unknown[];
      }>;
    };
    const mapCountries = geojson.features.map(
      (feature) => feature.properties.name,
    );
    const snapshotCountries = snapshot.countries.map(
      (country) => country.countryName,
    );

    expect(snapshotCountries).toEqual(mapCountries);
    expect(new Set(snapshotCountries).size).toBe(mapCountries.length);
    expect(
      snapshot.countries.every(
        (country) => country.available && country.articles.length > 0,
      ),
    ).toBe(true);
  });

  it("preloads a batch of country headlines in one map request", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const requestedUrls: string[] = [];
    const googleItem = `
      <rss><channel><item>
        <title>Current local headline - Local Desk</title>
        <description>Current local reporting.</description>
        <link>https://news.google.com/rss/articles/local-map-story</link>
        <guid>local-map-story</guid>
        <pubDate>Fri, 24 Jul 2026 21:00:00 GMT</pubDate>
        <source url="https://local.example/">Local Desk</source>
      </item></channel></rss>
    `;
    const fetchMock = vi.fn(async (input: URL | RequestInfo) => {
      requestedUrls.push(String(input));
      return new Response(googleItem, { status: 200 });
    });

    const response = await handleLiveNews(
      new Request(
        "https://worldpulse.test/api/live-news?scope=map&countries=Senegal%7CJapan",
      ),
      fetchMock as typeof fetch,
    );
    const payload = (await response.json()) as {
      scope: string;
      countries: Array<{
        countryName: string;
        available: boolean;
        articles: unknown[];
      }>;
    };

    expect(response.status).toBe(200);
    expect(payload.scope).toBe("map");
    expect(payload.countries).toHaveLength(2);
    expect(payload.countries.every((country) => country.available)).toBe(true);
    expect(payload.countries.every((country) => country.articles.length === 1)).toBe(
      true,
    );
    expect(
      requestedUrls.some(
        (url) => url.includes("gl=SN") && url.includes("ceid=SN%3Afr"),
      ),
    ).toBe(true);
    expect(
      requestedUrls.some(
        (url) => url.includes("gl=JP") && url.includes("ceid=JP%3Aja"),
      ),
    ).toBe(true);
  });

  it("falls back to international search when a local country edition fails", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const requestedUrls: string[] = [];
    const googleItem = `
      <rss><channel><item>
        <title>São Tomé current affairs - Regional Desk</title>
        <description>Current reporting from São Tomé and Principe.</description>
        <link>https://news.google.com/rss/articles/sao-tome-story</link>
        <guid>sao-tome-story</guid>
        <pubDate>Fri, 24 Jul 2026 21:00:00 GMT</pubDate>
        <source url="https://regional.example/">Regional Desk</source>
      </item></channel></rss>
    `;
    const fetchMock = vi.fn(async (input: URL | RequestInfo) => {
      const url = String(input);
      requestedUrls.push(url);
      return url.includes("gl=ST")
        ? new Response("Unavailable", { status: 503 })
        : new Response(googleItem, { status: 200 });
    });

    const response = await handleLiveNews(
      new Request(
        "https://worldpulse.test/api/live-news?scope=map&countries=S%C3%A3o%20Tom%C3%A9%20and%20Principe",
      ),
      fetchMock as typeof fetch,
    );
    const payload = (await response.json()) as {
      countries: Array<{ available: boolean; articles: unknown[] }>;
    };

    expect(payload.countries[0]).toMatchObject({
      available: true,
      articles: [expect.any(Object)],
    });
    expect(requestedUrls.some((url) => url.includes("gl=ST"))).toBe(true);
    expect(requestedUrls.some((url) => url.includes("gl=US"))).toBe(true);
  });

  it("returns an explicit outage only when every provider fails", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const fetchMock = vi.fn(async () => new Response("Unavailable", { status: 503 }));

    const response = await handleLiveNews(
      new Request("https://worldpulse.test/api/live-news?country=Canada"),
      fetchMock as typeof fetch,
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining("All live news providers"),
    });
  });
});
