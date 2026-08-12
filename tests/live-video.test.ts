import { describe, expect, it, vi } from "vitest";

import {
  discoverLiveNewsrooms,
  handleLiveVideo,
  parseLiveNewsroomSearch,
  parseLiveVideoSearch,
  verifiedLiveNewsroomFallback,
} from "../worker/live-video";

function liveRenderer({
  id,
  title,
  channel,
  viewers,
  description,
  live = true,
}: {
  id: string;
  title: string;
  channel: string;
  viewers: string;
  description?: string;
  live?: boolean;
}) {
  return {
    videoRenderer: {
      videoId: id,
      title: { runs: [{ text: title }] },
      ownerText: { runs: [{ text: channel }] },
      detailedMetadataSnippets: description
        ? [{ snippetText: { runs: [{ text: description }] } }]
        : undefined,
      viewCountText: { runs: [{ text: viewers }, { text: " watching" }] },
      badges: live
        ? [
            {
              metadataBadgeRenderer: {
                style: "BADGE_STYLE_TYPE_LIVE_NOW",
              },
            },
          ]
        : [],
      thumbnail: {
        thumbnails: [
          {
            url: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
            width: 480,
            height: 360,
          },
        ],
      },
    },
  };
}

function youtubeSearchPage(items: unknown[]) {
  return `<script>var ytInitialData = ${JSON.stringify({
    contents: { items },
  })};</script>`;
}

describe("live video discovery", () => {
  it("returns only matching active streams and ranks them by current viewers", () => {
    const body = youtubeSearchPage([
      liveRenderer({
        id: "livefeed001",
        title: "Trump and Netanyahu meet at the White House live",
        channel: "Channel One",
        viewers: "483",
      }),
      liveRenderer({
        id: "livefeed002",
        title: "White House meeting: Trump welcomes Netanyahu live",
        channel: "Channel Two",
        viewers: "1.2K",
      }),
      liveRenderer({
        id: "unrelated03",
        title: "Live weather coverage from Australia",
        channel: "Weather Desk",
        viewers: "9K",
      }),
      liveRenderer({
        id: "recorded004",
        title: "Trump and Netanyahu meet at the White House",
        channel: "Recorded News",
        viewers: "20K",
        live: false,
      }),
    ]);

    const videos = parseLiveVideoSearch(
      body,
      "Trump meets Netanyahu at the White House",
    );

    expect(videos.map((video) => video.id)).toEqual([
      "livefeed002",
      "livefeed001",
    ]);
    expect(videos[0]).toMatchObject({
      channelName: "Channel Two",
      viewerCount: 1200,
      embedUrl:
        "https://www.youtube-nocookie.com/embed/livefeed002?autoplay=1&mute=1&playsinline=1",
    });
  });

  it("returns an explicit empty result when no active coverage matches", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        youtubeSearchPage([
          liveRenderer({
            id: "unrelated05",
            title: "Live weather coverage from Australia",
            channel: "Weather Desk",
            viewers: "4K",
          }),
        ]),
        { status: 200 },
      ),
    );

    const response = await handleLiveVideo(
      new Request(
        "https://worldpulse.test/api/live-video?headline=Trump%20meets%20Netanyahu%20at%20the%20White%20House",
      ),
      fetchMock,
    );
    const payload = (await response.json()) as {
      videos: unknown[];
    };

    expect(response.status).toBe(200);
    expect(payload.videos).toEqual([]);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("keeps only active broadcasts from the curated newsroom directory", () => {
    const body = youtubeSearchPage([
      liveRenderer({
        id: "reuters001",
        title: "🔴 Reuters world briefing live",
        channel: "Reuters",
        viewers: "2.4K",
        description:
          "Live coverage of diplomatic talks and the latest world developments.",
      }),
      liveRenderer({
        id: "lookalike02",
        title: "Reuters headlines discussed live",
        channel: "Daily Commentary",
        viewers: "18K",
      }),
      liveRenderer({
        id: "recorded003",
        title: "BBC News international bulletin",
        channel: "BBC News",
        viewers: "7K",
        live: false,
      }),
    ]);

    expect(parseLiveNewsroomSearch(body)).toEqual([
      expect.objectContaining({
        id: "reuters001",
        newsroomName: "Reuters",
        title: "Reuters world briefing live",
        coverageDescription:
          "Live coverage of diplomatic talks and the latest world developments.",
        viewerCount: 2400,
      }),
    ]);
  });

  it("combines successful newsroom searches, deduplicates outlets, and ranks by viewers", async () => {
    let requestNumber = 0;
    const fetchMock = vi.fn(async () => {
      requestNumber += 1;
      if (requestNumber > 2) {
        return new Response("Unavailable", { status: 503 });
      }
      return new Response(
        youtubeSearchPage([
          liveRenderer({
            id: requestNumber === 1 ? "wionlive01" : "wionlive02",
            title:
              requestNumber === 1
                ? "WION world news live"
                : "WION breaking news live",
            channel: "WION",
            viewers: requestNumber === 1 ? "900" : "1.2K",
          }),
          liveRenderer({
            id: "bbcworld01",
            title: "BBC News world coverage live",
            channel: "BBC News",
            viewers: "3.5K",
          }),
        ]),
        { status: 200 },
      );
    });

    const videos = await discoverLiveNewsrooms(fetchMock);

    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(videos.map((video) => video.newsroomName)).toEqual([
      "BBC News",
      "WION",
    ]);
    expect(videos[1]).toMatchObject({
      id: "wionlive02",
      viewerCount: 1200,
    });
  });

  it("returns verified newsroom streams when every search request fails", async () => {
    const fetchMock = vi.fn(async () =>
      new Response("Unavailable", { status: 503 }),
    );

    const videos = await discoverLiveNewsrooms(fetchMock);

    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(videos).toEqual(verifiedLiveNewsroomFallback());
    expect(videos).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          newsroomName: "Sky News",
          embedUrl: expect.stringContaining("youtube-nocookie.com/embed/"),
        }),
        expect.objectContaining({ newsroomName: "Al Jazeera English" }),
      ]),
    );
  });

  it("serves the verified directory fallback instead of a 502 response", async () => {
    const fetchMock = vi.fn(async () =>
      new Response("Unavailable", { status: 503 }),
    );

    const response = await handleLiveVideo(
      new Request("https://worldpulse.test/api/live-video?mode=newsrooms"),
      fetchMock,
    );
    const payload = (await response.json()) as {
      videos: Array<{ newsroomName: string }>;
    };

    expect(response.status).toBe(200);
    expect(payload.videos.length).toBeGreaterThanOrEqual(7);
    expect(payload.videos[0]?.newsroomName).toBe("Sky News");
  });

  it("serves the auto-refreshing newsroom directory mode", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        youtubeSearchPage([
          liveRenderer({
            id: "skynews001",
            title: "Sky News live",
            channel: "Sky News",
            viewers: "8K",
          }),
        ]),
        { status: 200 },
      ),
    );

    const response = await handleLiveVideo(
      new Request(
        "https://worldpulse.test/api/live-video?mode=newsrooms",
      ),
      fetchMock,
    );
    const payload = (await response.json()) as {
      mode: string;
      refreshAfterSeconds: number;
      videos: Array<{ newsroomName: string }>;
    };

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toContain("s-maxage=75");
    expect(payload).toMatchObject({
      mode: "newsrooms",
      refreshAfterSeconds: 90,
    });
    expect(payload.videos[0]?.newsroomName).toBe("Sky News");
  });
});
