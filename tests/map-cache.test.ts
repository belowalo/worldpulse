import { describe, expect, it, vi } from "vitest";

import type { StoredNewsPayload } from "@/db/news-cache";
import { collectStoredMapCountries } from "@/worker/map-cache";

function row(
  generatedAt: number,
  countries: Array<{
    countryName: string;
    generatedAt: string;
    articles: Array<Record<string, unknown>>;
  }>,
): StoredNewsPayload {
  return {
    generated_at: generatedAt,
    payload: JSON.stringify({ scope: "map", countries }),
  };
}

function article(id: string, title: string, publishedAt: string) {
  return {
    id,
    title,
    url: `https://publisher.example/${id}`,
    publisherName: "Example News",
    publisherUrl: "https://publisher.example",
    publishedAt,
  };
}

describe("durable map cache consolidation", () => {
  it("preserves older valid reporting when a newer provider scan is empty", () => {
    vi.setSystemTime(new Date("2026-08-02T23:00:00.000Z"));
    const result = collectStoredMapCountries([
      row(Date.parse("2026-08-02T22:59:00.000Z"), [
        {
          countryName: "Canada",
          generatedAt: "2026-08-02T22:59:00.000Z",
          articles: [],
        },
      ]),
      row(Date.parse("2026-08-02T21:00:00.000Z"), [
        {
          countryName: "Canada",
          generatedAt: "2026-08-02T21:00:00.000Z",
          articles: [
            article(
              "canada",
              "Canada announces a new national housing plan",
              "2026-08-02T20:00:00.000Z",
            ),
          ],
        },
      ]),
    ]);

    expect(result.countries).toEqual([
      expect.objectContaining({
        countryName: "Canada",
        generatedAt: "2026-08-02T22:59:00.000Z",
        available: true,
        articles: [expect.objectContaining({ id: "canada" })],
      }),
    ]);
  });

  it("merges reporting across overlapping cache batches and ignores extras", () => {
    vi.setSystemTime(new Date("2026-08-02T23:00:00.000Z"));
    const result = collectStoredMapCountries(
      [
        row(Date.parse("2026-08-02T22:59:00.000Z"), [
          {
            countryName: "Spain",
            generatedAt: "2026-08-02T22:59:00.000Z",
            articles: [
              article(
                "spain-new",
                "Spain announces a new national transport plan",
                "2026-08-02T22:00:00.000Z",
              ),
            ],
          },
          {
            countryName: "Tuvalu",
            generatedAt: "2026-08-02T22:59:00.000Z",
            articles: [],
          },
        ]),
        row(Date.parse("2026-08-02T21:00:00.000Z"), [
          {
            countryName: "Spain",
            generatedAt: "2026-08-02T21:00:00.000Z",
            articles: [
              article(
                "spain-old",
                "Spanish lawmakers approve an economic package",
                "2026-08-02T20:00:00.000Z",
              ),
            ],
          },
        ]),
      ],
      new Set(["Spain"]),
    );

    expect(result.countries).toHaveLength(1);
    expect(result.countries[0].countryName).toBe("Spain");
    expect(result.countries[0].articles.map(({ id }) => id)).toEqual([
      "spain-new",
      "spain-old",
    ]);
  });
});
