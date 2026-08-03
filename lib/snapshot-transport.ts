import type {
  Article,
  Event,
  NewsSource,
  PreparedNewsFeed,
  PreparedWorldNewsPayload,
  PreparedWorldNewsWirePayload,
} from "@/lib/types";

type FeedTuple = [number[], string | null, string | null];

function optional(value: string | undefined) {
  return value ?? null;
}

export function encodePreparedWorldNews(
  payload: PreparedWorldNewsPayload,
): PreparedWorldNewsWirePayload {
  const sources: unknown[][] = [];
  const sourceIndexes = new Map<string, number>();
  const articles: unknown[][] = [];
  const articleIndexes = new Map<string, number>();
  const events: unknown[][] = [];
  const eventIndexes = new Map<string, number>();

  const sourceIndex = (source: NewsSource) => {
    const key = `${source.id}\u0000${source.url}`;
    const existing = sourceIndexes.get(key);
    if (existing !== undefined) return existing;
    const index = sources.length;
    sourceIndexes.set(key, index);
    sources.push([
      source.id,
      source.publisherName,
      source.url,
      source.country,
      source.prominenceScore,
    ]);
    return index;
  };

  const articleIndex = (article: Article) => {
    const key = `${article.id}\u0000${article.originalUrl}`;
    const existing = articleIndexes.get(key);
    if (existing !== undefined) return existing;
    const index = articles.length;
    articleIndexes.set(key, index);
    articles.push([
      article.id,
      article.headline,
      article.originalUrl,
      optional(article.imageUrl),
      sourceIndex(article.source),
      article.publishedAt,
      article.extractedCountries,
      article.category,
      article.eventId,
      optional(article.originalHeadline),
      optional(article.originalLanguage),
    ]);
    return index;
  };

  const eventIndex = (event: Event) => {
    const existing = eventIndexes.get(event.id);
    if (existing !== undefined) return existing;
    const index = events.length;
    eventIndexes.set(event.id, index);
    events.push([
      event.id,
      event.headline,
      event.summary,
      event.category,
      event.matchedPublisherCount ?? null,
      event.importanceScore,
      event.importanceLabel,
      event.geographicScope,
      event.primaryCountry,
      event.affectedCountries,
      event.firstSeenAt,
      event.lastUpdatedAt,
      [
        event.scoringComponents.sourceDiversity,
        event.scoringComponents.geographicImpact,
        event.scoringComponents.publisherProminence,
        event.scoringComponents.recency,
        event.scoringComponents.coverageVelocity,
      ],
      [
        event.scoringInput.independentSourceCount,
        event.scoringInput.sourceCountryCount,
        event.scoringInput.affectedCountryCount,
        event.scoringInput.countrySignificance,
        event.scoringInput.publisherProminence,
        event.scoringInput.ageHours,
        event.scoringInput.articlesPerHour,
      ],
      event.articles.map(articleIndex),
      event.generatedSummary,
      optional(event.originalHeadline),
      optional(event.originalSummary),
      optional(event.originalLanguage),
    ]);
    return index;
  };

  const feedTuple = (feed: PreparedNewsFeed): FeedTuple => [
    feed.events.map(eventIndex),
    feed.updatedAt,
    feed.provider,
  ];

  return {
    s: "pw2",
    v: payload.version,
    g: payload.generatedAt,
    r: payload.refreshAfterSeconds,
    n: sources,
    a: articles,
    e: events,
    f: {
      g: feedTuple(payload.globalFeed),
      c: Object.entries(payload.countryFeeds).map(([name, feed]) => [
        name,
        ...feedTuple(feed),
      ]),
    },
  };
}

export function isPreparedWorldNewsWire(
  payload: unknown,
): payload is PreparedWorldNewsWirePayload {
  return Boolean(
    payload &&
      typeof payload === "object" &&
      (payload as PreparedWorldNewsWirePayload).s === "pw2" &&
      Array.isArray((payload as PreparedWorldNewsWirePayload).e),
  );
}

export function decodePreparedWorldNews(
  wire: PreparedWorldNewsWirePayload,
): PreparedWorldNewsPayload {
  const sources = wire.n.map((row) => ({
    id: row[0] as string,
    publisherName: row[1] as string,
    url: row[2] as string,
    country: row[3] as string,
    prominenceScore: row[4] as number,
  } satisfies NewsSource));
  const articles = wire.a.map((row) => ({
    id: row[0] as string,
    headline: row[1] as string,
    originalUrl: row[2] as string,
    ...(row[3] ? { imageUrl: row[3] as string } : {}),
    source: sources[row[4] as number],
    publishedAt: row[5] as string,
    extractedCountries: row[6] as string[],
    category: row[7] as Article["category"],
    eventId: row[8] as string,
    ...(row[9] ? { originalHeadline: row[9] as string } : {}),
    ...(row[10] ? { originalLanguage: row[10] as string } : {}),
  } satisfies Article));
  const events = wire.e.map((row) => {
    const components = row[12] as number[];
    const input = row[13] as number[];
    return {
      id: row[0] as string,
      headline: row[1] as string,
      summary: row[2] as string,
      category: row[3] as Event["category"],
      ...(row[4] !== null ? { matchedPublisherCount: row[4] as number } : {}),
      importanceScore: row[5] as number,
      importanceLabel: row[6] as Event["importanceLabel"],
      geographicScope: row[7] as Event["geographicScope"],
      primaryCountry: row[8] as string,
      affectedCountries: row[9] as string[],
      firstSeenAt: row[10] as string,
      lastUpdatedAt: row[11] as string,
      scoringComponents: {
        sourceDiversity: components[0],
        geographicImpact: components[1],
        publisherProminence: components[2],
        recency: components[3],
        coverageVelocity: components[4],
      },
      scoringInput: {
        independentSourceCount: input[0],
        sourceCountryCount: input[1],
        affectedCountryCount: input[2],
        countrySignificance: input[3],
        publisherProminence: input[4],
        ageHours: input[5],
        articlesPerHour: input[6],
      },
      articles: (row[14] as number[]).map((index) => articles[index]),
      generatedSummary: row[15] as boolean,
      ...(row[16] ? { originalHeadline: row[16] as string } : {}),
      ...(row[17] ? { originalSummary: row[17] as string } : {}),
      ...(row[18] ? { originalLanguage: row[18] as string } : {}),
    } satisfies Event;
  });
  const decodeFeed = (row: unknown[]): PreparedNewsFeed => ({
    events: (row[0] as number[]).map((index) => events[index]),
    updatedAt: row[1] as string | null,
    provider: row[2] as string | null,
    loading: false,
    error: null,
  });
  return {
    scope: "prepared-world",
    version: wire.v,
    generatedAt: wire.g,
    refreshAfterSeconds: wire.r,
    globalFeed: decodeFeed(wire.f.g),
    countryFeeds: Object.fromEntries(
      wire.f.c.map((row) => [row[0] as string, decodeFeed(row.slice(1))]),
    ),
  };
}
