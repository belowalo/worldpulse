import { afterEach, describe, expect, it, vi } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  articleMatchesEvent,
  articleMatchesCountry,
  articleHeadlineMatchesCountry,
  handleLiveNews,
  parseBingNewsFeed,
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

  it("requires a country in the headline when filtering broad world feeds", () => {
    const [article] = parsePublisherRss(
      `
        <rss><channel><item>
          <title>Berlin CSD: Latest in string of deadly vehicle attacks</title>
          <description>A comparison briefly mentions an incident in Canada.</description>
          <link>https://publisher.example/berlin-csd</link>
          <guid>berlin-csd</guid>
          <pubDate>Sun, 26 Jul 2026 17:15:00 GMT</pubDate>
        </item></channel></rss>
      `,
      "Example World News",
      "https://publisher.example/",
    );

    expect(articleMatchesCountry(article, ["Canada", "Canadian"])).toBe(true);
    expect(
      articleHeadlineMatchesCountry(article, ["Canada", "Canadian"]),
    ).toBe(false);
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

  it("does not treat a country in aggregator branding as story relevance", () => {
    const xml = `
      <rss><channel><item>
        <title>ABC15 Arizona in Phoenix Latest Headlines - Yahoo News Canada</title>
        <description>ABC15 Arizona in Phoenix Latest Headlines Yahoo News Canada</description>
        <link>https://news.google.com/rss/articles/arizona</link>
        <guid>arizona</guid>
        <pubDate>Sun, 26 Jul 2026 21:06:00 GMT</pubDate>
        <source url="https://ca.news.yahoo.com/">Yahoo News Canada</source>
      </item></channel></rss>
    `;

    const [article] = parseGoogleNewsFeed(xml);
    expect(articleMatchesCountry(article, ["Canada", "Canadian"])).toBe(false);
  });

  it("parses Bing News publisher attribution and restores the article URL", () => {
    const originalUrl = "https://example.com/tuvalu-climate-report";
    const redirectUrl = new URL("https://www.bing.com/news/apiclick.aspx");
    redirectUrl.searchParams.set("url", originalUrl);
    const xml = `
      <rss><channel><item>
        <title>Tuvalu presents a new climate resilience plan</title>
        <description>Current reporting from the Pacific island nation.</description>
        <link>${redirectUrl.toString().replace(/&/g, "&amp;")}</link>
        <guid>tuvalu-climate</guid>
        <pubDate>Fri, 24 Jul 2026 21:00:00 GMT</pubDate>
        <News:Source>Example News on MSN</News:Source>
      </item></channel></rss>
    `;

    const [article] = parseBingNewsFeed(xml);
    expect(article).toMatchObject({
      title: "Tuvalu presents a new climate resilience plan",
      url: originalUrl,
      publisherName: "Example News",
      publisherUrl: "https://example.com/",
    });
  });

  it("derives a real publisher identity from the article domain and rejects invented dates", () => {
    const xml = `
      <rss><channel>
        <item>
          <title>Tuvalu approves a new coastal resilience plan</title>
          <description>Current reporting from Tuvalu.</description>
          <link>https://pacific-desk.example/tuvalu-plan</link>
          <guid>tuvalu-plan</guid>
          <pubDate>Fri, 24 Jul 2026 21:00:00 GMT</pubDate>
        </item>
        <item>
          <title>Story with an unverifiable publication date</title>
          <description>Missing valid publication metadata.</description>
          <link>https://pacific-desk.example/invalid-date</link>
          <guid>invalid-date</guid>
          <pubDate>not-a-date</pubDate>
        </item>
      </channel></rss>
    `;

    const articles = parseBingNewsFeed(xml);
    expect(articles).toHaveLength(1);
    expect(articles[0]).toMatchObject({
      publisherName: "Pacific Desk",
      publishedAt: "2026-07-24T21:00:00.000Z",
    });
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
    const googleItem = `
      <rss><channel><item>
        <title>Canadian parliament approves clean-energy package - Example News</title>
        <description>New measures will apply across Canada.</description>
        <link>https://news.google.com/rss/articles/canada-energy</link>
        <guid>canada-energy</guid>
        <pubDate>Fri, 24 Jul 2026 20:00:00 GMT</pubDate>
        <source url="https://publisher.example/">Example News</source>
      </item></channel></rss>
    `;
    const fetchMock = vi.fn(async (input: URL | RequestInfo) => {
      const url = String(input);
      if (url.startsWith("https://news.google.com/rss/search")) {
        return new Response(googleItem, {
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

  it("uses broad and latest live searches for a country", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const requestedUrls: string[] = [];
    const bingItems = `
      <rss><channel><item>
        <title>Le Sénégal lance un nouveau programme</title>
        <description>Une annonce faite à Dakar.</description>
        <link>https://www.bing.com/news/apiclick.aspx?ref=FexRss&amp;url=https%3A%2F%2Faps.sn%2Fsenegal-local</link>
        <guid>senegal-local</guid>
        <pubDate>Fri, 24 Jul 2026 21:00:00 GMT</pubDate>
        <News:Source>APS</News:Source>
      </item><item>
        <title>Japan launches a lunar research mission</title>
        <description>A spacecraft entered lunar orbit.</description>
        <link>https://science.example/unrelated-space</link>
        <guid>unrelated-space</guid>
        <pubDate>Fri, 24 Jul 2026 20:00:00 GMT</pubDate>
        <News:Source>Science Desk</News:Source>
      </item></channel></rss>
    `;
    const fetchMock = vi.fn(async (input: URL | RequestInfo) => {
      const url = String(input);
      requestedUrls.push(url);
      if (url.startsWith("https://www.bing.com/news/search")) {
        return new Response(bingItems, { status: 200 });
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
      articles: Array<{ publisherName: string; title: string }>;
    };

    expect(response.status).toBe(200);
    expect(countryCodeForName("Senegal")).toBe("SN");
    expect(googleNewsLocaleForCountry("Senegal")).toMatchObject({
      region: "SN",
      language: "fr",
      ceid: "SN:fr",
    });
    expect(googleNewsLocaleForCountry("Canada")).toMatchObject({
      region: "CA",
      language: "en",
      ceid: "CA:en",
    });
    expect(countryCodeForName("Timor-Leste")).toBe("TL");
    expect(googleNewsLocaleForCountry("Timor-Leste")).toMatchObject({
      region: "TL",
      language: "pt",
      ceid: "TL:pt",
    });
    expect(
      requestedUrls.some(
        (url) =>
          url.startsWith("https://www.bing.com/news/search?") &&
          new URL(url).searchParams.get("q") === "Senegal news",
      ),
    ).toBe(true);
    expect(
      requestedUrls.some(
        (url) =>
          url.startsWith("https://www.bing.com/news/search?") &&
          new URL(url).searchParams
            .get("q")
            ?.includes("Senegal latest"),
      ),
    ).toBe(true);
    expect(payload.articles[0].publisherName).toBe("APS");
    expect(
      payload.articles.some((article) => article.title.includes("lunar")),
    ).toBe(false);
  });

  it("does not assign the Rostov drone report to Kazakhstan in any feed", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const unrelatedFeed = `
      <rss><channel><item>
        <title>Ukrainian drones kill two in Russia's Rostov-on-Don, target Taganrog, governor says</title>
        <description>Russian officials reported drone attacks in Rostov-on-Don and Taganrog.</description>
        <link>https://publisher.example/rostov-drone-report</link>
        <guid>rostov-drone-report</guid>
        <pubDate>Sun, 26 Jul 2026 21:00:00 GMT</pubDate>
        <News:Source>Example Wire</News:Source>
      </item><item>
        <title>Kazakhstan joins the global crypto reserve race</title>
        <description>A report concerning Kazakhstan.</description>
        <link>https://publisher.example/old-kazakhstan-report</link>
        <guid>old-kazakhstan-report</guid>
        <pubDate>Tue, 9 Sep 2025 02:50:00 GMT</pubDate>
        <News:Source>Old Example Wire</News:Source>
      </item></channel></rss>
    `;
    const fetchMock = vi.fn(async () =>
      new Response(unrelatedFeed, { status: 200 }),
    );

    const countryResponse = await handleLiveNews(
      new Request(
        "https://worldpulse.test/api/live-news?country=Kazakhstan&iso2=KZ",
      ),
      fetchMock as typeof fetch,
    );
    const countryPayload = (await countryResponse.json()) as {
      articles: unknown[];
    };
    expect(countryResponse.status).toBe(200);
    expect(countryPayload.articles).toEqual([]);

    const mapResponse = await handleLiveNews(
      new Request(
        "https://worldpulse.test/api/live-news?scope=map&countries=Kazakhstan",
      ),
      fetchMock as typeof fetch,
    );
    const mapPayload = (await mapResponse.json()) as {
      countries: Array<{ available: boolean; articles: unknown[] }>;
    };
    expect(mapPayload.countries[0]).toMatchObject({
      available: false,
      articles: [],
    });
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

  it("ships no static headline summary", () => {
    expect(existsSync(resolve("public/map-news-summary.json"))).toBe(false);
  });

  it("loads a batch of current country headlines in one map request", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const requestedUrls: string[] = [];
    const bingFeed = (country: string) => `
      <rss><channel><item>
        <title>${country} current local headline</title>
        <description>Current reporting from ${country}.</description>
        <link>https://local.example/${country.toLowerCase()}</link>
        <guid>local-map-story-${country}</guid>
        <pubDate>Fri, 24 Jul 2026 21:00:00 GMT</pubDate>
        <News:Source>${country} Local Desk</News:Source>
      </item></channel></rss>
    `;
    const fetchMock = vi.fn(async (input: URL | RequestInfo) => {
      const url = String(input);
      requestedUrls.push(url);
      if (!url.startsWith("https://www.bing.com/news/search")) {
        return new Response("Unavailable", { status: 503 });
      }
      const query = new URL(url).searchParams.get("q") ?? "";
      return new Response(
        bingFeed(query.includes("Senegal") ? "Senegal" : "Japan"),
        { status: 200 },
      );
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
        (url) =>
          url.startsWith("https://www.bing.com/news/search?") &&
          new URL(url).searchParams.get("q") === "Senegal news",
      ),
    ).toBe(true);
    expect(
      requestedUrls.some(
        (url) =>
          url.startsWith("https://www.bing.com/news/search?") &&
          new URL(url).searchParams.get("q") === "Japan news",
      ),
    ).toBe(true);
  });

  it("does not substitute an unrelated feed when both country searches fail", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const internationalFeed = `
      <rss><channel><item>
        <title>Canada parliament approves a new national housing package</title>
        <description>Canadian lawmakers passed the measure on Friday.</description>
        <link>https://bbc.example/canada-housing</link>
        <guid>canada-housing</guid>
        <pubDate>Fri, 24 Jul 2026 21:00:00 GMT</pubDate>
      </item></channel></rss>
    `;
    const fetchMock = vi.fn(async (input: URL | RequestInfo) =>
      String(input).includes("feeds.bbci.co.uk/news/world/rss.xml")
        ? new Response(internationalFeed, { status: 200 })
        : new Response("Unavailable", { status: 503 }),
    );

    const response = await handleLiveNews(
      new Request(
        "https://worldpulse.test/api/live-news?scope=map&countries=Canada",
      ),
      fetchMock as typeof fetch,
    );
    const payload = (await response.json()) as {
      countries: Array<{
        available: boolean;
        articles: Array<{ title: string; publisherName: string }>;
      }>;
    };

    expect(payload.countries[0].available).toBe(false);
    expect(payload.countries[0].articles).toEqual([]);
  });

  it("returns multiple current stories from one country search", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const requestedUrls: string[] = [];
    const item = (id: string, title: string, publisher: string) => `
      <item>
        <title>${title}</title>
        <description>Current reporting from Egypt.</description>
        <link>https://${id}.example/story</link>
        <guid>${id}</guid>
        <pubDate>Fri, 24 Jul 2026 21:00:00 GMT</pubDate>
        <News:Source>${publisher}</News:Source>
      </item>
    `;
    const feed = `<rss><channel>
      ${item("egypt-local", "Egypt announces a new local infrastructure project", "Local Desk")}
      ${item("egypt-tunnels", "Egypt-Gaza border tunnel mapping draws scrutiny", "Regional Desk")}
      ${item("egypt-visa", "Egypt launches a digital visa-on-arrival system", "Travel Desk")}
      ${item("egypt-rights", "Egypt urged to release detained Gen Z activists", "Rights Monitor")}
    </channel></rss>`;
    const fetchMock = vi.fn(async (input: URL | RequestInfo) => {
      const url = String(input);
      requestedUrls.push(url);
      return url.startsWith("https://www.bing.com/news/search")
        ? new Response(feed)
        : new Response("Unavailable", { status: 503 });
    });

    const response = await handleLiveNews(
      new Request(
        "https://worldpulse.test/api/live-news?scope=map&countries=Egypt",
      ),
      fetchMock as typeof fetch,
    );
    const payload = (await response.json()) as {
      countries: Array<{
        articles: Array<{ title: string }>;
      }>;
    };
    const titles = payload.countries[0].articles.map(
      (article) => article.title,
    );

    expect(titles).toEqual(
      expect.arrayContaining([
        "Egypt announces a new local infrastructure project",
        "Egypt-Gaza border tunnel mapping draws scrutiny",
        "Egypt launches a digital visa-on-arrival system",
        "Egypt urged to release detained Gen Z activists",
      ]),
    );
    expect(
      requestedUrls.filter((url) =>
        url.startsWith("https://www.bing.com/news/search"),
      ),
    ).toHaveLength(1);
    expect(
      requestedUrls.some((url) =>
        url.startsWith("https://news.google.com/rss/search"),
      ),
    ).toBe(true);
  });

  it("falls back to a latest-country search when the first has no results", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const requestedUrls: string[] = [];
    const bingItem = `
      <rss><channel><item>
        <title>São Tomé current affairs</title>
        <description>Current reporting from São Tomé and Principe.</description>
        <link>https://regional.example/sao-tome-story</link>
        <guid>sao-tome-story</guid>
        <pubDate>Fri, 24 Jul 2026 21:00:00 GMT</pubDate>
        <News:Source>Regional Desk</News:Source>
      </item></channel></rss>
    `;
    const fetchMock = vi.fn(async (input: URL | RequestInfo) => {
      const url = String(input);
      requestedUrls.push(url);
      const query = url.startsWith("https://www.bing.com/news/search")
        ? new URL(url).searchParams.get("q") ?? ""
        : "";
      return query.includes("latest")
        ? new Response(bingItem, { status: 200 })
        : new Response("Unavailable", { status: 503 });
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
    expect(
      requestedUrls.filter((url) =>
        url.startsWith("https://www.bing.com/news/search"),
      ),
    ).toHaveLength(3);
    expect(
      requestedUrls.some((url) =>
        new URL(url).searchParams
          .get("q")
          ?.includes("latest"),
      ),
    ).toBe(true);
  });

  it("uses a country-specific GDELT fallback when news search has no verified match", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const requestedUrls: string[] = [];
    const fetchMock = vi.fn(async (input: URL | RequestInfo) => {
      const url = String(input);
      requestedUrls.push(url);
      if (url.startsWith("https://api.gdeltproject.org/api/v2/doc/doc")) {
        return Response.json({
          articles: [
            {
              url: "https://tuvalu.example/current-parliament-report",
              title: "Tuvalu parliament approves a current coastal plan",
              domain: "tuvalu.example",
              seendate: "20260724T210000Z",
              language: "English",
            },
          ],
        });
      }
      return new Response("<rss><channel></channel></rss>", { status: 200 });
    });

    const response = await handleLiveNews(
      new Request(
        "https://worldpulse.test/api/live-news?scope=map&countries=Tuvalu",
      ),
      fetchMock as typeof fetch,
    );
    const payload = (await response.json()) as {
      countries: Array<{
        available: boolean;
        articles: Array<{ title: string; publisherName: string }>;
      }>;
    };

    expect(payload.countries[0]).toMatchObject({
      available: true,
      articles: [
        expect.objectContaining({
          title: "Tuvalu parliament approves a current coastal plan",
          publisherName: "tuvalu.example",
        }),
      ],
    });
    expect(
      requestedUrls.some((url) =>
        url.startsWith("https://api.gdeltproject.org/api/v2/doc/doc"),
      ),
    ).toBe(true);
  });

  it("runs focused local and international searches for one event", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const requestedUrls: string[] = [];
    const item = (
      id: string,
      title: string,
      publisher: string,
      publisherDomain: string,
    ) => `
      <item>
        <title>${title}</title>
        <description>${
          id === "unrelated"
            ? "A spacecraft entered lunar orbit."
            : "Canada and Mexico reached a cross-border trade agreement."
        }</description>
        <link>https://${publisherDomain}/${id}</link>
        <guid>${id}</guid>
        <pubDate>Fri, 24 Jul 2026 21:00:00 GMT</pubDate>
        <News:Source>${publisher}</News:Source>
      </item>
    `;
    const eventFeed = `<rss><channel>
      ${item("one", "Canada and Mexico agree cross-border trade accord", "Reuters", "reuters.com")}
      ${item("two", "Mexico backs new Canada cross-border trade agreement", "BBC News", "bbc.com")}
      ${item("three", "Canada-Mexico trade accord receives approval", "Associated Press", "apnews.com")}
      ${item("four", "Leaders approve Canada Mexico cross-border trade deal", "CBC News", "cbc.ca")}
      ${item("five", "New accord expands trade between Mexico and Canada", "Fox News", "foxnews.com")}
      ${item("six", "Canada Mexico trade pact enters force", "Regional Desk", "regional.example")}
      ${item("unrelated", "Japan launches a new lunar research mission", "Science Desk", "science.example")}
    </channel></rss>`;
    const targetedAttempts = new Map<string, number>();
    const fetchMock = vi.fn(async (input: URL | RequestInfo) => {
      const url = String(input);
      requestedUrls.push(url);
      if (!url.startsWith("https://www.bing.com/news/search")) {
        return new Response("Unavailable", { status: 503 });
      }
      const query = new URL(url).searchParams.get("q") ?? "";
      if (query.includes("site:")) {
        const attempt = (targetedAttempts.get(query) ?? 0) + 1;
        targetedAttempts.set(query, attempt);
        if (attempt === 1) {
          return new Response("Unavailable", { status: 503 });
        }
      }
      return new Response(eventFeed, { status: 200 });
    });

    const response = await handleLiveNews(
      new Request(
        "https://worldpulse.test/api/live-news?scope=event&headline=Canada%20and%20Mexico%20agree%20a%20cross-border%20trade%20accord&country=Canada&iso2=CA",
      ),
      fetchMock as typeof fetch,
    );
    const payload = (await response.json()) as {
      scope: string;
      provider: string;
      articles: Array<{ publisherName: string; title: string }>;
    };

    expect(response.status).toBe(200);
    expect(payload.scope).toBe("event");
    expect(payload.provider).toContain("Expanded topic search");
    expect(payload.articles).toHaveLength(6);
    expect(payload.articles.map((article) => article.publisherName)).toEqual(
      expect.arrayContaining(["Associated Press", "Reuters", "Fox News"]),
    );
    expect(
      payload.articles.some((article) => article.title.includes("lunar")),
    ).toBe(false);
    expect(
      requestedUrls.filter((url) =>
        url.startsWith("https://www.bing.com/news/search"),
      ),
    ).toHaveLength(8);
    expect([...targetedAttempts.values()]).toEqual([2, 2, 2]);
    expect(
      requestedUrls.some((url) =>
        decodeURIComponent(url).includes("site:cnn.com"),
      ),
    ).toBe(true);
    expect(
      requestedUrls.some((url) =>
        decodeURIComponent(url).includes("site:foxnews.com"),
      ),
    ).toBe(true);
    expect(
      requestedUrls.some((url) =>
        new URL(url).searchParams
          .get("q")
          ?.includes('"Canada and Mexico agree a cross-border trade accord"'),
      ),
    ).toBe(true);
    expect(
      articleMatchesEvent(
        {
          searchableText:
            "Mexico backs a new Canada cross-border trade agreement",
        },
        "Canada and Mexico agree a cross-border trade accord",
      ),
    ).toBe(true);
    expect(
      articleMatchesEvent(
        {
          searchableText:
            "Suspect in deadly Berlin Pride attack killed in confrontation with police, officials say",
        },
        "Suspect dies after Seattle Space Needle shooting leaves victim injured",
      ),
    ).toBe(false);
    expect(
      articleMatchesEvent(
        {
          searchableText:
            "Trump vows wildfire smoke tariffs on Canada as fires spread",
        },
        "Canada reportedly scraps joint bridge celebration with US after Trump renews tariff threat",
      ),
    ).toBe(false);
    expect(
      articleMatchesEvent(
        {
          searchableText:
            "Trump threatens Iran over frozen assets as US strikes continue",
        },
        "Canada reportedly scraps joint bridge celebration with US after Trump renews tariff threat",
      ),
    ).toBe(false);
  });

  it("finds rewritten coverage of a heatwave instead of requiring the same headline", async () => {
    const requestedQueries: string[] = [];
    const item = (
      id: string,
      title: string,
      description: string,
      publisher: string,
    ) => `
      <item>
        <title>${title}</title>
        <description>${description}</description>
        <link>https://${id}.example/story</link>
        <guid>${id}</guid>
        <pubDate>Sat, 25 Jul 2026 21:00:00 GMT</pubDate>
        <News:Source>${publisher}</News:Source>
      </item>
    `;
    const exactFeed = `<rss><channel>${item(
      "guardian",
      "‘Extraordinarily hot’: US heatwave stretches on with millions still under warnings",
      "Millions in the United States remain under heat warnings.",
      "The Guardian",
    )}</channel></rss>`;
    const relatedFeed = `<rss><channel>
      ${item("abc", "Sizzling US temperatures put more than 100 million people under heat alerts", "Dangerous heat warnings cover much of the United States.", "ABC News")}
      ${item("ap", "Heat dome expands across the central United States, creating dangerous conditions for millions", "The US heat wave is putting millions at risk.", "AP News")}
      ${item("nbc", "Dangerous heat grips the US as millions face warnings", "A heat dome is bringing extreme temperatures.", "NBC News")}
      ${item("fox", "Heat alerts spread as scorching temperatures cover the United States", "Millions face an extended heat warning.", "FOX Weather")}
      ${item("usatoday", "Extreme heat forecast across central US", "Millions of Americans are under weather warnings.", "USA Today")}
      ${item("unrelated", "Japan launches a lunar research mission", "A spacecraft entered orbit.", "Science Desk")}
    </channel></rss>`;
    const fetchMock = vi.fn(async (input: URL | RequestInfo) => {
      const url = String(input);
      if (!url.startsWith("https://www.bing.com/news/search")) {
        return new Response("Unavailable", { status: 503 });
      }
      const query = new URL(url).searchParams.get("q") ?? "";
      requestedQueries.push(query);
      return new Response(
        query.startsWith('"Extraordinarily hot') ? exactFeed : relatedFeed,
        { status: 200 },
      );
    });

    const response = await handleLiveNews(
      new Request(
        "https://worldpulse.test/api/live-news?scope=event&country=United%20States&iso2=US&headline=" +
          encodeURIComponent(
            "‘Extraordinarily hot’: US heatwave stretches on with millions still under warnings",
          ),
      ),
      fetchMock as typeof fetch,
    );
    const result = (await response.json()) as {
      articles: Array<{ publisherName: string; title: string }>;
    };

    expect(response.status).toBe(200);
    expect(new Set(result.articles.map((article) => article.publisherName)).size)
      .toBeGreaterThanOrEqual(5);
    expect(
      result.articles.some((article) => article.publisherName === "AP News"),
    ).toBe(true);
    expect(
      result.articles.some((article) => article.title.includes("lunar")),
    ).toBe(false);
    expect(
      requestedQueries.some(
        (query) =>
          query.includes('"United States"') &&
          query.includes("heat") &&
          !query.includes('"heat"'),
      ),
    ).toBe(true);
    expect(
      articleMatchesEvent(
        {
          searchableText:
            "Heat dome expands across the central United States, creating dangerous conditions for millions",
        },
        "‘Extraordinarily hot’: US heatwave stretches on with millions still under warnings",
      ),
    ).toBe(true);
    expect(
      articleMatchesEvent(
        {
          searchableText:
            "AI chatbots take heat over left-wing bias and can no longer be considered neutral in America",
        },
        "‘Extraordinarily hot’: US heatwave stretches on with millions still under warnings",
      ),
    ).toBe(false);
    expect(
      articleMatchesEvent(
        {
          searchableText:
            "Giant hot dog sculpture returns to New York Times Square for America's anniversary",
        },
        "‘Extraordinarily hot’: US heatwave stretches on with millions still under warnings",
      ),
    ).toBe(false);
    expect(
      articleMatchesEvent(
        {
          searchableText:
            "Trump orders Smithsonian to post warnings about inaccurate US history. The administration accused the museum of anti-American bias.",
        },
        "‘Extraordinarily hot’: US heatwave stretches on with millions still under warnings",
      ),
    ).toBe(false);
    expect(
      articleMatchesEvent(
        {
          searchableText:
            "The grid just screamed a warning to Congress and you are paying for it. Energy investments face federal delays.",
        },
        "‘Extraordinarily hot’: US heatwave stretches on with millions still under warnings",
      ),
    ).toBe(false);
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
