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
