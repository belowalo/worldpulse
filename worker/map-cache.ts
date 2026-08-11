import type { StoredNewsPayload } from "../db/news-cache";
import type { LiveArticle, MapNewsCountryPayload } from "../lib/types";
import { isLikelyEnglishHeadline } from "./live-news";

const ARTICLE_RETENTION_MS = 8 * 24 * 60 * 60_000;
const MAX_ARTICLES_PER_COUNTRY = 32;

interface StoredMapCandidate {
  countryName: string;
  generatedAt: string;
  available?: boolean;
  articles: unknown[];
}

function isStoredMapCandidate(value: unknown): value is StoredMapCandidate {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<StoredMapCandidate>;
  return (
    typeof candidate.countryName === "string" &&
    typeof candidate.generatedAt === "string" &&
    Array.isArray(candidate.articles)
  );
}

function isCurrentLiveArticle(value: unknown): value is LiveArticle {
  if (!value || typeof value !== "object") return false;
  const article = value as Partial<LiveArticle>;
  if (
    typeof article.id !== "string" ||
    typeof article.title !== "string" ||
    typeof article.url !== "string" ||
    typeof article.publisherName !== "string" ||
    typeof article.publisherUrl !== "string" ||
    typeof article.publishedAt !== "string" ||
    !isLikelyEnglishHeadline(article.title)
  ) {
    return false;
  }
  const publishedAt = Date.parse(article.publishedAt);
  return (
    Number.isFinite(publishedAt) &&
    Date.now() - publishedAt <= ARTICLE_RETENTION_MS &&
    publishedAt - Date.now() <= 6 * 60 * 60_000
  );
}

function articleKey(article: LiveArticle) {
  return article.url || article.id || article.title;
}

function mergeCountryArticles(
  current: LiveArticle[],
  historical: LiveArticle[],
) {
  const articles = new Map<string, LiveArticle>();
  for (const article of [...current, ...historical]) {
    const key = articleKey(article);
    if (!articles.has(key)) articles.set(key, article);
  }
  return [...articles.values()]
    .sort(
      (left, right) =>
        Date.parse(right.publishedAt) - Date.parse(left.publishedAt),
    )
    .slice(0, MAX_ARTICLES_PER_COUNTRY);
}

/**
 * Consolidates the newest durable map-cache rows into one last-known-good
 * country directory. Stored rows are ordered newest-first by the database.
 */
export function collectStoredMapCountries(
  storedFeeds: StoredNewsPayload[],
  expectedCountryNames?: ReadonlySet<string>,
) {
  const countries = new Map<string, MapNewsCountryPayload>();
  let latestGeneratedAt = 0;

  for (const stored of storedFeeds) {
    try {
      const payload = JSON.parse(stored.payload) as {
        scope?: string;
        countries?: unknown[];
      };
      if (payload.scope !== "map" || !Array.isArray(payload.countries)) {
        continue;
      }
      latestGeneratedAt = Math.max(latestGeneratedAt, stored.generated_at);

      for (const candidate of payload.countries) {
        if (
          !isStoredMapCandidate(candidate) ||
          (expectedCountryNames &&
            !expectedCountryNames.has(candidate.countryName))
        ) {
          continue;
        }
        const articles = candidate.articles.filter(isCurrentLiveArticle);
        const existing = countries.get(candidate.countryName);
        if (!existing) {
          countries.set(candidate.countryName, {
            countryName: candidate.countryName,
            generatedAt: candidate.generatedAt,
            available: articles.length > 0,
            articles,
          });
          continue;
        }

        const mergedArticles = mergeCountryArticles(
          existing.articles,
          articles,
        );
        countries.set(candidate.countryName, {
          ...existing,
          available: mergedArticles.length > 0,
          articles: mergedArticles,
        });
      }
    } catch {
      // A malformed historical row cannot invalidate the remaining cache.
    }
  }

  return {
    countries: [...countries.values()],
    generatedAt: new Date(latestGeneratedAt || Date.now()).toISOString(),
  };
}

/**
 * Converts durable country-request rows into the same shape as map results so
 * successful deep searches can repair gaps in the complete world snapshot.
 */
export function collectStoredCountryCountries(
  storedFeeds: StoredNewsPayload[],
  expectedCountryNames?: ReadonlySet<string>,
) {
  const countries = new Map<string, MapNewsCountryPayload>();
  let latestGeneratedAt = 0;

  for (const stored of storedFeeds) {
    try {
      const payload = JSON.parse(stored.payload) as {
        scope?: string;
        countryName?: unknown;
        generatedAt?: unknown;
        articles?: unknown[];
      };
      if (
        payload.scope !== "country" ||
        typeof payload.countryName !== "string" ||
        typeof payload.generatedAt !== "string" ||
        !Array.isArray(payload.articles) ||
        (expectedCountryNames &&
          !expectedCountryNames.has(payload.countryName))
      ) {
        continue;
      }
      latestGeneratedAt = Math.max(latestGeneratedAt, stored.generated_at);
      const articles = payload.articles.filter(isCurrentLiveArticle);
      const existing = countries.get(payload.countryName);
      const mergedArticles = existing
        ? mergeCountryArticles(existing.articles, articles)
        : articles;
      countries.set(payload.countryName, {
        countryName: payload.countryName,
        generatedAt: existing?.generatedAt ?? payload.generatedAt,
        available: mergedArticles.length > 0,
        articles: mergedArticles,
      });
    } catch {
      // A malformed historical row cannot invalidate the remaining cache.
    }
  }

  return {
    countries: [...countries.values()],
    generatedAt: new Date(latestGeneratedAt || Date.now()).toISOString(),
  };
}
