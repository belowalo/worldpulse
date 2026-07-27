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
import { countryPulses } from "@/lib/seed-data";

type TestLiveArticle = {
  id: string;
  title: string;
  description?: string;
  url: string;
  publisherName: string;
  publisherUrl: string;
  publishedAt: string;
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
  return (
    <>
      <span>{statusLabel}</span>
      <span data-testid="countries-with-news">
        {countries.filter((country) => country.topEvent).length}
      </span>
      <span data-testid="canada-map-category">
        {canada?.topEvent?.category ?? ""}
      </span>
      <span data-testid="canada-map-headline">
        {canada?.topEvent?.headline ?? ""}
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

  it("clears the country highlight in global feed and restores it in map view", () => {
    render(<WorldPulseApp MapComponent={TestMap} liveUpdates={false} />);
    fireEvent.click(
      screen.getByRole("button", { name: "Select Japan on map" }),
    );
    expect(screen.getByTestId("selected-map-id")).toHaveTextContent("392");

    fireEvent.click(screen.getByRole("button", { name: "Global feed" }));
    expect(screen.getByTestId("selected-map-id")).toBeEmptyDOMElement();

    fireEvent.click(screen.getByRole("button", { name: "Country feed" }));
    expect(screen.getByTestId("selected-map-id")).toHaveTextContent("392");
  });

  it("shows all country connections until a specific event is selected", async () => {
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

    await waitFor(() =>
      expect(
        screen
          .getByTestId("link-event-ids")
          .textContent?.split(",")
          .filter(Boolean).length,
      ).toBeGreaterThan(1),
    );

    fireEvent.click(
      await screen.findByRole("heading", { name: tradeHeadline }),
    );
    expect(
      screen.getByTestId("link-event-ids").textContent?.split(",").filter(Boolean),
    ).toHaveLength(1);

    fireEvent.click(
      screen.getByRole("heading", { name: tradeHeadline }),
    );
    expect(
      screen.getByTestId("link-event-ids").textContent?.split(",").filter(Boolean)
        .length,
    ).toBeGreaterThan(1);
  });

  it("keeps global connections hidden until an event is selected", async () => {
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
      const countryName = url.includes("country=Canada") ? "Canada" : null;
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
                publisherName: "Test Publisher",
                publisherUrl: "https://publisher.example/",
                publishedAt: "2026-07-25T00:00:00.000Z",
              },
            ],
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<WorldPulseApp MapComponent={TestMap} />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Global feed" }),
    );

    expect(screen.getByTestId("link-event-ids")).toBeEmptyDOMElement();
    fireEvent.click(
      await screen.findByRole("heading", { name: headline }),
    );
    expect(screen.getByTestId("link-event-ids")).not.toBeEmptyDOMElement();
    expect(
      screen.queryByRole("button", { name: /connections/i }),
    ).not.toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("heading", { name: headline }),
    );
    expect(screen.getByTestId("link-event-ids")).toBeEmptyDOMElement();
  });

  it("renders a large global index progressively without hiding results from filters", async () => {
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
        return Response.json({ features: [] });
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
    fireEvent.click(
      await screen.findByRole("button", { name: "Global feed" }),
    );

    expect(
      await screen.findByText("Showing 40 of 45 matching events"),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("article")).toHaveLength(40);
    fireEvent.click(screen.getByRole("button", { name: "Load 40 more" }));
    expect(screen.getAllByRole("article")).toHaveLength(45);
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

  it("uses the same canonical event score and bias mix in country and global views", async () => {
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
        return liveMapResponse(url, { Canada: [countryArticle] });
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
      name: localHeadline,
    });
    const countryCard = countryHeading.closest("article");
    expect(countryCard).not.toBeNull();
    expect(
      await within(countryCard!).findByText("5 shown · 7 matched"),
    ).toBeInTheDocument();
    const countryScore = within(countryCard!).getByText(
      /^(Major|Significant|Developing|Routine) · \d+$/,
    ).textContent;
    const countryMix = within(countryCard!).getByText(/\d+\/5 rated/).textContent;

    fireEvent.click(screen.getByRole("button", { name: "Global feed" }));

    const globalCard = (
      await screen.findByRole("heading", { name: globalHeadline })
    ).closest("article");
    expect(globalCard).not.toBeNull();
    expect(
      within(globalCard!).getByText(countryScore ?? ""),
    ).toBeInTheDocument();
    expect(within(globalCard!).getByText(countryMix ?? "")).toBeInTheDocument();
  });

  it("filters the visible events by search", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/countries.geojson") {
        return Response.json({ features: [] });
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

  it("opens every mapped country even when no seed news is available", () => {
    render(<WorldPulseApp MapComponent={TestMap} liveUpdates={false} />);
    fireEvent.click(
      screen.getByRole("button", { name: "Select Spain on map" }),
    );
    expect(screen.getByRole("heading", { name: "Spain" })).toBeInTheDocument();
    expect(
      screen.getByText("No indexed news for Spain"),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Japan" }),
    ).not.toBeInTheDocument();
  });

  it("loads only the selected country at startup and defers global news until opened", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/countries.geojson") {
        return Response.json({ features: [] });
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

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/live-news?country=Canada&iso2=CA",
      ),
    );
    const requestedUrls = fetchMock.mock.calls.map(([input]) => String(input));
    const countryRequests = requestedUrls.filter((url) =>
      url.includes("/api/live-news?country="),
    );
    expect(countryRequests).toEqual([
      "/api/live-news?country=Canada&iso2=CA",
    ]);
    expect(requestedUrls).not.toContain("/api/live-news?scope=global");

    fireEvent.click(
      await screen.findByRole("button", { name: "Global feed" }),
    );
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith("/api/live-news?scope=global"),
    );
  });

  it("retries a failed country feed without calling the global endpoint", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/countries.geojson") {
        return Response.json({ features: [] });
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
      await screen.findByRole("heading", { name: "Live feed unavailable" }),
    ).toBeInTheDocument();
    fetchMock.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/live-news?country=Canada&iso2=CA",
      ),
    );
    expect(
      fetchMock.mock.calls.some(([input]) =>
        String(input).includes("scope=global"),
      ),
    ).toBe(false);
  });

  it("offers older indexed reporting when the default window is empty", async () => {
    const oldHeadline = "Canada opens a historic northern research archive";
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/countries.geojson") {
        return Response.json({ features: [] });
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
    fireEvent.click(screen.getByRole("button", { name: "Show all indexed" }));
    expect(
      screen.getByRole("heading", { name: oldHeadline }),
    ).toBeInTheDocument();
  });

  it("loads country-local reporting when a country is selected on the map", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/countries.geojson") {
        return Response.json({ features: [] });
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
        articles: [],
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<WorldPulseApp MapComponent={TestMap} />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Select Senegal on map" }),
    );

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/live-news?country=Senegal&iso2=SN",
      ),
    );
    expect(
      screen.getByRole("heading", { name: "Senegal" }),
    ).toBeInTheDocument();
  });

  it("opens Egypt by its numeric map id and renders Arabic reporting correctly", async () => {
    const arabicHeadline = "مصر تعلن خطة جديدة لتطوير النقل العام";
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/countries.geojson") {
        return Response.json({ features: [] });
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
    fireEvent.click(
      await screen.findByRole("button", { name: "Global feed" }),
    );
    fireEvent.change(screen.getByRole("searchbox", { name: "Search news" }), {
      target: { value: "unrelated search" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Select Egypt on map" }),
    );

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/live-news?country=Egypt&iso2=EG",
      ),
    );
    expect(screen.getByRole("heading", { name: "Egypt" })).toBeInTheDocument();
    expect(
      await screen.findByRole("heading", { name: arabicHeadline }),
    ).toHaveAttribute("dir", "auto");
    expect(screen.getByRole("searchbox", { name: "Search news" })).toHaveValue(
      "",
    );
  });

  it("keeps Egypt's fresh world-index result when a deeper live query is stale", async () => {
    const currentEgyptHeadline = "مصر تعلن خطة حديثة للنقل العام";
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/countries.geojson") {
        return Response.json({
          features: [
            { id: "124", properties: { name: "Canada" } },
            { id: 818, properties: { name: "Egypt" } },
          ],
        });
      }
      if (url.includes("scope=map")) {
        return liveMapResponse(url, {
          Egypt: [
            {
              id: "egypt-current",
              title: currentEgyptHeadline,
              url: "https://publisher.example/egypt-current",
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
          countryName === "Egypt" || countryName === null
            ? [
                {
                  id:
                    countryName === "Egypt"
                      ? "egypt-stale"
                      : "egypt-global-stale",
                  title:
                    countryName === "Egypt"
                      ? "An old Egyptian archive feature"
                      : "Egypt archive retrospective",
                  url:
                    countryName === "Egypt"
                      ? "https://publisher.example/egypt-stale"
                      : "https://publisher.example/egypt-global-stale",
                  publisherName: "Archive",
                  publisherUrl: "https://publisher.example/",
                  publishedAt: "2026-06-01T00:00:00.000Z",
                },
              ]
            : [],
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<WorldPulseApp MapComponent={TestMap} />);
    await screen.findByText(/2\/2 source-backed country signals/);
    fireEvent.click(
      screen.getByRole("button", { name: "Select Egypt on map" }),
    );

    expect(await screen.findByText(currentEgyptHeadline)).toBeInTheDocument();
    expect(
      screen.queryByText("An old Egyptian archive feature"),
    ).not.toBeInTheDocument();
  });

  it("keeps the interface behind a live source-check screen until the initial snapshot is complete", async () => {
    let finishSecondBatch: (() => void) | undefined;
    const secondBatchReady = new Promise<void>((resolve) => {
      finishSecondBatch = resolve;
    });
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/countries.geojson") {
        return Response.json({
          features: [
            { id: "124", properties: { name: "Canada" } },
            { id: "484", properties: { name: "Mexico" } },
            { id: "686", properties: { name: "Senegal" } },
            { id: "392", properties: { name: "Japan" } },
            { id: "076", properties: { name: "Brazil" } },
            { id: "032", properties: { name: "Argentina" } },
            { id: "152", properties: { name: "Chile" } },
            { id: "604", properties: { name: "Peru" } },
            { id: "724", properties: { name: "Spain" } },
            { id: "250", properties: { name: "France" } },
            { id: "276", properties: { name: "Germany" } },
            { id: "380", properties: { name: "Italy" } },
            { id: "404", properties: { name: "Kenya" } },
            { id: "818", properties: { name: "Egypt" } },
            { id: "356", properties: { name: "India" } },
            { id: "036", properties: { name: "Australia" } },
          ],
        });
      }
      if (url.includes("scope=map")) {
        const requestedCountries = new URL(
          url,
          "https://worldpulse.test",
        ).searchParams.get("countries");
        if (requestedCountries?.includes("Spain")) await secondBatchReady;
        return liveMapResponse(url);
      }
      const countryName = url.includes("country=Canada") ? "Canada" : null;
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

    expect(
      screen.getByRole("heading", {
        name: "Checking live world reporting",
      }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Global feed" }),
    ).not.toBeInTheDocument();
    expect(await screen.findByText(/8\/16 countries checked/)).toBeInTheDocument();

    await act(async () => {
      finishSecondBatch?.();
      await secondBatchReady;
    });

    expect(
      await screen.findByRole("button", { name: "Global feed" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/16\/16 source-backed country signals/),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", {
        name: "Checking live world reporting",
      }),
    ).not.toBeInTheDocument();
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
      await screen.findByText(/0\/1 source-backed country signals/),
    ).toBeInTheDocument();
    expect(screen.getByTestId("countries-with-news")).toHaveTextContent("0");
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
        articles: countryName === "Senegal" ? [mapArticle] : [],
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<WorldPulseApp MapComponent={TestMap} />);

    await waitFor(() =>
      expect(
        screen.getByText(/2\/2 source-backed country signals/),
      ).toBeInTheDocument(),
    );
    expect(screen.getByTestId("countries-with-news")).toHaveTextContent("2");
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
      await screen.findByText("MUSIC AWARDS SENEGAL 2026 announced"),
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
      const countryName = url.includes("country=Canada") ? "Canada" : null;
      return Response.json({
        countryName,
        scope: countryName ? "country" : "global",
        generatedAt: "2026-07-25T00:00:00.000Z",
        refreshAfterSeconds: 600,
        provider: "Test live index",
        articles: [],
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
      screen.getByText(/215\/215 source-backed country signals/),
    ).toBeInTheDocument();
  }, 20_000);

  it("keeps the map signal aligned with the deeper country feed after it loads", async () => {
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
      return countryFeedResponse;
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<WorldPulseApp MapComponent={TestMap} />);

    await screen.findByText(/1\/1 source-backed country signals/);
    expect(screen.getByTestId("canada-map-category")).toHaveTextContent(
      "Economy",
    );
    expect(screen.getByTestId("canada-map-headline")).toHaveTextContent(
      mapHeadline,
    );
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

    fireEvent.click(screen.getByRole("button", { name: "Global feed" }));
    expect(screen.getByTestId("canada-map-category")).toHaveTextContent(
      "Conflict and security",
    );
  });
});
