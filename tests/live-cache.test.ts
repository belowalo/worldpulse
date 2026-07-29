import { describe, expect, it } from "vitest";

import { mergeCachedPayloads } from "../worker/live-cache";

function article(id: string, publishedAt: string) {
  return {
    id,
    title: `Current headline ${id}`,
    url: `https://publisher.example/${id}`,
    publisherName: "Example News",
    publisherUrl: "https://publisher.example/",
    publishedAt,
  };
}

describe("live response cache merging", () => {
  it("keeps a recent country signal when a fresh provider response is empty", () => {
    const publishedAt = new Date(Date.now() - 60 * 60_000).toISOString();
    const stored = JSON.stringify({
      scope: "map",
      generatedAt: publishedAt,
      countries: [
        {
          countryName: "Canada",
          available: true,
          articles: [article("canada-stored", publishedAt)],
        },
      ],
    });
    const fresh = JSON.stringify({
      scope: "map",
      generatedAt: new Date().toISOString(),
      countries: [
        {
          countryName: "Canada",
          available: false,
          articles: [],
        },
      ],
    });

    const result = JSON.parse(mergeCachedPayloads(fresh, stored)) as {
      countries: Array<{
        countryName: string;
        available: boolean;
        articles: Array<{ id: string }>;
      }>;
    };

    expect(result.countries).toEqual([
      expect.objectContaining({
        countryName: "Canada",
        available: true,
        articles: [expect.objectContaining({ id: "canada-stored" })],
      }),
    ]);
  });

  it("preserves countries omitted by a partial fresh batch", () => {
    const publishedAt = new Date(Date.now() - 60 * 60_000).toISOString();
    const stored = JSON.stringify({
      scope: "map",
      countries: [
        {
          countryName: "Canada",
          available: true,
          articles: [article("canada", publishedAt)],
        },
        {
          countryName: "Mexico",
          available: true,
          articles: [article("mexico", publishedAt)],
        },
      ],
    });
    const fresh = JSON.stringify({
      scope: "map",
      countries: [
        {
          countryName: "Canada",
          available: true,
          articles: [article("canada-new", new Date().toISOString())],
        },
      ],
    });

    const result = JSON.parse(mergeCachedPayloads(fresh, stored)) as {
      countries: Array<{ countryName: string }>;
    };

    expect(result.countries.map((country) => country.countryName)).toEqual([
      "Canada",
      "Mexico",
    ]);
  });
});
