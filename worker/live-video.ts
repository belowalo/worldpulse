interface YouTubeText {
  runs?: Array<{ text?: string }>;
  simpleText?: string;
}

interface YouTubeVideoRenderer {
  videoId?: string;
  title?: YouTubeText;
  ownerText?: YouTubeText;
  badges?: Array<{
    metadataBadgeRenderer?: {
      style?: string;
    };
  }>;
  thumbnails?: Array<{
    url?: string;
    width?: number;
    height?: number;
  }>;
  thumbnail?: {
    thumbnails?: Array<{
      url?: string;
      width?: number;
      height?: number;
    }>;
  };
  viewCountText?: YouTubeText;
}

type FetchImplementation = typeof fetch;

const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{6,20}$/;
const HEADLINE_PATTERN = /^[^\u0000-\u001f\u007f]{8,250}$/u;
const SEARCH_STOP_WORDS = new Set([
  "about",
  "after",
  "against",
  "amid",
  "and",
  "are",
  "breaking",
  "for",
  "from",
  "has",
  "have",
  "into",
  "its",
  "live",
  "news",
  "over",
  "says",
  "that",
  "the",
  "their",
  "this",
  "with",
]);

function textValue(value?: YouTubeText) {
  return (
    value?.simpleText ??
    value?.runs?.map((run) => run.text ?? "").join("") ??
    ""
  ).trim();
}

function searchTokens(value: string) {
  return [
    ...new Set(
      (value.toLocaleLowerCase("en").match(/[\p{L}\p{N}]+/gu) ?? []).filter(
        (token) => token.length >= 4 && !SEARCH_STOP_WORDS.has(token),
      ),
    ),
  ];
}

function extractInitialData(body: string) {
  const markers = ["var ytInitialData = ", "ytInitialData = "];
  const marker = markers
    .map((candidate) => ({
      candidate,
      index: body.indexOf(candidate),
    }))
    .filter(({ index }) => index >= 0)
    .sort((left, right) => left.index - right.index)[0];
  if (!marker) return null;
  const start = body.indexOf("{", marker.index + marker.candidate.length);
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < body.length; index += 1) {
    const character = body[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === '"') {
        inString = false;
      }
      continue;
    }
    if (character === '"') {
      inString = true;
    } else if (character === "{") {
      depth += 1;
    } else if (character === "}") {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(body.slice(start, index + 1)) as unknown;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

function collectVideoRenderers(value: unknown) {
  const videos: YouTubeVideoRenderer[] = [];
  const stack: unknown[] = [value];
  while (stack.length) {
    const current = stack.pop();
    if (!current || typeof current !== "object") continue;
    const record = current as Record<string, unknown>;
    if (
      record.videoRenderer &&
      typeof record.videoRenderer === "object"
    ) {
      videos.push(record.videoRenderer as YouTubeVideoRenderer);
    }
    for (const child of Object.values(record)) {
      if (child && typeof child === "object") stack.push(child);
    }
  }
  return videos;
}

function liveViewerCount(value?: YouTubeText) {
  const text = textValue(value).replace(/,/g, "");
  const match = text.match(/([\d.]+)\s*([KMB])?/i);
  if (!match) return 0;
  const number = Number(match[1]);
  if (!Number.isFinite(number)) return 0;
  const multiplier =
    match[2]?.toUpperCase() === "K"
      ? 1_000
      : match[2]?.toUpperCase() === "M"
        ? 1_000_000
        : match[2]?.toUpperCase() === "B"
          ? 1_000_000_000
          : 1;
  return Math.round(number * multiplier);
}

export function parseLiveVideoSearch(body: string, headline: string) {
  const initialData = extractInitialData(body);
  if (!initialData) return [];
  const headlineTokens = searchTokens(headline);
  const requiredSharedTokens = Math.max(
    1,
    Math.min(3, Math.ceil(headlineTokens.length * 0.25)),
  );
  const seen = new Set<string>();
  return collectVideoRenderers(initialData)
    .flatMap((video) => {
      const videoId = video.videoId ?? "";
      const title = textValue(video.title);
      const channelName = textValue(video.ownerText);
      const isLive = video.badges?.some(
        (badge) =>
          badge.metadataBadgeRenderer?.style ===
          "BADGE_STYLE_TYPE_LIVE_NOW",
      );
      if (
        !isLive ||
        !VIDEO_ID_PATTERN.test(videoId) ||
        !title ||
        !channelName ||
        seen.has(videoId)
      ) {
        return [];
      }
      const titleTokens = new Set(searchTokens(title));
      const sharedTokens = headlineTokens.filter((token) =>
        titleTokens.has(token),
      );
      if (sharedTokens.length < requiredSharedTokens) return [];
      seen.add(videoId);
      const thumbnails =
        video.thumbnail?.thumbnails ?? video.thumbnails ?? [];
      const thumbnail = [...thumbnails]
        .sort(
          (left, right) =>
            (right.width ?? 0) * (right.height ?? 0) -
            (left.width ?? 0) * (left.height ?? 0),
        )[0]?.url;
      return [
        {
          id: videoId,
          title,
          channelName,
          viewerCount: liveViewerCount(video.viewCountText),
          thumbnailUrl: thumbnail?.startsWith("http") ? thumbnail : undefined,
          watchUrl: `https://www.youtube.com/watch?v=${videoId}`,
          embedUrl: `https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&mute=1&playsinline=1`,
          relevance: sharedTokens.length,
        },
      ];
    })
    .sort(
      (left, right) =>
        right.viewerCount - left.viewerCount ||
        right.relevance - left.relevance,
    )
    .slice(0, 8)
    .map((video) => ({
      id: video.id,
      title: video.title,
      channelName: video.channelName,
      viewerCount: video.viewerCount,
      thumbnailUrl: video.thumbnailUrl,
      watchUrl: video.watchUrl,
      embedUrl: video.embedUrl,
    }));
}

export async function handleLiveVideo(
  request: Request,
  fetchImpl: FetchImplementation = fetch,
) {
  if (request.method !== "GET") {
    return Response.json(
      { error: "Method not allowed.", videos: [] },
      { status: 405, headers: { "Cache-Control": "no-store" } },
    );
  }
  const url = new URL(request.url);
  const headline = url.searchParams.get("headline")?.trim() ?? "";
  if (!HEADLINE_PATTERN.test(headline)) {
    return Response.json(
      { error: "Provide a valid breaking-news headline.", videos: [] },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  const searchUrl = new URL("https://www.youtube.com/results");
  searchUrl.searchParams.set(
    "search_query",
    `${headline.slice(0, 220)} live news`,
  );
  searchUrl.searchParams.set("sp", "EgJAAQ%3D%3D");
  try {
    const response = await fetchImpl(searchUrl, {
      headers: {
        "Accept-Language": "en-US,en;q=0.9",
        "User-Agent":
          "Mozilla/5.0 (compatible; WorldPulse/1.2; live coverage index)",
      },
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const body = await response.text();
    const videos = parseLiveVideoSearch(body, headline);
    return Response.json(
      {
        headline,
        generatedAt: new Date().toISOString(),
        videos,
      },
      {
        headers: {
          "Cache-Control":
            "public, max-age=20, s-maxage=45, stale-while-revalidate=120",
        },
      },
    );
  } catch {
    return Response.json(
      {
        error: "Live coverage could not be checked right now.",
        videos: [],
      },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
