export const newsCacheTableSql = `
  CREATE TABLE IF NOT EXISTS news_feed_cache (
    cache_key TEXT PRIMARY KEY,
    payload TEXT NOT NULL,
    generated_at INTEGER NOT NULL,
    refreshed_at INTEGER NOT NULL
  )
`;

export const newsCacheRefreshedIndexSql = `
  CREATE INDEX IF NOT EXISTS news_feed_cache_refreshed_idx
  ON news_feed_cache (refreshed_at)
`;
