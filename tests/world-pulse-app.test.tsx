import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { WorldPulseApp } from "@/components/world-pulse-app";
import type { WorldMapProps } from "@/components/world-map";
import { countryPulses } from "@/lib/seed-data";

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
  return (
    <>
      <span>{statusLabel}</span>
      <span data-testid="countries-with-news">
        {countries.filter((country) => country.topEvent).length}
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

    fireEvent.click(screen.getByRole("button", { name: "Map view" }));
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
      if (url === "/map-news-seed.json") {
        return Response.json({
          scope: "map",
          generatedAt: "2026-07-25T00:00:00.000Z",
          refreshAfterSeconds: 600,
          provider: "Test map preload",
          countries: [
            {
              countryName: "Canada",
              generatedAt: "2026-07-25T00:00:00.000Z",
              available: true,
              articles: countryArticles,
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
      if (url === "/map-news-seed.json") {
        return Response.json({
          scope: "map",
          generatedAt: "2026-07-25T00:00:00.000Z",
          refreshAfterSeconds: 600,
          provider: "Test map preload",
          countries: [],
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
    fireEvent.click(screen.getByRole("button", { name: "Global feed" }));

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

  it("expands a selected event to five publishers and shows rated coverage mix", async () => {
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
      if (url === "/map-news-seed.json") {
        return Response.json({
          scope: "map",
          generatedAt: "2026-07-25T00:00:00.000Z",
          refreshAfterSeconds: 600,
          provider: "Test preload",
          countries: [
            {
              countryName: "Canada",
              generatedAt: "2026-07-25T00:00:00.000Z",
              available: true,
              articles: [originalArticle],
            },
          ],
        });
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

    render(<WorldPulseApp MapComponent={TestMap} />);
    fireEvent.click(await screen.findByRole("heading", { name: headline }));

    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(([input]) =>
          String(input).includes("scope=event"),
        ),
      ).toBe(true),
    );
    expect(await screen.findByText("5 independent")).toBeInTheDocument();
    expect(screen.getByText("4/5 rated")).toBeInTheDocument();
    expect(screen.getByText("Left 25%")).toBeInTheDocument();
    expect(screen.getByText("Center 50%")).toBeInTheDocument();
    expect(screen.getByText("Right 25%")).toBeInTheDocument();
  });

  it("filters the visible events by search", () => {
    render(<WorldPulseApp liveUpdates={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Global feed" }));
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

  it("loads the global index and only the selected country's local index at startup", async () => {
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
      expect(fetchMock).toHaveBeenCalledWith("/api/live-news?scope=global"),
    );
    const requestedUrls = fetchMock.mock.calls.map(([input]) => String(input));
    const countryRequests = requestedUrls.filter((url) =>
      url.includes("/api/live-news?country="),
    );
    expect(countryRequests).toEqual([
      "/api/live-news?country=Canada&iso2=CA",
    ]);
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
      screen.getByRole("button", { name: "Select Senegal on map" }),
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
    fireEvent.click(screen.getByRole("button", { name: "Global feed" }));
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

  it("keeps Egypt's fresh preload when a deeper live query is stale", async () => {
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
      if (url === "/map-news-seed.json") {
        return Response.json({
          scope: "map",
          generatedAt: "2026-07-25T00:00:00.000Z",
          refreshAfterSeconds: 600,
          provider: "Test map preload",
          countries: [
            {
              countryName: "Canada",
              generatedAt: "2026-07-25T00:00:00.000Z",
              available: true,
              articles: [],
            },
            {
              countryName: "Egypt",
              generatedAt: "2026-07-25T00:00:00.000Z",
              available: true,
              articles: [
                {
                  id: "egypt-current",
                  title: currentEgyptHeadline,
                  url: "https://publisher.example/egypt-current",
                  publisherName: "صحيفة مصرية",
                  publisherUrl: "https://publisher.example/",
                  publishedAt: "2026-07-24T22:00:00.000Z",
                },
              ],
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
    await screen.findByText(/2\/2 countries loaded/);
    fireEvent.click(
      screen.getByRole("button", { name: "Select Egypt on map" }),
    );

    expect(await screen.findByText(currentEgyptHeadline)).toBeInTheDocument();
    expect(
      screen.queryByText("An old Egyptian archive feature"),
    ).not.toBeInTheDocument();
  });

  it("preloads mapped countries before they are clicked", async () => {
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
      if (url === "/map-news-seed.json" || url.includes("scope=map")) {
        return Response.json({
          scope: "map",
          generatedAt: "2026-07-25T00:00:00.000Z",
          refreshAfterSeconds: 600,
          provider: "Test map preload",
          countries: [
            {
              countryName: "Canada",
              generatedAt: "2026-07-25T00:00:00.000Z",
              available: true,
              articles: [{ ...mapArticle, id: "canada", title: "Canada music festival opens" }],
            },
            {
              countryName: "Senegal",
              generatedAt: "2026-07-25T00:00:00.000Z",
              available: true,
              articles: [mapArticle],
            },
          ],
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
        screen.getByText(/2\/2 countries loaded/),
      ).toBeInTheDocument(),
    );
    expect(screen.getByTestId("countries-with-news")).toHaveTextContent("2");

    fireEvent.click(
      screen.getByRole("button", { name: "Select Senegal on map" }),
    );
    expect(
      await screen.findByText("MUSIC AWARDS SENEGAL 2026 announced"),
    ).toBeInTheDocument();
    expect(
      screen.getAllByText("Culture and entertainment").length,
    ).toBeGreaterThan(0);
  });

  it("gives every real map country a categorized top event before a click", async () => {
    const geojson = JSON.parse(
      readFileSync(resolve("public/countries.geojson"), "utf8"),
    );
    const mapSnapshot = JSON.parse(
      readFileSync(resolve("public/map-news-seed.json"), "utf8"),
    );
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/countries.geojson") return Response.json(geojson);
      if (url === "/map-news-seed.json" || url.includes("scope=map")) {
        return Response.json(mapSnapshot);
      }
      const countryName = url.includes("country=Canada") ? "Canada" : null;
      return Response.json({
        countryName,
        scope: countryName ? "country" : "global",
        generatedAt: mapSnapshot.generatedAt,
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
    expect(screen.getByText(/215\/215 countries loaded/)).toBeInTheDocument();
  }, 20_000);
});
