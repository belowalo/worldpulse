import { describe, expect, it, vi } from "vitest";

import {
  handleLiveVideo,
  parseLiveVideoSearch,
} from "../worker/live-video";

function liveRenderer({
  id,
  title,
  channel,
  viewers,
  live = true,
}: {
  id: string;
  title: string;
  channel: string;
  viewers: string;
  live?: boolean;
}) {
  return {
    videoRenderer: {
      videoId: id,
      title: { runs: [{ text: title }] },
      ownerText: { runs: [{ text: channel }] },
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
});
