import { act, fireEvent, render, screen } from "@testing-library/react";
import { useLayoutEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { WorldPulseApp } from "@/components/world-pulse-app";
import type { WorldMapProps } from "@/components/world-map-maplibre";
import type {
  LiveArticle,
  LiveWorldNewsPayload,
} from "@/lib/types";

type TestCountry = { mapId: string; name: string; iso2?: string };

const generatedAt = "2026-08-21T20:00:00.000Z";
const countries: TestCountry[] = [
  { mapId: "124", name: "Canada", iso2: "CA" },
  { mapId: "364", name: "Iran", iso2: "IR" },
];

function articleFor(countryName: string, suffix = "current national update") {
  const slug = `${countryName}-${suffix}`.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return {
    id: slug,
    title: `${countryName} ${suffix}`,
    description: `Current reporting from ${countryName}.`,
    url: `https://publisher.example/${slug}`,
    publisherName: "Test Publisher",
    publisherUrl: "https://publisher.example/",
    publishedAt: generatedAt,
  } satisfies LiveArticle;
}

function liveWorld(
  articlesByCountry: Record<string, LiveArticle[]>,
  worldGeneratedAt = generatedAt,
): LiveWorldNewsPayload {
  return {
    scope: "world-live",
    generatedAt: worldGeneratedAt,
    refreshAfterSeconds: 60,
    provider: "Test live world",
    global: {
      scope: "global",
      countryName: null,
      generatedAt: worldGeneratedAt,
      refreshAfterSeconds: 60,
      provider: "Test global",
      articles: [],
    },
    countries: countries.map((country) => ({
      countryName: country.name,
      generatedAt: worldGeneratedAt,
      available: Boolean(articlesByCountry[country.name]?.length),
      articles: articlesByCountry[country.name] ?? [],
    })),
  };
}

function geometryResponse() {
  return Response.json({
    features: countries.map((country) => ({
      id: country.mapId,
      properties: { name: country.name },
    })),
  });
}

function TestMap({
  countries: mapCountries,
  onSelect,
  onReady,
  readyForDisplay,
  statusLabel,
}: WorldMapProps) {
  useLayoutEffect(() => {
    if (readyForDisplay) onReady?.();
  }, [onReady, readyForDisplay]);
  return (
    <section aria-label="Test world map">
      <span>{statusLabel}</span>
      <span data-testid="country-count">{mapCountries.length}</span>
      <span data-testid="countries-with-news">
        {mapCountries.filter((country) => country.topEvent).length}
      </span>
      {mapCountries.map((country) => (
        <button
          key={country.mapId}
          type="button"
          onClick={() => onSelect(country)}
        >
          Select {country.name} on map
        </button>
      ))}
    </section>
  );
}

beforeEach(() => {
  vi.setSystemTime(new Date(generatedAt));
});

afterEach(() => {
  Reflect.deleteProperty(document, "hidden");
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Hemisphere Herald live country delivery", () => {
  it("opens a country camera panel from the selected-country sidebar", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("mode=country-cameras")) {
        return Response.json({
          mode: "country-cameras",
          countryName: "Canada",
          capitalName: "Ottawa",
          generatedAt,
          videos: [],
        });
      }
      return new Response("Unexpected request", { status: 500 });
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<WorldPulseApp MapComponent={TestMap} liveUpdates={false} />);

    fireEvent.click(screen.getByRole("button", {
      name: "Open live cameras for Canada",
    }));

    expect(
      await screen.findByRole("heading", { name: "See Canada live" }),
    ).toBeInTheDocument();
    expect(
      await screen.findByRole("heading", {
        name: "No live cameras are available for Canada",
      }),
    ).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining(
        "mode=country-cameras&country=Canada",
      ),
      expect.objectContaining({ cache: "no-store" }),
    );
  });

  it("keeps non-live embeds interactive without network access", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<WorldPulseApp MapComponent={TestMap} liveUpdates={false} />);

    expect(screen.getByRole("heading", { name: "Canada" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Select Japan on map" }));
    expect(screen.getByRole("heading", { name: "Japan" })).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps the news drawer mounted while sliding it closed and open", () => {
    vi.stubGlobal("fetch", vi.fn());
    render(<WorldPulseApp MapComponent={TestMap} liveUpdates={false} />);

    const panel = document.getElementById("country-news-panel");
    expect(panel).toHaveAttribute("aria-hidden", "false");
    expect(panel).toHaveClass("translate-x-0");

    fireEvent.click(screen.getByRole("button", { name: "Hide news panel" }));

    expect(panel).toHaveAttribute("aria-hidden", "true");
    expect(panel).toHaveAttribute("inert");
    expect(panel).toHaveClass("lg:translate-x-full");
    expect(
      screen.getByRole("button", { name: "Show news panel" }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Show news panel" }));

    expect(panel).toHaveAttribute("aria-hidden", "false");
    expect(panel).not.toHaveAttribute("inert");
    expect(panel).toHaveClass("translate-x-0");
  });

  it("loads the direct live-world index and never requests a snapshot", async () => {
    const world = liveWorld({
      Canada: [articleFor("Canada")],
      Iran: [articleFor("Iran")],
    });
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/countries.geojson") return geometryResponse();
      if (url.includes("scope=world-live")) return Response.json(world);
      return new Response("Unexpected request", { status: 500 });
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<WorldPulseApp MapComponent={TestMap} />);

    await screen.findByText("Live country index complete");
    expect(screen.getByTestId("country-count")).toHaveTextContent("2");
    expect(screen.getByTestId("countries-with-news")).toHaveTextContent("2");
    expect(
      fetchMock.mock.calls.some(([input]) =>
        String(input).includes("scope=prepared-world"),
      ),
    ).toBe(false);
    expect(
      fetchMock.mock.calls.some(([input]) =>
        String(input).includes("scope=world-live"),
      ),
    ).toBe(true);
  });

  it("replaces the current feed and prevents overlapping refresh work", async () => {
    const oldArticle = articleFor("Canada", "old report to replace");
    const newArticle = articleFor("Canada", "new current report");
    const firstWorld = liveWorld({ Canada: [oldArticle], Iran: [] });
    const secondWorld = liveWorld(
      { Canada: [newArticle], Iran: [] },
      "2026-08-21T20:01:00.000Z",
    );
    let refresh: (() => void) | undefined;
    let resolveRefresh: ((response: Response) => void) | undefined;
    let worldRequestCount = 0;
    vi.spyOn(window, "setInterval").mockImplementation((handler) => {
      refresh = handler as () => void;
      return 1 as unknown as ReturnType<typeof setInterval>;
    });
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/countries.geojson") return geometryResponse();
      if (url.includes("scope=world-live")) {
        worldRequestCount += 1;
        if (worldRequestCount === 1) return Response.json(firstWorld);
        return new Promise<Response>((resolve) => {
          resolveRefresh = resolve;
        });
      }
      return new Response("Unexpected request", { status: 500 });
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<WorldPulseApp MapComponent={TestMap} />);
    await screen.findByRole("heading", { name: oldArticle.title });

    act(() => {
      refresh?.();
      refresh?.();
    });
    expect(worldRequestCount).toBe(2);

    await act(async () => {
      resolveRefresh?.(Response.json(secondWorld));
    });
    expect(
      await screen.findByRole("heading", { name: newArticle.title }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: oldArticle.title }),
    ).toBeNull();
  });

  it("pauses live refreshes while the tab is hidden", async () => {
    const world = liveWorld({ Canada: [articleFor("Canada")], Iran: [] });
    let refresh: (() => void) | undefined;
    let worldRequestCount = 0;
    vi.spyOn(window, "setInterval").mockImplementation((handler) => {
      refresh = handler as () => void;
      return 1 as unknown as ReturnType<typeof setInterval>;
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url === "/countries.geojson") return geometryResponse();
        if (url.includes("scope=world-live")) {
          worldRequestCount += 1;
          return Response.json(world);
        }
        return new Response("Unexpected request", { status: 500 });
      }),
    );
    render(<WorldPulseApp MapComponent={TestMap} />);
    await screen.findByText("Live country index complete");
    expect(worldRequestCount).toBe(1);

    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: true,
    });
    act(() => refresh?.());

    expect(worldRequestCount).toBe(1);
  });

  it("uses the server-held country feed without fetching providers on click", async () => {
    const oldIran = articleFor("Iran", "older policy report");
    const world = liveWorld({
      Canada: [articleFor("Canada")],
      Iran: [oldIran],
    });
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/countries.geojson") return geometryResponse();
      if (url.includes("scope=world-live")) return Response.json(world);
      return new Response("Unexpected request", { status: 500 });
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<WorldPulseApp MapComponent={TestMap} />);
    await screen.findByText("Live country index complete");

    fireEvent.click(screen.getByRole("button", { name: "Select Iran on map" }));

    expect(
      await screen.findByRole("heading", { name: oldIran.title }),
    ).toBeInTheDocument();
    expect(
      fetchMock.mock.calls.some(([input]) => {
        const url = String(input);
        return url.includes("scope=country") || url.includes("fresh=1");
      }),
    ).toBe(false);
  });

  it("filters loaded live stories without another world request", async () => {
    const economy = articleFor("Canada", "trade exports rise sharply");
    const culture = articleFor("Canada", "music awards name winners");
    const world = liveWorld({ Canada: [economy, culture], Iran: [] });
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/countries.geojson") return geometryResponse();
      if (url.includes("scope=world-live")) return Response.json(world);
      return new Response("Unexpected request", { status: 500 });
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<WorldPulseApp MapComponent={TestMap} />);
    await screen.findByText("Live country index complete");
    await screen.findByRole("heading", { name: economy.title });
    const worldRequests = () =>
      fetchMock.mock.calls.filter(([input]) =>
        String(input).includes("scope=world-live"),
      ).length;
    const before = worldRequests();

    fireEvent.change(screen.getByRole("searchbox", { name: "Search news" }), {
      target: { value: "music" },
    });

    expect(screen.queryByRole("heading", { name: economy.title })).toBeNull();
    expect(screen.getByRole("heading", { name: culture.title })).toBeInTheDocument();
    expect(worldRequests()).toBe(before);
  });

  it("keeps the loading screen instead of failing on an arbitrary ten-second deadline", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input) === "/countries.geojson") return geometryResponse();
        return new Promise<Response>(() => undefined);
      }),
    );
    render(<WorldPulseApp MapComponent={TestMap} />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });

    expect(
      screen.getByRole("heading", { name: "Preparing the live world" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "The live world feed is unavailable" }),
    ).toBeNull();
  });
});
