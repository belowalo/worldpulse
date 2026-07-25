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

function TestMap({ countries, onSelect, statusLabel }: WorldMapProps) {
  const japan = countryPulses.find((country) => country.iso2 === "JP");
  const egypt = countryPulses.find((country) => country.iso2 === "EG");
  return (
    <>
      <span>{statusLabel}</span>
      <span data-testid="countries-with-news">
        {countries.filter((country) => country.topEvent).length}
      </span>
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
    );
    expect(screen.getByText(/215\/215 countries loaded/)).toBeInTheDocument();
  });
});
