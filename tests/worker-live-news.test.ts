import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  articleMatchesEvent,
  articleMatchesCountry,
  articleHeadlineMatchesCountry,
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
      </item><item>
        <title>Japan launches a lunar research mission - Science Desk</title>
        <description>A spacecraft entered lunar orbit.</description>
        <link>https://news.google.com/rss/articles/unrelated-space</link>
        <guid>unrelated-space</guid>
        <pubDate>Fri, 24 Jul 2026 20:00:00 GMT</pubDate>
        <source url="https://science.example/">Science Desk</source>
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
    expect(
      payload.articles.some((article) => article.title.includes("lunar")),
    ).toBe(false);
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

  it("mixes local, current, latest, and rights reporting in country preloads", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const requestedUrls: string[] = [];
    const feed = (id: string, title: string, publisher: string) => `
      <rss><channel><item>
        <title>${title} - ${publisher}</title>
        <description>Current reporting from Egypt.</description>
        <link>https://news.google.com/rss/articles/${id}</link>
        <guid>${id}</guid>
        <pubDate>Fri, 24 Jul 2026 21:00:00 GMT</pubDate>
        <source url="https://${id}.example/">${publisher}</source>
      </item></channel></rss>
    `;
    const fetchMock = vi.fn(async (input: URL | RequestInfo) => {
      const url = String(input);
      requestedUrls.push(url);
      const parsed = new URL(url);
      const query = parsed.searchParams.get("q") ?? "";
      if (query.includes("human rights")) {
        return new Response(
          feed(
            "egypt-rights",
            "Egypt urged to release detained Gen Z activists",
            "Rights Monitor",
          ),
        );
      }
      if (query.includes("latest")) {
        return new Response(
          feed(
            "egypt-visa",
            "Egypt launches a digital visa-on-arrival system",
            "Travel Desk",
          ),
        );
      }
      if (query.includes("news")) {
        return new Response(
          feed(
            "egypt-tunnels",
            "Egypt-Gaza border tunnel mapping draws scrutiny",
            "Regional Desk",
          ),
        );
      }
      return new Response(
        feed(
          "egypt-local",
          "Egypt announces a new local infrastructure project",
          "Local Desk",
        ),
      );
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
    expect(requestedUrls).toHaveLength(4);
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
        <title>${title} - ${publisher}</title>
        <description>${
          id === "unrelated"
            ? "A spacecraft entered lunar orbit."
            : "Canada and Mexico reached a cross-border trade agreement."
        }</description>
        <link>https://news.google.com/rss/articles/${id}</link>
        <guid>${id}</guid>
        <pubDate>Fri, 24 Jul 2026 21:00:00 GMT</pubDate>
        <source url="https://${publisherDomain}/">${publisher}</source>
      </item>
    `;
    const eventFeed = `<rss><channel>
      ${item("one", "Canada and Mexico agree cross-border trade accord", "Reuters", "reuters.com")}
      ${item("two", "Mexico backs new Canada cross-border trade agreement", "BBC News", "bbc.com")}
      ${item("three", "Canada-Mexico trade accord receives approval", "Associated Press", "apnews.com")}
      ${item("four", "Leaders approve Canada Mexico cross-border trade deal", "CBC News", "cbc.ca")}
      ${item("five", "New accord expands trade between Mexico and Canada", "Local Desk", "local.example")}
      ${item("six", "Canada Mexico trade pact enters force", "Regional Desk", "regional.example")}
      ${item("unrelated", "Japan launches a new lunar research mission", "Science Desk", "science.example")}
    </channel></rss>`;
    const fetchMock = vi.fn(async (input: URL | RequestInfo) => {
      requestedUrls.push(String(input));
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
    expect(
      payload.articles.some((article) => article.title.includes("lunar")),
    ).toBe(false);
    expect(requestedUrls).toHaveLength(4);
    expect(requestedUrls.some((url) => url.includes("gl=CA"))).toBe(true);
    expect(requestedUrls.some((url) => url.includes("gl=US"))).toBe(true);
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
        <title>${title} - ${publisher}</title>
        <description>${description}</description>
        <link>https://news.google.com/rss/articles/${id}</link>
        <guid>${id}</guid>
        <pubDate>Sat, 25 Jul 2026 21:00:00 GMT</pubDate>
        <source url="https://${id}.example/">${publisher}</source>
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
      const query = new URL(String(input)).searchParams.get("q") ?? "";
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
