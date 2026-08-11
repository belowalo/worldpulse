import {
  newsCacheRefreshedIndexSql,
  newsCacheTableSql,
} from "./schema";

export interface StoredNewsFeed {
  cache_key: string;
  payload: string;
  generated_at: number;
  refreshed_at: number;
}

export interface StoredNewsPayload {
  payload: string;
  generated_at: number;
}

const initializedDatabases = new WeakSet<object>();

async function ensureNewsCache(db: D1Database) {
  if (initializedDatabases.has(db)) return;
  await db.batch([
    db.prepare(newsCacheTableSql),
    db.prepare(newsCacheRefreshedIndexSql),
  ]);
  initializedDatabases.add(db);
}

export async function readStoredNewsFeed(
  db: D1Database,
  cacheKey: string,
) {
  await ensureNewsCache(db);
  return db
    .prepare(
      `SELECT cache_key, payload, generated_at, refreshed_at
       FROM news_feed_cache
       WHERE cache_key = ?1`,
    )
    .bind(cacheKey)
    .first<StoredNewsFeed>();
}

export async function readLatestStoredGlobalFeed(db: D1Database) {
  await ensureNewsCache(db);
  return db
    .prepare(
      `SELECT cache_key, payload, generated_at, refreshed_at
       FROM news_feed_cache
       WHERE cache_key LIKE '%scope=global%'
       ORDER BY generated_at DESC
       LIMIT 1`,
    )
    .first<StoredNewsFeed>();
}

export async function writeStoredNewsFeed(
  db: D1Database,
  cacheKey: string,
  payload: string,
  generatedAt: number,
) {
  await ensureNewsCache(db);
  await db
    .prepare(
      `INSERT INTO news_feed_cache (
         cache_key,
         payload,
         generated_at,
         refreshed_at
       ) VALUES (?1, ?2, ?3, ?4)
       ON CONFLICT(cache_key) DO UPDATE SET
         payload = excluded.payload,
         generated_at = excluded.generated_at,
         refreshed_at = excluded.refreshed_at`,
    )
    .bind(cacheKey, payload, generatedAt, Date.now())
    .run();
}

export async function readStoredMapFeeds(
  db: D1Database,
  limit = 160,
) {
  await ensureNewsCache(db);
  const result = await db
    .prepare(
      `SELECT payload, generated_at
       FROM news_feed_cache
       WHERE cache_key LIKE '%scope=map%'
       ORDER BY generated_at DESC
       LIMIT ?1`,
    )
    .bind(limit)
    .all<StoredNewsPayload>();
  return result.results ?? [];
}

export async function readStoredCountryFeeds(
  db: D1Database,
  countryNames: string[] = [],
  limit = 320,
) {
  await ensureNewsCache(db);
  if (countryNames.length) {
    const placeholders = countryNames
      .map((_, index) => `?${index + 1}`)
      .join(", ");
    const result = await db
      .prepare(
        `SELECT payload, generated_at
         FROM news_feed_cache
         WHERE json_extract(payload, '$.scope') = 'country'
           AND json_extract(payload, '$.countryName') IN (${placeholders})
         ORDER BY generated_at DESC
         LIMIT ?${countryNames.length + 1}`,
      )
      .bind(...countryNames, limit)
      .all<StoredNewsPayload>();
    return result.results ?? [];
  }
  const result = await db
    .prepare(
      `SELECT payload, generated_at
       FROM news_feed_cache
       WHERE cache_key LIKE '%country=%'
       ORDER BY generated_at DESC
       LIMIT ?1`,
    )
    .bind(limit)
    .all<StoredNewsPayload>();
  return result.results ?? [];
}
