import type { Article } from "./types";

export type BiasBucket = "left" | "center" | "right";

export interface PublisherBiasRating {
  bucket: BiasBucket;
  label: string;
  groundNewsUrl: string;
}

export interface BiasDistribution {
  left: number;
  center: number;
  right: number;
  rated: number;
  total: number;
  percentages: Record<BiasBucket, number>;
}

const GROUND_RATINGS: Array<{
  aliases: string[];
  rating: PublisherBiasRating;
}> = [
  {
    aliases: ["reuters"],
    rating: {
      bucket: "center",
      label: "Center",
      groundNewsUrl:
        "https://ground.news/interest/3d2562ff-9fd7-47e7-a7c1-697c036ec06c",
    },
  },
  {
    aliases: ["associated press", "associated press news", "ap news"],
    rating: {
      bucket: "left",
      label: "Lean Left",
      groundNewsUrl: "https://ground.news/interest/associated-press-news",
    },
  },
  {
    aliases: ["bbc", "bbc news"],
    rating: {
      bucket: "center",
      label: "Center",
      groundNewsUrl: "https://ground.news/interest/bbc-news_bf95f4",
    },
  },
  {
    aliases: ["cnn"],
    rating: {
      bucket: "left",
      label: "Lean Left",
      groundNewsUrl: "https://ground.news/interest/cnn",
    },
  },
  {
    aliases: ["al jazeera", "al jazeera english"],
    rating: {
      bucket: "left",
      label: "Lean Left",
      groundNewsUrl:
        "https://ground.news/interest/929de1e9-a041-4ee4-a5a8-ea34732f9530/al-jazeera",
    },
  },
  {
    aliases: ["cbc", "cbc news"],
    rating: {
      bucket: "left",
      label: "Lean Left",
      groundNewsUrl: "https://ground.news/interest/cbc-news",
    },
  },
  {
    aliases: ["deutsche welle", "dw"],
    rating: {
      bucket: "center",
      label: "Center",
      groundNewsUrl: "https://ground.news/interest/deutsche-welle",
    },
  },
  {
    aliases: ["cnbc"],
    rating: {
      bucket: "left",
      label: "Lean Left",
      groundNewsUrl:
        "https://ground.news/interest/a018b59f-3ad4-41eb-816d-0ce90dfdbca1",
    },
  },
  {
    aliases: ["u s news", "u s news world report", "us news"],
    rating: {
      bucket: "left",
      label: "Lean Left",
      groundNewsUrl: "https://ground.news/interest/us-news",
    },
  },
  {
    aliases: ["global news"],
    rating: {
      bucket: "left",
      label: "Lean Left",
      groundNewsUrl: "https://ground.news/interest/global-news",
    },
  },
  {
    aliases: ["new york post", "nypost"],
    rating: {
      bucket: "right",
      label: "Lean Right",
      groundNewsUrl: "https://ground.news/interest/new-york-post",
    },
  },
  {
    aliases: ["wall street journal", "the wall street journal", "wsj"],
    rating: {
      bucket: "center",
      label: "Center",
      groundNewsUrl:
        "https://ground.news/interest/4e3ec8fc-4c44-4336-a2ee-2f1a37a3ff1f",
    },
  },
  {
    aliases: ["city news", "citynews"],
    rating: {
      bucket: "center",
      label: "Center",
      groundNewsUrl: "https://ground.news/interest/city-news",
    },
  },
  {
    aliases: ["stat", "stat news"],
    rating: {
      bucket: "center",
      label: "Center",
      groundNewsUrl: "https://ground.news/interest/stat",
    },
  },
  {
    aliases: ["redstate", "red state"],
    rating: {
      bucket: "right",
      label: "Right",
      groundNewsUrl: "https://ground.news/interest/redstate",
    },
  },
];

function normalizePublisher(value: string) {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export function publisherBiasRating(
  publisherName: string,
): PublisherBiasRating | null {
  const normalized = normalizePublisher(publisherName);
  const match = GROUND_RATINGS.find(({ aliases }) =>
    aliases.some(
      (alias) =>
        normalized === alias ||
        normalized.startsWith(`${alias} `) ||
        normalized.endsWith(` ${alias}`),
    ),
  );
  return match?.rating ?? null;
}

export function biasDistributionForArticles(
  articles: Pick<Article, "source">[],
): BiasDistribution {
  const distinctPublishers = new Map<string, string>();
  for (const article of articles) {
    const key = normalizePublisher(
      article.source.url || article.source.publisherName,
    );
    if (!distinctPublishers.has(key)) {
      distinctPublishers.set(key, article.source.publisherName);
    }
  }

  const counts: Record<BiasBucket, number> = {
    left: 0,
    center: 0,
    right: 0,
  };
  for (const publisherName of distinctPublishers.values()) {
    const rating = publisherBiasRating(publisherName);
    if (rating) counts[rating.bucket] += 1;
  }
  const rated = counts.left + counts.center + counts.right;
  const percentages: Record<BiasBucket, number> = {
    left: 0,
    center: 0,
    right: 0,
  };
  if (rated) {
    const buckets: BiasBucket[] = ["left", "center", "right"];
    const raw = buckets.map((bucket) => ({
      bucket,
      value: (counts[bucket] / rated) * 100,
    }));
    for (const item of raw) percentages[item.bucket] = Math.floor(item.value);
    let remainder =
      100 -
      percentages.left -
      percentages.center -
      percentages.right;
    for (const item of raw.sort(
      (left, right) =>
        right.value -
        Math.floor(right.value) -
        (left.value - Math.floor(left.value)),
    )) {
      if (!remainder) break;
      percentages[item.bucket] += 1;
      remainder -= 1;
    }
  }

  return {
    ...counts,
    rated,
    total: distinctPublishers.size,
    percentages,
  };
}
