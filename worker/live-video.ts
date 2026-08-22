interface YouTubeText {
  runs?: Array<{ text?: string }>;
  simpleText?: string;
}

interface YouTubeVideoRenderer {
  videoId?: string;
  title?: YouTubeText;
  ownerText?: YouTubeText;
  longBylineText?: YouTubeText;
  descriptionSnippet?: YouTubeText;
  detailedMetadataSnippets?: Array<{
    snippetText?: YouTubeText;
  }>;
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

interface Newsroom {
  name: string;
  aliases: string[];
}

const NEWSROOMS: Newsroom[] = [
  { name: "Reuters", aliases: ["Reuters"] },
  { name: "Associated Press", aliases: ["Associated Press"] },
  { name: "BBC News", aliases: ["BBC News"] },
  { name: "Sky News", aliases: ["Sky News"] },
  {
    name: "Al Jazeera English",
    aliases: ["Al Jazeera English"],
  },
  { name: "DW News", aliases: ["DW News"] },
  {
    name: "France 24 English",
    aliases: ["France 24 English"],
  },
  { name: "Euronews", aliases: ["Euronews"] },
  { name: "NBC News", aliases: ["NBC News"] },
  { name: "ABC News", aliases: ["ABC News"] },
  { name: "CBS News", aliases: ["CBS News"] },
  { name: "CNN", aliases: ["CNN"] },
  { name: "Fox News", aliases: ["Fox News"] },
  {
    name: "Bloomberg Television",
    aliases: ["Bloomberg Television"],
  },
  { name: "CNBC", aliases: ["CNBC"] },
  { name: "CBC News", aliases: ["CBC News"] },
  { name: "PBS NewsHour", aliases: ["PBS NewsHour"] },
  { name: "Guardian News", aliases: ["Guardian News"] },
  { name: "WION", aliases: ["WION"] },
];

const NEWSROOM_SEARCHES = [
  "world news live",
  "breaking news live",
  "United States news live",
  "Europe news live",
  "business news live",
];

const VERIFIED_LIVE_STREAMS = [
  {
    id: "YDvsBbKfLPA",
    newsroomName: "Sky News",
    title: "Sky News live",
  },
  {
    id: "gCNeDWCI0vo",
    newsroomName: "Al Jazeera English",
    title: "Al Jazeera English live",
  },
  {
    id: "HvZt-nh9sGg",
    newsroomName: "France 24 English",
    title: "France 24 English live",
  },
  {
    id: "LuKwFajn37U",
    newsroomName: "DW News",
    title: "DW News live",
  },
  {
    id: "iipR5yUp36o",
    newsroomName: "ABC News",
    title: "ABC News live",
  },
  {
    id: "QB5BNdBFujE",
    newsroomName: "Bloomberg Television",
    title: "Bloomberg Television live",
  },
  {
    id: "60yRxWnUNXs",
    newsroomName: "WION",
    title: "WION live",
  },
] as const;

const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{6,20}$/;
const HEADLINE_PATTERN = /^[^\u0000-\u001f\u007f]{8,250}$/u;
const LOCATION_PATTERN = /^[^\u0000-\u001f\u007f]{2,120}$/u;
const CAMERA_TERMS = [
  "camera",
  "city cam",
  "citycam",
  "downtown",
  "harbor",
  "harbour",
  "skyline",
  "street cam",
  "traffic cam",
  "web cam",
  "webcam",
] as const;
const NEWS_BROADCAST_PATTERN =
  /\b(breaking|conflict|election|headlines|newscast|newsroom|politics|war)\b/i;
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

function cleanDisplayText(value: string) {
  return value
    .replace(/[\p{Extended_Pictographic}\uFE0F\u200D]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanCoverageDescription(value: string) {
  const cleaned = cleanDisplayText(value)
    .replace(/https?:\/\/\S+/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  if (cleaned.length <= 320) return cleaned;
  const shortened = cleaned.slice(0, 317);
  const lastSpace = shortened.lastIndexOf(" ");
  return `${shortened.slice(0, Math.max(220, lastSpace))}...`;
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

function normalizedChannelName(value: string) {
  return value
    .toLocaleLowerCase("en")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function newsroomForChannel(channelName: string) {
  const normalized = normalizedChannelName(channelName);
  return NEWSROOMS.find((newsroom) =>
    newsroom.aliases.some(
      (alias) => normalizedChannelName(alias) === normalized,
    ),
  );
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

function parsedLiveVideos(body: string) {
  const initialData = extractInitialData(body);
  if (!initialData) return [];
  const seen = new Set<string>();
  return collectVideoRenderers(initialData)
    .flatMap((video) => {
      const videoId = video.videoId ?? "";
      const title = cleanDisplayText(textValue(video.title));
      const channelName = cleanDisplayText(
        textValue(video.ownerText) || textValue(video.longBylineText),
      );
      const coverageDescription = cleanCoverageDescription(
        textValue(video.detailedMetadataSnippets?.[0]?.snippetText) ||
          textValue(video.descriptionSnippet),
      );
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
          coverageDescription:
            coverageDescription &&
            normalizedChannelName(coverageDescription) !==
              normalizedChannelName(title)
              ? coverageDescription
              : undefined,
          viewerCount: liveViewerCount(video.viewCountText),
          thumbnailUrl: thumbnail?.startsWith("http") ? thumbnail : undefined,
          watchUrl: `https://www.youtube.com/watch?v=${videoId}`,
          embedUrl: `https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&mute=1&playsinline=1`,
        },
      ];
    });
}

export function parseLiveVideoSearch(body: string, headline: string) {
  const headlineTokens = searchTokens(headline);
  const requiredSharedTokens = Math.max(
    1,
    Math.min(3, Math.ceil(headlineTokens.length * 0.25)),
  );
  return parsedLiveVideos(body)
    .flatMap((video) => {
      const titleTokens = new Set(searchTokens(video.title));
      const sharedTokens = headlineTokens.filter((token) =>
        titleTokens.has(token),
      );
      return sharedTokens.length >= requiredSharedTokens
        ? [{ ...video, relevance: sharedTokens.length }]
        : [];
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
      coverageDescription: video.coverageDescription,
      viewerCount: video.viewerCount,
      thumbnailUrl: video.thumbnailUrl,
      watchUrl: video.watchUrl,
      embedUrl: video.embedUrl,
    }));
}

export function parseLiveNewsroomSearch(body: string) {
  return parsedLiveVideos(body).flatMap((video) => {
    const newsroom = newsroomForChannel(video.channelName);
    return newsroom ? [{ ...video, newsroomName: newsroom.name }] : [];
  });
}

export function parseLiveCameraSearch(
  body: string,
  countryName: string,
  capitalName: string,
) {
  const locationTokens = searchTokens(`${capitalName} ${countryName}`);
  return parsedLiveVideos(body)
    .flatMap((video) => {
      const searchable = `${video.title} ${video.channelName} ${
        video.coverageDescription ?? ""
      }`.toLocaleLowerCase("en");
      if (
        NEWS_BROADCAST_PATTERN.test(searchable) ||
        newsroomForChannel(video.channelName) ||
        !CAMERA_TERMS.some((term) => searchable.includes(term))
      ) {
        return [];
      }
      const searchableTokens = new Set(searchTokens(searchable));
      const relevance = locationTokens.filter((token) =>
        searchableTokens.has(token),
      ).length;
      return relevance > 0 ? [{ ...video, relevance }] : [];
    })
    .sort(
      (left, right) =>
        right.relevance - left.relevance ||
        right.viewerCount - left.viewerCount,
    )
    .slice(0, 8)
    .map((video) => ({
      id: video.id,
      title: video.title,
      channelName: video.channelName,
      coverageDescription: video.coverageDescription,
      viewerCount: video.viewerCount,
      thumbnailUrl: video.thumbnailUrl,
      watchUrl: video.watchUrl,
      embedUrl: video.embedUrl,
    }));
}

function cameraLocationScore(
  video: ReturnType<typeof parseLiveCameraSearch>[number],
  countryName: string,
  capitalName: string,
) {
  const tokens = new Set(
    searchTokens(
      `${video.title} ${video.channelName} ${video.coverageDescription ?? ""}`,
    ),
  );
  const capitalMatches = searchTokens(capitalName).filter((token) =>
    tokens.has(token),
  ).length;
  const countryMatches = searchTokens(countryName).filter((token) =>
    tokens.has(token),
  ).length;
  return capitalMatches * 10 + countryMatches;
}

export function verifiedLiveNewsroomFallback() {
  return VERIFIED_LIVE_STREAMS.map((stream) => ({
    id: stream.id,
    title: stream.title,
    channelName: stream.newsroomName,
    newsroomName: stream.newsroomName,
    viewerCount: 0,
    thumbnailUrl: `https://i.ytimg.com/vi/${stream.id}/hqdefault.jpg`,
    watchUrl: `https://www.youtube.com/watch?v=${stream.id}`,
    embedUrl: `https://www.youtube-nocookie.com/embed/${stream.id}?autoplay=1&mute=1&playsinline=1`,
  }));
}

function youtubeSearchUrl(query: string) {
  const searchUrl = new URL("https://www.youtube.com/results");
  searchUrl.searchParams.set("search_query", query);
  searchUrl.searchParams.set("sp", "EgJAAQ%3D%3D");
  return searchUrl;
}

function youtubeRequestInit() {
  return {
    headers: {
      "Accept-Language": "en-US,en;q=0.9",
      "User-Agent":
        "Mozilla/5.0 (compatible; HemisphereHerald/1.3; live coverage index)",
    },
    signal: AbortSignal.timeout(8_000),
  };
}

export async function discoverLiveNewsrooms(
  fetchImpl: FetchImplementation = fetch,
) {
  const searches = await Promise.allSettled(
    NEWSROOM_SEARCHES.map(async (query) => {
      const response = await fetchImpl(
        youtubeSearchUrl(query),
        youtubeRequestInit(),
      );
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return parseLiveNewsroomSearch(await response.text());
    }),
  );
  const successful = searches.filter(
    (result) => result.status === "fulfilled",
  );
  if (!successful.length) {
    return verifiedLiveNewsroomFallback();
  }
  const bestByNewsroom = new Map<
    string,
    ReturnType<typeof parseLiveNewsroomSearch>[number]
  >();
  for (const result of successful) {
    if (result.status !== "fulfilled") continue;
    for (const video of result.value) {
      const existing = bestByNewsroom.get(video.newsroomName);
      if (!existing || video.viewerCount > existing.viewerCount) {
        bestByNewsroom.set(video.newsroomName, video);
      }
    }
  }
  const discovered = [...bestByNewsroom.values()]
    .sort(
      (left, right) =>
        right.viewerCount - left.viewerCount ||
        left.newsroomName.localeCompare(right.newsroomName),
    )
    .slice(0, 12);
  return discovered.length ? discovered : verifiedLiveNewsroomFallback();
}

export async function discoverCountryCameras(
  countryName: string,
  capitalName: string,
  fetchImpl: FetchImplementation = fetch,
) {
  const searches = [
    `${capitalName} ${countryName} live webcam`,
    `${capitalName} city live camera`,
    `${countryName} live webcam city`,
  ];
  const results = await Promise.allSettled(
    searches.map(async (query) => {
      const response = await fetchImpl(
        youtubeSearchUrl(query),
        youtubeRequestInit(),
      );
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return parseLiveCameraSearch(
        await response.text(),
        countryName,
        capitalName,
      );
    }),
  );
  const successful = results.filter(
    (result) => result.status === "fulfilled",
  );
  if (!successful.length) {
    throw new Error("No live-camera search completed.");
  }
  const videosById = new Map<
    string,
    ReturnType<typeof parseLiveCameraSearch>[number]
  >();
  for (const result of successful) {
    if (result.status !== "fulfilled") continue;
    for (const video of result.value) {
      const current = videosById.get(video.id);
      if (!current || video.viewerCount > current.viewerCount) {
        videosById.set(video.id, video);
      }
    }
  }
  return [...videosById.values()]
    .sort(
      (left, right) =>
        cameraLocationScore(right, countryName, capitalName) -
          cameraLocationScore(left, countryName, capitalName) ||
        right.viewerCount - left.viewerCount ||
        left.title.localeCompare(right.title),
    )
    .slice(0, 8);
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
  if (url.searchParams.get("mode") === "country-cameras") {
    const countryName = url.searchParams.get("country")?.trim() ?? "";
    const capitalName =
      url.searchParams.get("capital")?.trim() || countryName;
    if (
      !LOCATION_PATTERN.test(countryName) ||
      !LOCATION_PATTERN.test(capitalName)
    ) {
      return Response.json(
        { error: "Provide a valid country and city.", videos: [] },
        { status: 400, headers: { "Cache-Control": "no-store" } },
      );
    }
    try {
      const videos = await discoverCountryCameras(
        countryName,
        capitalName,
        fetchImpl,
      );
      return Response.json(
        {
          mode: "country-cameras",
          countryName,
          capitalName,
          generatedAt: new Date().toISOString(),
          refreshAfterSeconds: 120,
          videos,
        },
        {
          headers: {
            "Cache-Control":
              "public, max-age=30, s-maxage=60, stale-while-revalidate=120",
          },
        },
      );
    } catch {
      return Response.json(
        {
          error: "Live city cameras could not be checked right now.",
          videos: [],
        },
        { status: 502, headers: { "Cache-Control": "no-store" } },
      );
    }
  }
  if (url.searchParams.get("mode") === "newsrooms") {
    try {
      const videos = await discoverLiveNewsrooms(fetchImpl);
      return Response.json(
        {
          mode: "newsrooms",
          generatedAt: new Date().toISOString(),
          refreshAfterSeconds: 90,
          videos,
        },
        {
          headers: {
            "Cache-Control":
              "public, max-age=45, s-maxage=75, stale-while-revalidate=180",
          },
        },
      );
    } catch {
      return Response.json(
        {
          error: "Live newsrooms could not be checked right now.",
          videos: [],
        },
        { status: 502, headers: { "Cache-Control": "no-store" } },
      );
    }
  }
  const headline = url.searchParams.get("headline")?.trim() ?? "";
  if (!HEADLINE_PATTERN.test(headline)) {
    return Response.json(
      { error: "Provide a valid breaking-news headline.", videos: [] },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    const response = await fetchImpl(
      youtubeSearchUrl(`${headline.slice(0, 220)} live news`),
      youtubeRequestInit(),
    );
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
