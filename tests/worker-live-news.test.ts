import { afterEach, describe, expect, it, vi } from "vitest";

import {
  articleMatchesCountry,
  handleLiveNews,
  parseGdeltJson,
  parseGoogleNewsFeed,
  parsePublisherRss,
} from "../worker/live-news";

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
