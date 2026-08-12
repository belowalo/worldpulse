import { isProviderErrorArticleTitle } from "../lib/news-quality";
import {
  countrySearchTerms,
  textMatchesCountry,
} from "../lib/country-terms";

const ARTICLE_RETENTION_MS = 8 * 24 * 60 * 60_000;

type JsonRecord = Record<string, unknown>;

function isJsonRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function cachedArticleKey(article: JsonRecord) {
  for (const field of ["url", "id", "title"]) {
    const value = article[field];
    if (typeof value === "string" && value) return `${field}:${value}`;
  }
  return JSON.stringify(article);
}

function mergeCachedArticles(
  freshArticles: unknown,
  storedArticles: unknown,
  limit: number,
  countryName?: string,
) {
  const merged = new Map<string, JsonRecord>();
  for (const candidate of [
    ...(Array.isArray(freshArticles) ? freshArticles : []),
    ...(Array.isArray(storedArticles) ? storedArticles : []),
  ]) {
    if (!isJsonRecord(candidate)) continue;
    if (countryName) {
      const title = typeof candidate.title === "string" ? candidate.title : "";
      const description =
        typeof candidate.description === "string" ? candidate.description : "";
      if (
        !textMatchesCountry(
          `${title} ${description}`,
          countrySearchTerms(countryName),
        )
      ) {
        continue;
      }
    }
    if (
      typeof candidate.title === "string" &&
      isProviderErrorArticleTitle(candidate.title)
    ) {
      continue;
    }
    const publishedAt = candidate.publishedAt;
    if (
      typeof publishedAt === "string" &&
      Number.isFinite(Date.parse(publishedAt)) &&
      Date.now() - Date.parse(publishedAt) > ARTICLE_RETENTION_MS
    ) {
      continue;
    }
    const key = cachedArticleKey(candidate);
    if (!merged.has(key)) merged.set(key, candidate);
  }
  return [...merged.values()]
    .sort((left, right) => {
      const leftDate =
        typeof left.publishedAt === "string"
          ? Date.parse(left.publishedAt)
          : 0;
      const rightDate =
        typeof right.publishedAt === "string"
          ? Date.parse(right.publishedAt)
          : 0;
      return rightDate - leftDate;
    })
    .slice(0, limit);
}

export function mergeCachedPayloads(
  freshText: string,
  storedText: string,
) {
  try {
    const fresh = JSON.parse(freshText) as unknown;
    const stored = JSON.parse(storedText) as unknown;
    if (!isJsonRecord(fresh) || !isJsonRecord(stored)) return freshText;

    if (fresh.scope === "map") {
      const freshCountries = new Map<string, JsonRecord>();
      const storedCountries = new Map<string, JsonRecord>();
      for (const country of Array.isArray(fresh.countries)
        ? fresh.countries
        : []) {
        if (isJsonRecord(country) && typeof country.countryName === "string") {
          freshCountries.set(country.countryName, country);
        }
      }
      for (const country of Array.isArray(stored.countries)
        ? stored.countries
        : []) {
        if (isJsonRecord(country) && typeof country.countryName === "string") {
          storedCountries.set(country.countryName, country);
        }
      }

      const countryNames = [
        ...new Set([...freshCountries.keys(), ...storedCountries.keys()]),
      ];
      const countries = countryNames.map((countryName) => {
        const current = freshCountries.get(countryName);
        const previous = storedCountries.get(countryName);
        const articles = mergeCachedArticles(
          current?.articles,
          previous?.articles,
          32,
          countryName,
        );
        return {
          ...previous,
          ...current,
          countryName,
          available: articles.length > 0,
          articles,
        };
      });
      return JSON.stringify({ ...stored, ...fresh, countries });
    }

    const limit =
      fresh.scope === "global" ? 700 : fresh.scope === "event" ? 40 : 180;
    const countryName =
      fresh.scope === "country"
        ? typeof fresh.countryName === "string"
          ? fresh.countryName
          : typeof stored.countryName === "string"
            ? stored.countryName
            : undefined
        : undefined;
    return JSON.stringify({
      ...stored,
      ...fresh,
      articles: mergeCachedArticles(
        fresh.articles,
        stored.articles,
        limit,
        countryName,
      ),
    });
  } catch {
    return freshText;
  }
}
