import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { WorldPulseApp } from "@/components/world-pulse-app";
import type { WorldMapProps } from "@/components/world-map";
import { mapStyleForEvent } from "@/lib/scoring";
import { countryPulses } from "@/lib/seed-data";
import { CATEGORIES } from "@/lib/types";

type TestLiveArticle = {
  id: string;
  title: string;
  description?: string;
  imageUrl?: string;
  url: string;
  publisherName: string;
  publisherUrl: string;
  publishedAt: string;
  originalTitle?: string;
  originalDescription?: string;
  originalLanguage?: string;
};

function liveArticleFor(countryName: string): TestLiveArticle {
  const slug = countryName.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return {
    id: `${slug}-current`,
    title: `${countryName} government announces a current national update`,
    url: `https://publisher.example/${slug}-current`,
    publisherName: "Test Publisher",
    publisherUrl: "https://publisher.example/",
    publishedAt: "2026-07-25T00:00:00.000Z",
  };
}

function liveMapResponse(
  requestUrl: string,
  articlesByCountry: Record<string, TestLiveArticle[]> = {},
) {
  const parameters = new URL(requestUrl, "https://worldpulse.test").searchParams;
  const countries = (parameters.get("countries") ?? "")
    .split("|")
    .filter(Boolean);
  return Response.json({
    scope: "map",
    generatedAt: "2026-07-25T00:00:00.000Z",
    refreshAfterSeconds: 600,
    provider: "Test live world search",
    countries: countries.map((countryName) => ({
      countryName,
      generatedAt: "2026-07-25T00:00:00.000Z",
      available: true,
      articles: articlesByCountry[countryName] ?? [liveArticleFor(countryName)],
    })),
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function TestMap({
  countries,
  onSelect,
  selectedMapId,
  statusLabel,
  linkEvents,
}: WorldMapProps) {
  const japan = countryPulses.find((country) => country.iso2 === "JP");
  const egypt = countryPulses.find((country) => country.iso2 === "EG");
  const canada = countries.find((country) => country.iso2 === "CA");
  const australia = countries.find((country) => country.iso2 === "AU");
  return (
    <>
      <span>{statusLabel}</span>
      <span data-testid="countries-with-news">
        {countries.filter((country) => country.topEvent).length}
      </span>
      <span data-testid="countries-syncing">
        {countries.filter((country) => !country.signalReady).length}
      </span>
      <span data-testid="countries-with-valid-color-contract">
        {
          countries.filter((country) => {
            const topEvent = country.topEvent;
            if (
              !topEvent ||
              country.events[0]?.id !== topEvent.id ||
              !CATEGORIES.includes(topEvent.category)
            ) {
              return false;
            }
            return (
              mapStyleForEvent(
                topEvent.category,
                topEvent.importanceScore,
              ).fillColor !== "#303a47"
            );
          }).length
        }
      </span>
      <span data-testid="canada-map-category">
        {canada?.topEvent?.category ?? ""}
      </span>
      <span data-testid="canada-map-headline">
        {canada?.topEvent?.headline ?? ""}
      </span>
      <span data-testid="australia-map-category">
        {australia?.topEvent?.category ?? ""}
      </span>
      <span data-testid="australia-map-headline">
        {australia?.topEvent?.headline ?? ""}
      </span>
      <span data-testid="link-event-ids">
        {linkEvents?.map((event) => event.id).join(",") ?? ""}
      </span>
      <span data-testid="selected-map-id">{selectedMapId ?? ""}</span>
      <button type="button" onClick={() => japan && onSelect(japan)}>
        Select Japan on map
      </button>
      <button type="button" onClick={() => egypt && onSelect(egypt)}>
        Select Egypt on map
      </button>
      <button type="button" onClick={() => australia && onSelect(australia)}>
        Select Australia on map
      </button>
      <button
        type="button"
        onClick={() =>
          onSelect({ mapId: "country-184", name: "Spain", events: [] })
        }
      >
        Select Spain on map
      </button>
      <button
        type="button"
        onClick={() =>
          onSelect({
            mapId: "country-57",
            iso2: "SN",
            name: "Senegal",
            events: [],
          })
        }
      >
        Select Senegal on map
      </button>
    </>
  );
}

describe("WorldPulse interactions", () => {
  it("opens the selected country's event panel", () => {
    render(<WorldPulseApp MapComponent={TestMap} liveUpdates={false} />);
    expect(screen.getByRole("heading", { name: "Canada" })).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Select Japan on map" }),
    );
    expect(screen.getByRole("heading", { name: "Japan" })).toBeInTheDocument();
  });

  it("opens Live Situation without changing the selected country", () => {
    render(<WorldPulseApp MapComponent={TestMap} liveUpdates={false} />);
    fireEvent.click(
      screen.getByRole("button", { name: "Select Japan on map" }),
    );
    expect(screen.getByTestId("selected-map-id")).toHaveTextContent("392");

    fireEvent.click(screen.getByRole("button", { name: "Live Situation" }));
    expect(
      screen.getByRole("heading", { name: "Live Situation" }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("selected-map-id")).toHaveTextContent("392");
    expect(
      screen.queryByRole("button", { name: "Global feed" }),
    ).not.toBeInTheDocument();
  });

  it("shows no country connections until a specific event is selected", async () => {
    const tradeHeadline =
      "Canada and Mexico agree a cross-border trade accord";
    const countryArticles = [
      {
        id: "canada-mexico-trade",
        title: tradeHeadline,
        url: "https://publisher.example/canada-mexico-trade",
        publisherName: "Test Publisher",
        publisherUrl: "https://publisher.example/",
        publishedAt: "2026-07-25T00:00:00.000Z",
      },
      {
        id: "canada-us-wildfires",
        title: "Canada and United States coordinate wildfire response",
        url: "https://publisher.example/canada-us-wildfires",
        publisherName: "Second Publisher",
        publisherUrl: "https://publisher.example/",
        publishedAt: "2026-07-24T23:00:00.000Z",
      },
    ];
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/countries.geojson") {
        return Response.json({
          features: [
            { id: "124", properties: { name: "Canada" } },
            { id: "484", properties: { name: "Mexico" } },
            { id: "840", properties: { name: "United States" } },
          ],
        });
      }
      if (url.includes("scope=map")) {
        return liveMapResponse(url, { Canada: countryArticles });
      }
      const countryName = url.includes("country=Canada") ? "Canada" : null;
      return Response.json({
        countryName,
        scope: countryName ? "country" : "global",
        generatedAt: "2026-07-25T00:00:00.000Z",
        refreshAfterSeconds: 600,
        provider: "Test live index",
        articles: countryName ? countryArticles : [],
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<WorldPulseApp MapComponent={TestMap} />);

    await screen.findByRole("heading", { name: tradeHeadline });
    expect(screen.getByTestId("link-event-ids")).toBeEmptyDOMElement();

    fireEvent.click(
      await screen.findByRole("heading", { name: tradeHeadline }),
    );
    expect(
      screen.getByTestId("link-event-ids").textContent?.split(",").filter(Boolean),
    ).toHaveLength(1);

    fireEvent.click(
      screen.getByRole("heading", { name: tradeHeadline }),
    );
    expect(screen.getByTestId("link-event-ids")).toBeEmptyDOMElement();
  });

  it("shows the global top stories in Live Situation with one source each", async () => {
    const headline = "Canada and Mexico agree a cross-border trade accord";
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/countries.geojson") {
        return Response.json({
          features: [
            { id: "124", properties: { name: "Canada" } },
            { id: "484", properties: { name: "Mexico" } },
          ],
        });
      }
      if (url.includes("scope=map")) {
        return liveMapResponse(url);
      }
      if (url.startsWith("/api/live-video")) {
        return Response.json({
          headline,
          generatedAt: "2026-07-25T00:00:00.000Z",
          videos: [
            {
              id: "testlive001",
              title: `${headline} live`,
              channelName: "Example Live",
              viewerCount: 1250,
              thumbnailUrl: "https://i.ytimg.com/vi/testlive001/hqdefault.jpg",
              watchUrl: "https://www.youtube.com/watch?v=testlive001",
              embedUrl:
                "https://www.youtube-nocookie.com/embed/testlive001?autoplay=1&mute=1&playsinline=1",
            },
          ],
        });
      }
      const countryName =
        new URL(url, "https://worldpulse.test").searchParams.get(
          "country",
        );
      return Response.json({
        countryName,
        scope: countryName ? "country" : "global",
        generatedAt: "2026-07-25T00:00:00.000Z",
        refreshAfterSeconds: 600,
        provider: "Test live index",
        articles: countryName
          ? []
          : [
              {
                id: "canada-mexico-trade",
                title: headline,
                url: "https://publisher.example/canada-mexico-trade",
                imageUrl: "https://images.publisher.example/trade.jpg",
                publisherName: "Test Publisher",
                publisherUrl: "https://publisher.example/",
                publishedAt: "2026-07-25T00:00:00.000Z",
              },
            ],
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<WorldPulseApp MapComponent={TestMap} />);
    fireEvent.click(await screen.findByRole("button", { name: "Live Situation" }));
    const dialog = screen.getByRole("dialog", { name: "Live Situation" });
    expect(within(dialog).getByRole("heading", { name: headline })).toBeInTheDocument();
    expect(within(dialog).getAllByRole("link")).toHaveLength(1);
    expect(
      screen.queryByRole("button", { name: /connections/i }),
    ).not.toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
    fireEvent.click(screen.getByRole("button", { name: "Live News" }));
    const liveNewsDialog = screen.getByRole("dialog", { name: "Live News" });
    expect(
      await within(liveNewsDialog).findByTitle(
        `Example Live: ${headline} live`,
      ),
    ).toHaveAttribute(
      "src",
      expect.stringContaining("youtube-nocookie.com/embed/testlive001"),
    );
    expect(
      within(liveNewsDialog).getByText("Available live feeds"),
    ).toBeInTheDocument();
  });

  it("changes Live News coverage with the selected story and shows an explicit empty state", async () => {
    const coveredHeadline =
      "Trump meets Netanyahu at the White House summit";
    const uncoveredHeadline =
      "Australia expands a remote coastal rail project";
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/countries.geojson") {
        return Response.json({
          features: [{ id: "124", properties: { name: "Canada" } }],
        });
      }
      if (url.includes("scope=map")) return liveMapResponse(url);
      if (url.startsWith("/api/live-video")) {
        const requestedHeadline = new URL(
          url,
          "https://worldpulse.test",
        ).searchParams.get("headline");
        return Response.json({
          headline: requestedHeadline,
          generatedAt: "2026-07-25T00:00:00.000Z",
          videos:
            requestedHeadline === coveredHeadline
              ? [
                  {
                    id: "covered001",
                    title: `${coveredHeadline} live`,
                    channelName: "World News Live",
                    viewerCount: 2400,
                    watchUrl:
                      "https://www.youtube.com/watch?v=covered001",
                    embedUrl:
                      "https://www.youtube-nocookie.com/embed/covered001?autoplay=1&mute=1&playsinline=1",
                  },
                ]
              : [],
        });
      }
      return Response.json({
        countryName: null,
        scope: "global",
        generatedAt: "2026-07-25T00:00:00.000Z",
        refreshAfterSeconds: 600,
        provider: "Test live index",
        articles: [
          {
            id: "covered-story",
            title: coveredHeadline,
            url: "https://publisher-one.example/covered",
            publisherName: "Publisher One",
            publisherUrl: "https://publisher-one.example/",
            publishedAt: "2026-07-25T00:00:00.000Z",
          },
          {
            id: "uncovered-story",
            title: uncoveredHeadline,
            url: "https://publisher-two.example/uncovered",
            publisherName: "Publisher Two",
            publisherUrl: "https://publisher-two.example/",
            publishedAt: "2026-07-25T00:01:00.000Z",
          },
        ],
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<WorldPulseApp MapComponent={TestMap} />);
    fireEvent.click(await screen.findByRole("button", { name: "Live News" }));
    const dialog = screen.getByRole("dialog", { name: "Live News" });

    fireEvent.click(
      within(dialog).getByRole("button", {
        name: new RegExp(coveredHeadline),
      }),
    );
    expect(
      await within(dialog).findByTitle(
        `World News Live: ${coveredHeadline} live`,
      ),
    ).toBeInTheDocument();

    fireEvent.click(
      within(dialog).getByRole("button", {
        name: new RegExp(uncoveredHeadline),
      }),
    );
    expect(
      await within(dialog).findByText(
        "No active live coverage for this story",
      ),
    ).toBeInTheDocument();
    expect(within(dialog).queryByTitle(/World News Live/)).not.toBeInTheDocument();
  });

  it("limits Live Situation to the twelve strongest global stories", async () => {
    const globalArticles = Array.from({ length: 45 }, (_, index) => ({
      id: `global-${index}`,
      title: `Distinct event marker${index} topic${index} dispatch${index}`,
      url: `https://publisher-${index}.example/story`,
      publisherName: `Publisher ${index}`,
      publisherUrl: `https://publisher-${index}.example/`,
      publishedAt: "2026-07-25T00:00:00.000Z",
    }));
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/countries.geojson") {
        return Response.json({
          features: [{ id: "124", properties: { name: "Canada" } }],
        });
      }
      const countryName = url.includes("country=Canada") ? "Canada" : null;
      return Response.json({
        countryName,
        scope: countryName ? "country" : "global",
        generatedAt: "2026-07-25T00:00:00.000Z",
        refreshAfterSeconds: 600,
        provider: "Test live index",
        articles: countryName ? [] : globalArticles,
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<WorldPulseApp MapComponent={TestMap} />);
    fireEvent.click(await screen.findByRole("button", { name: "Live Situation" }));
    const dialog = screen.getByRole("dialog", { name: "Live Situation" });
    expect(within(dialog).getByText("Situation 12")).toBeInTheDocument();
    expect(within(dialog).getAllByRole("link")).toHaveLength(12);
  });

  it("automatically expands a visible event to five publishers and shows rated coverage mix", async () => {
    const headline = "Canada and Mexico agree cross-border trade accord";
    const originalArticle = {
      id: "original",
      title: headline,
      url: "https://reuters.com/original",
      publisherName: "Reuters",
      publisherUrl: "https://reuters.com/",
      publishedAt: "2026-07-25T00:00:00.000Z",
    };
    const expandedArticles = [
      originalArticle,
      {
        ...originalArticle,
        id: "ap",
        url: "https://apnews.com/ap",
        publisherName: "Associated Press",
        publisherUrl: "https://apnews.com/",
      },
      {
        ...originalArticle,
        id: "bbc",
        url: "https://bbc.com/bbc",
        publisherName: "BBC News",
        publisherUrl: "https://bbc.com/",
      },
      {
        ...originalArticle,
        id: "post",
        url: "https://nypost.com/post",
        publisherName: "New York Post",
        publisherUrl: "https://nypost.com/",
      },
      {
        ...originalArticle,
        id: "local",
        url: "https://local.example/local",
        publisherName: "Local Desk",
        publisherUrl: "https://local.example/",
      },
    ];
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/countries.geojson") {
        return Response.json({
          features: [{ id: "124", properties: { name: "Canada" } }],
        });
      }
      if (url.includes("scope=map")) {
        return liveMapResponse(url, { Canada: [originalArticle] });
      }
      if (url.includes("scope=event")) {
        return Response.json({
          countryName: "Canada",
          scope: "event",
          generatedAt: "2026-07-25T00:00:00.000Z",
          refreshAfterSeconds: 600,
          provider: "Expanded topic search",
          articles: expandedArticles,
        });
      }
      const countryName = url.includes("country=Canada") ? "Canada" : null;
      return Response.json({
        countryName,
        scope: countryName ? "country" : "global",
        generatedAt: "2026-07-25T00:00:00.000Z",
        refreshAfterSeconds: 600,
        provider: "Test live index",
        articles: countryName ? [originalArticle] : [],
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        private readonly callback: IntersectionObserverCallback;

        constructor(callback: IntersectionObserverCallback) {
          this.callback = callback;
        }

        observe(target: Element) {
          this.callback(
            [{ isIntersecting: true, target } as IntersectionObserverEntry],
            this as unknown as IntersectionObserver,
          );
        }

        disconnect() {}
      },
    );

    render(<WorldPulseApp MapComponent={TestMap} />);
    await screen.findByRole("heading", { name: headline });

    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(([input]) =>
          String(input).includes("scope=event"),
        ),
      ).toBe(true),
    );
    expect(await screen.findByText("5 independent")).toBeInTheDocument();
    expect(
      screen.getByText(/Left · center · right · 4\/5 rated/),
    ).toBeInTheDocument();
    expect(screen.getByText("Left 25%")).toBeInTheDocument();
    expect(screen.getByText("Center 50%")).toBeInTheDocument();
    expect(screen.getByText("Right 25%")).toBeInTheDocument();
    expect(
      screen.getByRole("link", {
        name: "Open Associated Press source. Publisher rating: Lean Left.",
      }),
    ).toHaveAttribute("data-bias", "left");
    expect(
      screen.getByRole("link", {
        name: "Open Reuters source. Publisher rating: Center.",
      }),
    ).toHaveAttribute("data-bias", "center");
    expect(
      screen.getByRole("link", {
        name: "Open New York Post source. Publisher rating: Lean Right.",
      }),
    ).toHaveAttribute("data-bias", "right");
    expect(
      screen.getByRole("link", {
        name: "Open Local Desk source. Publisher bias unrated.",
      }),
    ).toHaveAttribute("data-bias", "unrated");
  });

  it("shows the canonical global occurrence once in Live Situation", async () => {
    const globalHeadline =
      "Heat dome expands across central Canada, creating dangerous conditions for millions";
    const localHeadline =
      "‘Extraordinarily hot’: Canada heatwave stretches on with millions still under warnings";
    const globalArticles = [
      ["Associated Press", "https://apnews.com/"],
      ["Reuters", "https://reuters.com/"],
      ["BBC News", "https://bbc.com/"],
      ["New York Post", "https://nypost.com/"],
      ["Local Desk", "https://local.example/"],
    ].map(([publisherName, publisherUrl], index) => ({
      id: `global-heat-${index}`,
      title: globalHeadline,
      description:
        "A dangerous Canadian heat wave is affecting millions of people.",
      url: `${publisherUrl}heat-${index}`,
      publisherName,
      publisherUrl,
      publishedAt: `2026-07-25T${23 - index}:00:00.000Z`,
    }));
    const countryArticle = {
      id: "country-heat",
      title: localHeadline,
      description:
        "Millions across Canada remain under extreme heat warnings.",
      url: "https://theguardian.com/canada-heat",
      publisherName: "The Guardian",
      publisherUrl: "https://theguardian.com/",
      publishedAt: "2026-07-25T22:00:00.000Z",
    };
    const coverageArticles = [
      ...globalArticles,
      {
        ...globalArticles[0],
        id: "cnn-heat",
        url: "https://cnn.com/heat",
        publisherName: "CNN",
        publisherUrl: "https://cnn.com/",
      },
      {
        ...globalArticles[0],
        id: "bbc-alias-heat",
        url: "https://bbc.co.uk/heat",
        publisherName: "BBC",
        publisherUrl: "https://bbc.co.uk/",
      },
    ];
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/countries.geojson") {
        return Response.json({
          features: [{ id: "124", properties: { name: "Canada" } }],
        });
      }
      if (url.includes("scope=map")) {
        return liveMapResponse(url, {
          Canada: [countryArticle, ...globalArticles],
        });
      }
      if (url.includes("scope=event")) {
        return Response.json({
          countryName: "Canada",
          scope: "event",
          generatedAt: "2026-07-25T23:30:00.000Z",
          refreshAfterSeconds: 600,
          provider: "Test topic index",
          articles: coverageArticles,
        });
      }
      const countryName = url.includes("country=Canada") ? "Canada" : null;
      return Response.json({
        countryName,
        scope: countryName ? "country" : "global",
        generatedAt: "2026-07-25T23:30:00.000Z",
        refreshAfterSeconds: 600,
        provider: "Test live index",
        articles: countryName ? [countryArticle] : globalArticles,
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        private readonly callback: IntersectionObserverCallback;

        constructor(callback: IntersectionObserverCallback) {
          this.callback = callback;
        }

        observe(target: Element) {
          this.callback(
            [{ isIntersecting: true, target } as IntersectionObserverEntry],
            this as unknown as IntersectionObserver,
          );
        }

        disconnect() {}
      },
    );

    render(<WorldPulseApp MapComponent={TestMap} />);

    const countryHeading = await screen.findByRole("heading", {
      name: globalHeadline,
    });
    const countryCard = countryHeading.closest("article");
    expect(countryCard).not.toBeNull();
    expect(
      await within(countryCard!).findByText("5 shown · 7 matched"),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Live Situation" }));
    const dialog = screen.getByRole("dialog", { name: "Live Situation" });
    expect(
      within(dialog).getByRole("heading", { name: globalHeadline }),
    ).toBeInTheDocument();
    expect(within(dialog).getAllByRole("link")).toHaveLength(1);
  });

  it("filters the visible events by search", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/countries.geojson") {
        return Response.json({
          features: [{ id: "124", properties: { name: "Canada" } }],
        });
      }
      if (url.includes("scope=map")) {
        return liveMapResponse(url, {
          Canada: [
            {
              id: "canada-trade",
              title: "Canada signs a new international trade agreement",
              url: "https://publisher.example/canada-trade",
              publisherName: "Test Publisher",
              publisherUrl: "https://publisher.example/",
              publishedAt: "2026-07-25T00:00:00.000Z",
            },
          ],
        });
      }
      return Response.json({
        countryName: "Canada",
        scope: "country",
        generatedAt: "2026-07-25T00:00:00.000Z",
        refreshAfterSeconds: 600,
        provider: "Test local index",
        articles: [
          {
            id: "canada-trade",
            title: "Canada signs a new international trade agreement",
            url: "https://publisher.example/canada-trade",
            publisherName: "Test Publisher",
            publisherUrl: "https://publisher.example/",
            publishedAt: "2026-07-25T00:00:00.000Z",
          },
        ],
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<WorldPulseApp MapComponent={TestMap} />);
    await screen.findByRole("heading", {
      name: "Canada signs a new international trade agreement",
    });
    fireEvent.change(screen.getByRole("searchbox", { name: "Search news" }), {
      target: { value: "vaccine" },
    });
    expect(screen.getByText("No matching events")).toBeInTheDocument();
  });

  it("shows English by default and toggles one story back to its original language", async () => {
    const englishHeadline = "Egypt announces a new public transport plan";
    const originalHeadline = "مصر تعلن خطة جديدة للنقل العام";
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/countries.geojson") {
        return Response.json({
          features: [{ id: "818", properties: { name: "Egypt" } }],
        });
      }
      if (url.includes("scope=map")) {
        return liveMapResponse(url, {
          Egypt: [
            {
              ...liveArticleFor("Egypt"),
              title: englishHeadline,
              description: "The plan will expand service across major cities.",
              originalTitle: originalHeadline,
              originalDescription: "ستوسع الخطة الخدمة في المدن الكبرى.",
              originalLanguage: "ar",
            },
          ],
        });
      }
      return Response.json({
        countryName: null,
        scope: "global",
        generatedAt: "2026-07-25T00:00:00.000Z",
        refreshAfterSeconds: 600,
        provider: "Test live index",
        articles: [],
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<WorldPulseApp MapComponent={TestMap} />);
    await screen.findByText("Live country index complete");
    fireEvent.click(
      screen.getByRole("button", { name: "Select Egypt on map" }),
    );

    expect(
      await screen.findByRole("heading", { name: englishHeadline }),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Original · AR" }),
    );
    expect(
      screen.getByRole("heading", { name: originalHeadline }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "English" })).toBeInTheDocument();
  });

  it("opens every mapped country even when no seed news is available", () => {
    render(<WorldPulseApp MapComponent={TestMap} liveUpdates={false} />);
    fireEvent.click(
      screen.getByRole("button", { name: "Select Spain on map" }),
    );
    expect(screen.getByRole("heading", { name: "Spain" })).toBeInTheDocument();
    expect(
      screen.getByText("No recent news for Spain"),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Japan" }),
    ).not.toBeInTheDocument();
  });

  it("uses one prepared snapshot and preloads global news before opening", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/countries.geojson") {
        return Response.json({
          features: [{ id: "124", properties: { name: "Canada" } }],
        });
      }
      if (url.includes("scope=map")) {
        return liveMapResponse(url, { Canada: [] });
      }
      if (url.startsWith("/api/live-news?country=Canada")) {
        return Response.json({
          countryName: "Canada",
          scope: "country",
          generatedAt: "2026-07-25T00:00:00.000Z",
          refreshAfterSeconds: 600,
          provider: "Test local index",
          articles: [],
        });
      }
      return Response.json({
        countryName: null,
        scope: "global",
        generatedAt: "2026-07-25T00:00:00.000Z",
        refreshAfterSeconds: 600,
        provider: "Test global index",
        articles: [],
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<WorldPulseApp MapComponent={TestMap} />);

    await screen.findByText("Live country index complete");
    const requestedUrls = fetchMock.mock.calls.map(([input]) => String(input));
    expect(requestedUrls.some((url) => url.includes("scope=map"))).toBe(true);
    expect(
      requestedUrls.some((url) =>
        url.includes("/api/live-news?country="),
      ),
    ).toBe(false);
    expect(requestedUrls).toContain("/api/live-news?scope=global");
    expect(
      await screen.findByRole("button", { name: "Live Situation" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Global feed" }),
    ).not.toBeInTheDocument();
  });

  it("keeps a country neutral when prepared reporting is unavailable", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/countries.geojson") {
        return Response.json({
          features: [{ id: "124", properties: { name: "Canada" } }],
        });
      }
      if (url.includes("scope=map")) {
        return liveMapResponse(url, { Canada: [] });
      }
      if (url.includes("country=Canada")) {
        return new Response("Unavailable", { status: 503 });
      }
      return Response.json({
        countryName: null,
        scope: "global",
        generatedAt: "2026-07-25T00:00:00.000Z",
        refreshAfterSeconds: 600,
        provider: "Test global index",
        articles: [],
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<WorldPulseApp MapComponent={TestMap} />);

    expect(
      await screen.findByText("Live country index complete"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("countries-syncing")).toHaveTextContent("0");
    expect(screen.getByTestId("countries-with-news")).toHaveTextContent("0");
    expect(
      fetchMock.mock.calls.some(([input]) =>
        String(input).includes("/api/live-news?country="),
      ),
    ).toBe(false);
    expect(
      fetchMock.mock.calls.some(([input]) =>
        String(input).includes("scope=global"),
      ),
    ).toBe(true);

    fireEvent.click(
      screen.getByRole("button", { name: "Select Spain on map" }),
    );
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(([input]) => {
          const url = String(input);
          return url.includes("country=Spain") && url.includes("fresh=1");
        }),
      ).toBe(true),
    );
  });

  it("offers older indexed reporting when the default window is empty", async () => {
    const oldHeadline = "Canada opens a historic northern research archive";
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/countries.geojson") {
        return Response.json({
          features: [{ id: "124", properties: { name: "Canada" } }],
        });
      }
      if (url.includes("scope=map")) {
        return liveMapResponse(url, {
          Canada: [
            {
              id: "canada-archive",
              title: oldHeadline,
              url: "https://publisher.example/canada-archive",
              publisherName: "Archive Publisher",
              publisherUrl: "https://publisher.example/",
              publishedAt: "2026-07-01T00:00:00.000Z",
            },
          ],
        });
      }
      const countryName = url.includes("country=Canada") ? "Canada" : null;
      return Response.json({
        countryName,
        scope: countryName ? "country" : "global",
        generatedAt: "2026-07-25T00:00:00.000Z",
        refreshAfterSeconds: 600,
        provider: "Test live index",
        articles: countryName
          ? [
              {
                id: "canada-archive",
                title: oldHeadline,
                url: "https://publisher.example/canada-archive",
                publisherName: "Archive Publisher",
                publisherUrl: "https://publisher.example/",
                publishedAt: "2026-07-01T00:00:00.000Z",
              },
            ]
          : [],
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<WorldPulseApp MapComponent={TestMap} />);

    expect(
      await screen.findByRole("heading", {
        name: "No events in the last 7 days",
      }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show all stories" }));
    expect(
      screen.getByRole("heading", { name: oldHeadline }),
    ).toBeInTheDocument();
  });

  it("uses map-loaded country reporting without fetching on map click", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/countries.geojson") {
        return Response.json({
          features: [
            { id: "124", properties: { name: "Canada" } },
            { id: "686", properties: { name: "Senegal" } },
          ],
        });
      }
      if (url.includes("scope=map")) {
        return liveMapResponse(url);
      }
      const countryName = url.includes("country=Senegal")
        ? "Senegal"
        : url.includes("country=Canada")
          ? "Canada"
          : null;
      return Response.json({
        countryName,
        scope: countryName ? "country" : "global",
        generatedAt: "2026-07-25T00:00:00.000Z",
        refreshAfterSeconds: 600,
        provider: "Test live index",
        articles: countryName ? [liveArticleFor(countryName)] : [],
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<WorldPulseApp MapComponent={TestMap} />);
    await waitFor(() =>
      expect(screen.getByTestId("countries-with-news")).toHaveTextContent("2"),
    );
    const requestsBeforeClick = fetchMock.mock.calls.filter(([input]) =>
      String(input).includes("country=Senegal"),
    ).length;
    fireEvent.click(
      await screen.findByRole("button", { name: "Select Senegal on map" }),
    );

    expect(
      screen.getByRole("heading", { name: "Senegal" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", {
        name: liveArticleFor("Senegal").title,
      }),
    ).toBeInTheDocument();
    expect(
      fetchMock.mock.calls.filter(([input]) =>
        String(input).includes("country=Senegal"),
      ),
    ).toHaveLength(requestsBeforeClick);
  });

  it("opens Egypt by its numeric map id and renders Arabic reporting correctly", async () => {
    const arabicHeadline = "مصر تعلن خطة جديدة لتطوير النقل العام";
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/countries.geojson") {
        return Response.json({
          features: [
            { id: "124", properties: { name: "Canada" } },
            { id: "818", properties: { name: "Egypt" } },
          ],
        });
      }
      if (url.includes("scope=map")) {
        return liveMapResponse(url, {
          Canada: [],
          Egypt: [
            {
              id: "egypt-local",
              title: arabicHeadline,
              url: "https://publisher.example/egypt-local",
              publisherName: "صحيفة مصرية",
              publisherUrl: "https://publisher.example/",
              publishedAt: "2026-07-24T22:00:00.000Z",
            },
          ],
        });
      }
      const countryName = url.includes("country=Egypt")
        ? "Egypt"
        : url.includes("country=Canada")
          ? "Canada"
          : null;
      return Response.json({
        countryName,
        scope: countryName ? "country" : "global",
        generatedAt: "2026-07-25T00:00:00.000Z",
        refreshAfterSeconds: 600,
        provider: "Test live index",
        articles:
          countryName === "Egypt"
            ? [
                {
                  id: "egypt-local",
                  title: arabicHeadline,
                  url: "https://publisher.example/egypt-local",
                  publisherName: "صحيفة مصرية",
                  publisherUrl: "https://publisher.example/",
                  publishedAt: "2026-07-24T22:00:00.000Z",
                },
              ]
            : [],
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<WorldPulseApp MapComponent={TestMap} />);
    await screen.findByText("Live country index complete");
    const egyptRequestsBeforeClick = fetchMock.mock.calls.filter(([input]) =>
      String(input).includes("country=Egypt"),
    ).length;
    fireEvent.change(screen.getByRole("searchbox", { name: "Search news" }), {
      target: { value: "unrelated search" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Select Egypt on map" }),
    );

    expect(screen.getByRole("heading", { name: "Egypt" })).toBeInTheDocument();
    expect(
      await screen.findByRole("heading", { name: arabicHeadline }),
    ).toHaveAttribute("dir", "auto");
    expect(screen.getByRole("searchbox", { name: "Search news" })).toHaveValue(
      "",
    );
    const egyptRequestsAfterClick = fetchMock.mock.calls.filter(([input]) =>
      String(input).includes("country=Egypt"),
    );
    expect(egyptRequestsAfterClick).toHaveLength(egyptRequestsBeforeClick + 1);
    expect(
      egyptRequestsAfterClick.some(([input]) =>
        String(input).includes("fresh=1"),
      ),
    ).toBe(true);
  });

  it("keeps the loading screen up until the complete country index is ready", async () => {
    let finishMexico: (() => void) | undefined;
    const mexicoReady = new Promise<void>((resolve) => {
      finishMexico = resolve;
    });
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/countries.geojson") {
        return Response.json({
          features: [
            { id: "124", properties: { name: "Canada" } },
            { id: "840", properties: { name: "United States" } },
            { id: "250", properties: { name: "France" } },
            { id: "276", properties: { name: "Germany" } },
            { id: "380", properties: { name: "Italy" } },
            { id: "724", properties: { name: "Spain" } },
            { id: "392", properties: { name: "Japan" } },
            { id: "818", properties: { name: "Egypt" } },
            { id: "484", properties: { name: "Mexico" } },
          ],
        });
      }
      if (url.includes("scope=map")) {
        if (
          new URL(url, "https://worldpulse.test")
            .searchParams.get("countries")
            ?.includes("Mexico")
        ) {
          await mexicoReady;
        }
        return liveMapResponse(url);
      }
      return Response.json({
        countryName: null,
        scope: "global",
        generatedAt: "2026-07-25T00:00:00.000Z",
        refreshAfterSeconds: 600,
        provider: "Test live index",
        articles: [],
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<WorldPulseApp MapComponent={TestMap} />);

    expect(
      await screen.findByText("Preparing every country"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Preparing the live world" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Live Situation" }),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("countries-with-news")).not.toBeVisible();

    await act(async () => {
      finishMexico?.();
      await mexicoReady;
    });

    expect(
      await screen.findByText("Live country index complete"),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Preparing the live world" }),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("countries-with-news")).toHaveTextContent("9");
    expect(screen.getByTestId("countries-syncing")).toHaveTextContent("0");
  });

  it("finishes the live sweep without inventing a headline for an empty country", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/countries.geojson") {
        return Response.json({
          features: [{ id: "798", properties: { name: "Tuvalu" } }],
        });
      }
      if (url.includes("scope=map")) {
        return Response.json({
          scope: "map",
          generatedAt: "2026-07-25T00:00:00.000Z",
          refreshAfterSeconds: 600,
          provider: "Test live world search",
          countries: [
            {
              countryName: "Tuvalu",
              generatedAt: "2026-07-25T00:00:00.000Z",
              available: false,
              articles: [],
            },
          ],
        });
      }
      return Response.json({
        countryName: "Canada",
        scope: "country",
        generatedAt: "2026-07-25T00:00:00.000Z",
        refreshAfterSeconds: 600,
        provider: "Test live index",
        articles: [],
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<WorldPulseApp MapComponent={TestMap} />);

    expect(
      await screen.findByText("Live country index complete"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("countries-with-news")).toHaveTextContent("0");
    expect(screen.getByTestId("countries-syncing")).toHaveTextContent("0");
  });

  it("uses a source-backed live map result when the deeper country feed is empty", async () => {
    const fallbackHeadline =
      "Canada military forces clash near a disputed border base";
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/countries.geojson") {
        return Response.json({
          features: [{ id: "124", properties: { name: "Canada" } }],
        });
      }
      if (url.includes("scope=map")) {
        return liveMapResponse(url, {
          Canada: [
            {
              ...liveArticleFor("Canada"),
              id: "canada-map-conflict",
              title: fallbackHeadline,
            },
          ],
        });
      }
      return Response.json({
        countryName: "Canada",
        scope: "country",
        generatedAt: "2026-07-25T00:00:00.000Z",
        refreshAfterSeconds: 600,
        provider: "Test live index",
        articles: [],
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<WorldPulseApp MapComponent={TestMap} />);

    await screen.findByText("Live country index complete");
    expect(screen.getByTestId("countries-with-news")).toHaveTextContent("1");
    expect(screen.getByTestId("canada-map-category")).toHaveTextContent(
      "Conflict and security",
    );
    expect(screen.getByTestId("canada-map-headline")).toHaveTextContent(
      fallbackHeadline,
    );
    expect(
      screen.getByRole("heading", { name: fallbackHeadline }),
    ).toBeInTheDocument();
  });

  it("loads every mapped country live without a static snapshot", async () => {
    const mapArticle = {
      id: "senegal-music",
      title: "MUSIC AWARDS SENEGAL 2026 announced",
      url: "https://local.example/senegal-music",
      publisherName: "Local Culture Desk",
      publisherUrl: "https://local.example/",
      publishedAt: "2026-07-24T21:00:00.000Z",
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/countries.geojson") {
        return Response.json({
          features: [
            {
              id: "124",
              properties: { name: "Canada" },
            },
            {
              id: "country-57",
              properties: { name: "Senegal" },
            },
          ],
        });
      }
      if (url.includes("scope=map")) {
        return liveMapResponse(url, {
          Canada: [
            {
              ...mapArticle,
              id: "canada",
              title: "Canada music festival opens",
            },
          ],
          Senegal: [mapArticle],
        });
      }
      const countryName = url.includes("country=Senegal")
        ? "Senegal"
        : url.includes("country=Canada")
          ? "Canada"
          : null;
      return Response.json({
        countryName,
        scope: countryName ? "country" : "global",
        generatedAt: "2026-07-25T00:00:00.000Z",
        refreshAfterSeconds: 600,
        provider: "Test live index",
        articles: countryName
          ? [
              countryName === "Senegal"
                ? mapArticle
                : {
                    ...mapArticle,
                    id: "canada",
                    title: "Canada music festival opens",
                  },
            ]
          : [],
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<WorldPulseApp MapComponent={TestMap} />);

    await waitFor(() =>
      expect(
        screen.getByText("Live country index complete"),
      ).toBeInTheDocument(),
    );
    expect(screen.getByTestId("countries-with-news")).toHaveTextContent("2");
    expect(screen.getByTestId("countries-syncing")).toHaveTextContent("0");
    const mapRequestUrls = fetchMock.mock.calls
      .map(([input]) => String(input))
      .filter((url) => url.includes("scope=map"));
    expect(mapRequestUrls.length).toBeGreaterThan(0);
    expect(
      mapRequestUrls.every(
        (url) =>
          new URL(url, "https://worldpulse.test").searchParams.has("fresh") ===
          false,
      ),
    ).toBe(true);
    expect(
      fetchMock.mock.calls.some(([input]) =>
        String(input).includes("map-news-summary"),
      ),
    ).toBe(false);

    fireEvent.click(
      screen.getByRole("button", { name: "Select Senegal on map" }),
    );
    expect(
      await screen.findByRole("heading", {
        name: "MUSIC AWARDS SENEGAL 2026 announced",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getAllByText("Culture and entertainment").length,
    ).toBeGreaterThan(0);
    await waitFor(
      () =>
        expect(
          fetchMock.mock.calls.some(([input]) =>
            String(input).includes("scope=map"),
          ),
        ).toBe(true),
      { timeout: 3_000 },
    );
  });

  it("gives every real map country a live categorized top event before a click", async () => {
    const geojson = JSON.parse(
      readFileSync(resolve("public/countries.geojson"), "utf8"),
    );
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/countries.geojson") return Response.json(geojson);
      if (url.includes("scope=map")) {
        return liveMapResponse(url);
      }
      const countryName = new URL(
        url,
        "https://worldpulse.test",
      ).searchParams.get("country");
      return Response.json({
        countryName,
        scope: countryName ? "country" : "global",
        generatedAt: "2026-07-25T00:00:00.000Z",
        refreshAfterSeconds: 600,
        provider: "Test live index",
        articles: countryName ? [liveArticleFor(countryName)] : [],
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<WorldPulseApp MapComponent={TestMap} />);

    await waitFor(() =>
      expect(screen.getByTestId("countries-with-news")).toHaveTextContent(
        "215",
      ),
      { timeout: 15_000 },
    );
    expect(
      screen.getByText("Live country index complete"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("countries-syncing")).toHaveTextContent("0");
    expect(
      screen.getByTestId("countries-with-valid-color-contract"),
    ).toHaveTextContent("215");
  }, 20_000);

  it("keeps the map signal aligned when a selected country is refreshed", async () => {
    const mapHeadline = "Canada trade exports rise after a new market agreement";
    const countryHeadline =
      "Canada military forces clash near a disputed border base";
    let resolveCountryFeed:
      | ((response: Response) => void)
      | undefined;
    const countryFeedResponse = new Promise<Response>((resolve) => {
      resolveCountryFeed = resolve;
    });
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/countries.geojson") {
        return Response.json({
          features: [{ id: "124", properties: { name: "Canada" } }],
        });
      }
      if (url.includes("scope=map")) {
        return liveMapResponse(url, {
          Canada: [
            {
              ...liveArticleFor("Canada"),
              id: "canada-map-economy",
              title: mapHeadline,
              publishedAt: "2026-07-25T00:00:00.000Z",
            },
          ],
        });
      }
      if (url.includes("scope=global")) {
        return Response.json({
          countryName: null,
          scope: "global",
          generatedAt: "2026-07-25T02:00:00.000Z",
          refreshAfterSeconds: 600,
          provider: "Test live index",
          articles: [],
        });
      }
      return countryFeedResponse;
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<WorldPulseApp MapComponent={TestMap} />);

    await screen.findByText("Live country index complete");
    expect(
      screen.getByRole("heading", { name: mapHeadline }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("canada-map-category")).toHaveTextContent(
      "Economy",
    );
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await act(async () => {
      resolveCountryFeed?.(
        Response.json({
          countryName: "Canada",
          scope: "country",
          generatedAt: "2026-07-25T02:00:00.000Z",
          refreshAfterSeconds: 600,
          provider: "Test live index",
          articles: [
            {
              ...liveArticleFor("Canada"),
              id: "canada-country-conflict",
              title: countryHeadline,
              publishedAt: "2026-07-25T01:00:00.000Z",
            },
          ],
        }),
      );
      await countryFeedResponse;
    });
    expect(
      await screen.findByRole("heading", { name: countryHeadline }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("canada-map-category")).toHaveTextContent(
      "Conflict and security",
    );
    expect(screen.getByTestId("canada-map-headline")).toHaveTextContent(
      countryHeadline,
    );
    expect(
      screen.getByText("Live country index complete"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("countries-syncing")).toHaveTextContent("0");

    fireEvent.click(screen.getByRole("button", { name: "Live Situation" }));
    fireEvent.click(
      within(screen.getByRole("dialog", { name: "Live Situation" })).getByRole(
        "button",
        { name: "Close" },
      ),
    );
    expect(screen.getByTestId("canada-map-category")).toHaveTextContent(
      "Conflict and security",
    );
  });

  it("keeps Australia's top-story color category stable through selection", async () => {
    const mapHeadline =
      "Australia airport opens a new international travel route";
    const deepHeadline =
      "Australia parliament schedules a national election";
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/countries.geojson") {
        return Response.json({
          features: [
            { id: "036", properties: { name: "Australia" } },
            { id: "124", properties: { name: "Canada" } },
          ],
        });
      }
      if (url.includes("scope=map")) {
        return liveMapResponse(url, {
          Australia: [
            {
              ...liveArticleFor("Australia"),
              id: "australia-map-travel",
              title: mapHeadline,
              publishedAt: "2026-07-25T02:00:00.000Z",
            },
          ],
        });
      }
      const countryName = new URL(
        url,
        "https://worldpulse.test",
      ).searchParams.get("country");
      return Response.json({
        countryName,
        scope: "country",
        generatedAt: "2026-07-25T02:00:00.000Z",
        refreshAfterSeconds: 600,
        provider: "Test live index",
        articles:
          countryName === "Australia"
            ? [
                {
                  ...liveArticleFor("Australia"),
                  id: "australia-deep-politics",
                  title: deepHeadline,
                  publishedAt: "2026-07-25T00:00:00.000Z",
                },
              ]
            : countryName
              ? [liveArticleFor(countryName)]
              : [],
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<WorldPulseApp MapComponent={TestMap} />);

    await waitFor(() =>
      expect(screen.getByTestId("australia-map-category")).toHaveTextContent(
        "Travel and transport",
      ),
    );
    expect(screen.getByTestId("australia-map-headline")).toHaveTextContent(
      mapHeadline,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Select Australia on map" }),
    );
    expect(
      await screen.findByRole("heading", { name: mapHeadline }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("australia-map-category")).toHaveTextContent(
      "Travel and transport",
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Select Japan on map" }),
    );
    expect(screen.getByTestId("australia-map-category")).toHaveTextContent(
      "Travel and transport",
    );
    expect(screen.getByTestId("australia-map-headline")).toHaveTextContent(
      mapHeadline,
    );
  });
});
