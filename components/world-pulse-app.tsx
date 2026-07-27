"use client";

import dynamic from "next/dynamic";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ComponentType,
} from "react";
import {
  articlesMentioningCountry,
  buildLiveEvents,
  enrichEventWithCoverage,
} from "@/lib/live-news";
import {
  biasDistributionForArticles,
  publisherBiasRating,
} from "@/lib/publisher-bias";
import { countriesMentionedByEvent } from "@/lib/map-links";
import { countryCodeForName } from "@/lib/country-locale";
import {
  CATEGORIES,
  type Category,
  type Event,
  type LiveNewsPayload,
  type MapNewsPayload,
  type MapCountry,
} from "@/lib/types";
import {
  countryPulses,
  defaultCountry,
  flagEmoji,
} from "@/lib/seed-data";
import { categoryColor } from "@/lib/scoring";
import type { WorldMapProps } from "./world-map";

const WorldMap = dynamic(
  () => import("./world-map").then((module) => module.WorldMap),
  {
    ssr: false,
    loading: () => (
      <div
        className="grid h-full min-h-[420px] place-items-center bg-[#0b121d]"
        aria-busy="true"
      >
        <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-[#738197]">
          Loading world map…
        </span>
      </div>
    ),
  },
);

type ImportanceFilter = "All" | "Major" | "Significant" | "Developing" | "Routine";
type TimeFilter = "24 hours" | "3 days" | "7 days";

interface FeedState {
  events: Event[];
  updatedAt: string | null;
  provider: string | null;
  loading: boolean;
  error: string | null;
}

interface CoverageState {
  event?: Event;
  loading: boolean;
  error: string | null;
}

const EMPTY_FEED: FeedState = {
  events: [],
  updatedAt: null,
  provider: null,
  loading: false,
  error: null,
};

const countryMetadata = countryPulses.map(
  (country): MapCountry => ({
    ...country,
    events: [],
    topEvent: undefined,
  }),
);
const initialCountry =
  countryMetadata.find((country) => country.iso2 === defaultCountry) ??
  countryMetadata[0];

const formatTime = (value: string) =>
  new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/Toronto",
  }).format(new Date(value));

const mergeEventFeeds = (...feeds: Event[][]) => {
  const seenHeadlines = new Set<string>();
  return feeds
    .flat()
    .filter((event) => {
      const headlineKey = event.headline
        .normalize("NFKC")
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, " ")
        .trim();
      if (seenHeadlines.has(headlineKey)) return false;
      seenHeadlines.add(headlineKey);
      return true;
    })
    .sort(
      (left, right) =>
        right.importanceScore - left.importanceScore ||
        Date.parse(right.lastUpdatedAt) - Date.parse(left.lastUpdatedAt),
    );
};

function ImportancePill({ event }: { event: Event }) {
  return (
    <span
      className="rounded-full border px-2 py-1 font-mono text-[9px] uppercase tracking-[0.12em]"
      style={{
        borderColor: `${categoryColor(event.category)}80`,
        color: categoryColor(event.category),
      }}
    >
      {event.importanceLabel} · {event.importanceScore}
    </span>
  );
}

function EventCard({
  event,
  connectionFocused,
  coverageLoading,
  coverageError,
  coverageExpanded,
  onActivate,
}: {
  event: Event;
  connectionFocused: boolean;
  coverageLoading: boolean;
  coverageError: string | null;
  coverageExpanded: boolean;
  onActivate: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const hasConnections = event.affectedCountries.length > 1;
  const bias = biasDistributionForArticles(event.articles);

  return (
    <article
      className={`cursor-pointer border-b border-[#273246] py-5 transition first:pt-0 last:border-0 ${
        connectionFocused
          ? "-mx-3 rounded-xl border border-[#3c6d70] bg-[#13262c] px-3"
          : ""
      }`}
      onClick={(clickEvent) => {
        if ((clickEvent.target as HTMLElement).closest("a, button")) {
          return;
        }
        onActivate();
      }}
      onKeyDown={(keyEvent) => {
        if (
          keyEvent.target !== keyEvent.currentTarget ||
          (keyEvent.key !== "Enter" && keyEvent.key !== " ")
        ) {
          return;
        }
        keyEvent.preventDefault();
        onActivate();
      }}
      tabIndex={0}
      aria-label={`${event.headline}. Press Enter to search for broader coverage${
        hasConnections ? " and toggle this event's map connections" : ""
      }.`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span
          className="h-2 w-2 rounded-full"
          style={{ background: categoryColor(event.category) }}
          aria-hidden="true"
        />
        <span className="font-mono text-[9px] uppercase tracking-[0.15em] text-[#9ba7b8]">
          {event.category}
        </span>
        <ImportancePill event={event} />
        {coverageLoading ? (
          <span className="font-mono text-[8px] uppercase tracking-[0.12em] text-[#73e2cc]">
            Finding coverage…
          </span>
        ) : coverageExpanded ? (
          <span className="font-mono text-[8px] uppercase tracking-[0.12em] text-[#73e2cc]">
            Topic search complete
          </span>
        ) : null}
      </div>
      <h3
        dir="auto"
        className="mt-3 break-words text-lg font-semibold leading-snug tracking-[-0.025em] text-white"
      >
        {event.headline}
      </h3>
      <p
        dir="auto"
        className="mt-2 break-words text-sm leading-6 text-[#b5bfcd]"
      >
        {event.summary}
      </p>
      <p className="mt-2 text-[10px] leading-4 text-[#7f8da1]">
        Automated synopsis from feed metadata — verify details at the original
        sources.
      </p>
      <div className="mt-4 grid grid-cols-3 gap-3">
        <Metric label="Scope" value={event.geographicScope} />
        <Metric label="Updated" value={formatTime(event.lastUpdatedAt)} />
        <Metric
          label="Sources"
          value={
            event.scoringInput.independentSourceCount > event.articles.length
              ? `${event.articles.length} shown · ${event.scoringInput.independentSourceCount} matched`
              : `${event.articles.length} independent`
          }
        />
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {event.articles.map((article) => {
          const rating = publisherBiasRating(article.source.publisherName);
          return (
            <a
              key={article.id}
              href={article.originalUrl}
              target="_blank"
              rel="noreferrer"
              dir="auto"
              title={
                rating
                  ? `Ground News publisher rating: ${rating.label}`
                  : "No Ground News publisher rating mapped"
              }
              className="max-w-full break-words rounded-md border border-[#344157] px-2.5 py-1.5 text-[10px] text-[#d4dbe5] transition hover:border-[#60708a] hover:bg-[#1a2537]"
            >
              {article.source.publisherName}
              {rating ? ` · ${rating.label}` : ""} ↗
            </a>
          );
        })}
      </div>
      <div className="mt-4 rounded-lg border border-[#29384b] bg-[#0c1522] p-3">
        <div className="flex items-center justify-between gap-3">
          <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-[#aab6c5]">
            Ground News publisher mix
          </span>
          <span className="text-[9px] text-[#718096]">
            {bias.rated}/{bias.total} rated
          </span>
        </div>
        {bias.rated ? (
          <>
            <div
              className="mt-2 flex h-2 overflow-hidden rounded-full bg-[#263247]"
              aria-label={`Publisher ratings: ${bias.percentages.left}% left, ${bias.percentages.center}% center, ${bias.percentages.right}% right`}
            >
              <span
                className="bg-[#e65b64]"
                style={{ width: `${bias.percentages.left}%` }}
              />
              <span
                className="bg-[#e7edf4]"
                style={{ width: `${bias.percentages.center}%` }}
              />
              <span
                className="bg-[#4f8ee8]"
                style={{ width: `${bias.percentages.right}%` }}
              />
            </div>
            <div className="mt-2 grid grid-cols-3 text-[9px]">
              <span className="text-[#e8878e]">
                Left {bias.percentages.left}%
              </span>
              <span className="text-center text-[#d9e0e8]">
                Center {bias.percentages.center}%
              </span>
              <span className="text-right text-[#78a9ed]">
                Right {bias.percentages.right}%
              </span>
            </div>
          </>
        ) : (
          <p className="mt-2 text-[10px] text-[#77869a]">
            No displayed publisher has a mapped rating.
          </p>
        )}
        <p className="mt-2 text-[9px] leading-4 text-[#68778a]">
          Publication-level ratings, not a rating of this event. Unrated local
          outlets are excluded.{" "}
          <a
            href="https://ground.news/rating-system"
            target="_blank"
            rel="noreferrer"
            className="text-[#8fcfc4] hover:underline"
          >
            Ground News methodology ↗
          </a>
        </p>
      </div>
      {coverageError ? (
        <p className="mt-3 text-[10px] text-[#d58a96]">{coverageError}</p>
      ) : !coverageExpanded && !coverageLoading ? (
        <p className="mt-3 text-[10px] text-[#7f8da1]">
          Select this event to search the current seven-day news index for
          broader coverage.
        </p>
      ) : null}
      <button
        type="button"
        className="mt-4 flex w-full items-center justify-between rounded-lg bg-[#182234] px-3 py-2.5 text-left text-xs font-medium text-[#d9e0e9] transition hover:bg-[#1d2a3e]"
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
      >
        Why this score?
        <span aria-hidden="true">{expanded ? "−" : "+"}</span>
      </button>
      {expanded ? (
        <div className="mt-2 rounded-lg border border-[#28354a] bg-[#0c1420] p-3">
          <p className="text-xs leading-5 text-[#9eabba]">
            This estimate combines source diversity, geographic reach,
            publisher prominence, recency, and coverage velocity. Duplicate
            volume alone cannot make an event major.
          </p>
          <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2">
            {Object.entries(event.scoringComponents).map(([key, value]) => (
              <div key={key} className="flex justify-between text-[10px]">
                <span className="capitalize text-[#7f8da1]">
                  {key.replace(/([A-Z])/g, " $1")}
                </span>
                <span className="font-mono text-[#d5dde8]">
                  +{value.toFixed(1)}
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </article>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="font-mono text-[8px] uppercase tracking-[0.15em] text-[#69778b]">
        {label}
      </div>
      <div className="mt-1 text-[10px] leading-4 text-[#c7d0dc]">{value}</div>
    </div>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: React.ReactNode;
}) {
  return (
    <label className="min-w-0">
      <span className="sr-only">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-9 w-full rounded-lg border border-[#303d51] bg-[#111a29] px-2.5 text-[10px] text-[#d6deea]"
        aria-label={label}
      >
        {children}
      </select>
    </label>
  );
}

function MethodologyModal({ onClose }: { onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="methodology-title"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section className="max-h-[85vh] w-full max-w-xl overflow-y-auto rounded-2xl border border-[#344157] bg-[#111927] p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-[#73e2cc]">
              About the signal
            </p>
            <h2
              id="methodology-title"
              className="mt-2 text-2xl font-semibold tracking-[-0.04em]"
            >
              Importance, with context
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close methodology"
            className="rounded-full border border-[#3a4659] px-3 py-1.5 text-sm text-[#cad2dd] hover:bg-[#1a2537]"
          >
            Close
          </button>
        </div>
        <p className="mt-5 text-sm leading-6 text-[#b5bfcd]">
          WorldPulse estimates impact on a 0–100 scale. It is a transparent
          editorial aid, not an objective fact or a judgment about human worth.
        </p>
        <div className="mt-5 space-y-3">
          {[
            ["25%", "Independent sources and source-country diversity"],
            ["25%", "Countries affected and their relative significance"],
            ["20%", "Publisher prominence"],
            ["15%", "Recency"],
            ["15%", "Coverage velocity"],
          ].map(([weight, text]) => (
            <div
              key={text}
              className="flex gap-4 rounded-lg bg-[#182234] px-4 py-3"
            >
              <span className="w-10 font-mono text-xs text-[#73e2cc]">
                {weight}
              </span>
              <span className="text-xs text-[#d0d8e3]">{text}</span>
            </div>
          ))}
        </div>
        <p className="mt-5 text-xs leading-5 text-[#8996a8]">
          Every displayed headline and publisher link comes from a real public
          news feed. A recent feed snapshot makes all countries available
          immediately, then a live world-news index refreshes matching country
          feeds automatically without waiting for a click. Opening a country
          also runs a deeper local and international search. WorldPulse never
          invents headlines or sources.
        </p>
        <p className="mt-3 text-xs leading-5 text-[#8996a8]">
          Coverage is uneven. Countries with less digital reporting or fewer
          accessible sources may appear less active. Publication volume alone
          is never treated as importance, and political summaries use neutral
          wording. Live headlines and publisher links come from public RSS
          metadata; WorldPulse does not reproduce article bodies.
        </p>
        <p className="mt-3 text-xs leading-5 text-[#8996a8]">
          Selecting an event runs an exact and keyword topic search across
          local and international Google News editions, deduplicates
          publishers, and displays up to five prominent recent matches.
          Publisher lean labels use a checked Ground News ratings snapshot
          (July 26, 2026). They describe publications—not individual articles
          or the event—and unrated publishers are excluded from the percentage
          bar.
        </p>
      </section>
    </div>
  );
}

interface WorldPulseAppProps {
  MapComponent?: ComponentType<WorldMapProps>;
  liveUpdates?: boolean;
}

export function WorldPulseApp({
  MapComponent = WorldMap,
  liveUpdates = true,
}: WorldPulseAppProps = {}) {
  const [selectedCountry, setSelectedCountry] =
    useState<MapCountry>(initialCountry);
  const [countryDirectory, setCountryDirectory] =
    useState<MapCountry[]>(countryMetadata);
  const [globalPayload, setGlobalPayload] =
    useState<LiveNewsPayload | null>(null);
  const [globalFeed, setGlobalFeed] = useState<FeedState>(EMPTY_FEED);
  const [countryFeeds, setCountryFeeds] = useState<Record<string, FeedState>>(
    {},
  );
  const [preloadedCountryFeeds, setPreloadedCountryFeeds] = useState<
    Record<string, FeedState>
  >({});
  const [countryDirectoryReady, setCountryDirectoryReady] = useState(false);
  const [mapSnapshotReady, setMapSnapshotReady] = useState(false);
  const [mapPreload, setMapPreload] = useState({
    loaded: 0,
    total: 0,
    refreshed: 0,
  });
  const [globalView, setGlobalView] = useState(false);
  const [connectionEventId, setConnectionEventId] = useState<string | null>(
    null,
  );
  const [category, setCategory] = useState<"All" | Category>("All");
  const [importance, setImportance] = useState<ImportanceFilter>("All");
  const [timeRange, setTimeRange] = useState<TimeFilter>("7 days");
  const [search, setSearch] = useState("");
  const [showMethodology, setShowMethodology] = useState(false);
  const [eventCoverage, setEventCoverage] = useState<
    Record<string, CoverageState>
  >({});

  const fetchGlobalNews = useCallback(async () => {
    setGlobalFeed((current) => ({
      ...current,
      loading: true,
      error: null,
    }));
    try {
      const response = await fetch("/api/live-news?scope=global");
      if (!response.ok) throw new Error("The global live feed is temporarily unavailable.");
      const payload = (await response.json()) as LiveNewsPayload;
      setGlobalPayload(payload);
      setGlobalFeed({
        events: buildLiveEvents(payload, null),
        updatedAt: payload.generatedAt,
        provider: payload.provider,
        loading: false,
        error: null,
      });
    } catch (error) {
      setGlobalFeed((current) => ({
        ...current,
        loading: false,
        error:
          error instanceof Error
            ? error.message
            : "The global live feed is temporarily unavailable.",
      }));
    }
  }, []);

  const fetchCountryNews = useCallback(async (country: MapCountry) => {
    const key = country.name;
    setCountryFeeds((current) => ({
      ...current,
      [key]: {
        ...(current[key] ?? EMPTY_FEED),
        loading: true,
        error: null,
      },
    }));
    try {
      const parameters = new URLSearchParams({ country: country.name });
      if (country.iso2) parameters.set("iso2", country.iso2);
      const response = await fetch(`/api/live-news?${parameters.toString()}`);
      if (!response.ok) {
        throw new Error(
          `Local reporting for ${country.name} is temporarily unavailable.`,
        );
      }
      const payload = (await response.json()) as LiveNewsPayload;
      setCountryFeeds((current) => ({
        ...current,
        [key]: {
          events: buildLiveEvents(payload, country),
          updatedAt: payload.generatedAt,
          provider: `${payload.provider} · local + international discovery`,
          loading: false,
          error: null,
        },
      }));
    } catch (error) {
      setCountryFeeds((current) => ({
        ...current,
        [key]: {
          ...(current[key] ?? EMPTY_FEED),
          loading: false,
          error:
            error instanceof Error
              ? error.message
              : `Local reporting for ${country.name} is temporarily unavailable.`,
        },
      }));
    }
  }, []);

  useEffect(() => {
    if (!liveUpdates) return;
    let cancelled = false;
    fetch("/countries.geojson")
      .then((response) => response.json())
      .then((value) => {
        const geojson = value as {
          features?: Array<{
            id?: string | number;
            properties?: { name?: string };
          }>;
        };
        if (cancelled || !geojson.features) return;
        const metadataById = new Map(
          countryMetadata.map((country) => [country.mapId, country]),
        );
        const directory = geojson.features.flatMap((feature) => {
          const mapId = String(feature.id ?? "");
          const name = feature.properties?.name?.trim();
          if (!mapId || !name) return [];
          const metadata = metadataById.get(mapId);
          return [
            metadata ?? {
              mapId,
              name,
              iso2: countryCodeForName(name) ?? undefined,
              events: [],
            },
          ];
        });
        setCountryDirectory(directory);
        setCountryDirectoryReady(true);
      })
      .catch(() => {
        // The map remains fully usable with its own GeoJSON fallback.
        setCountryDirectoryReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, [liveUpdates]);

  useEffect(() => {
    if (!liveUpdates) return;
    void fetchGlobalNews();
  }, [fetchGlobalNews, liveUpdates]);

  useEffect(() => {
    if (!liveUpdates || !countryDirectoryReady) return;
    if (!countryDirectory.length) {
      setMapSnapshotReady(true);
      return;
    }

    let cancelled = false;
    fetch("/map-news-seed.json")
      .then((response) => {
        if (!response.ok) throw new Error("Map snapshot unavailable.");
        return response.json() as Promise<MapNewsPayload>;
      })
      .then((payload) => {
        if (cancelled) return;
        const countriesByName = new Map(
          countryDirectory.map((country) => [country.name, country]),
        );
        const nextFeeds: Record<string, FeedState> = {};
        let indexedCountries = 0;

        for (const countryPayload of payload.countries) {
          const country = countriesByName.get(countryPayload.countryName);
          if (!country) continue;
          indexedCountries += 1;
          const livePayload: LiveNewsPayload = {
            countryName: countryPayload.countryName,
            scope: "country",
            generatedAt: countryPayload.generatedAt,
            refreshAfterSeconds: payload.refreshAfterSeconds,
            provider: payload.provider,
            articles: countryPayload.articles,
          };
          nextFeeds[country.name] = {
            events: buildLiveEvents(livePayload, country),
            updatedAt: countryPayload.generatedAt,
            provider: `${payload.provider} · ready before click`,
            loading: false,
            error: null,
          };
        }

        setPreloadedCountryFeeds(nextFeeds);
        setMapPreload({
          loaded: indexedCountries,
          total: countryDirectory.length,
          refreshed: 0,
        });
      })
      .catch(() => {
        // The live world index below remains as the network fallback.
      })
      .finally(() => {
        if (!cancelled) setMapSnapshotReady(true);
      });

    return () => {
      cancelled = true;
    };
  }, [countryDirectory, countryDirectoryReady, liveUpdates]);

  useEffect(() => {
    if (
      !liveUpdates ||
      !mapSnapshotReady ||
      !globalPayload ||
      !countryDirectory.length
    ) {
      return;
    }

    const liveFeeds: Record<string, FeedState> = {};
    for (const country of countryDirectory) {
      const matchingArticles = articlesMentioningCountry(
        globalPayload,
        country.name,
      );
      if (!matchingArticles.length) continue;
      const countryPayload: LiveNewsPayload = {
        ...globalPayload,
        countryName: country.name,
        scope: "country",
        articles: matchingArticles,
      };
      const events = buildLiveEvents(countryPayload, country);
      if (!events.length) continue;
      liveFeeds[country.name] = {
        events,
        updatedAt: globalPayload.generatedAt,
        provider: `${globalPayload.provider} · automatic world sweep`,
        loading: false,
        error: null,
      };
    }

    setPreloadedCountryFeeds((current) => {
      const next = { ...current };
      for (const [countryName, liveFeed] of Object.entries(liveFeeds)) {
        next[countryName] = {
          ...liveFeed,
          events: mergeEventFeeds(
            liveFeed.events,
            current[countryName]?.events ?? [],
          ),
        };
      }
      return next;
    });
    setMapPreload((current) => ({
      ...current,
      refreshed: Object.keys(liveFeeds).length,
    }));
  }, [
    countryDirectory,
    globalPayload,
    liveUpdates,
    mapSnapshotReady,
  ]);

  useEffect(() => {
    if (!liveUpdates) return;
    void fetchCountryNews(selectedCountry);
  }, [fetchCountryNews, liveUpdates, selectedCountry]);

  useEffect(() => {
    if (!liveUpdates) return;
    const refreshTimer = window.setInterval(() => {
      void fetchGlobalNews();
      void fetchCountryNews(selectedCountry);
    }, 600_000);
    return () => window.clearInterval(refreshTimer);
  }, [
    fetchCountryNews,
    fetchGlobalNews,
    liveUpdates,
    selectedCountry,
  ]);

  const mapCountries = useMemo(
    () =>
      countryDirectory.map((country): MapCountry => {
        const countryFeed = countryFeeds[country.name];
        const preloadedFeed = preloadedCountryFeeds[country.name];
        if (
          countryFeed &&
          !countryFeed.loading &&
          !countryFeed.error
        ) {
          const mergedEvents = mergeEventFeeds(
            countryFeed.events,
            preloadedFeed?.events ?? [],
          );
          return {
            ...country,
            events: mergedEvents,
            topEvent: mergedEvents[0],
          };
        }
        if (preloadedFeed?.events.length) {
          return {
            ...country,
            events: preloadedFeed.events,
            topEvent: preloadedFeed.events[0],
          };
        }
        if (globalPayload) {
          const matchingArticles = articlesMentioningCountry(
            globalPayload,
            country.name,
          );
          if (matchingArticles.length) {
            const events = buildLiveEvents(
              { ...globalPayload, articles: matchingArticles },
              country,
            );
            return { ...country, events, topEvent: events[0] };
          }
        }
        return country;
      }),
    [
      countryDirectory,
      countryFeeds,
      globalPayload,
      preloadedCountryFeeds,
    ],
  );
  const activeCountry =
    mapCountries.find((country) => country.mapId === selectedCountry.mapId) ??
    selectedCountry;
  const fetchEventCoverage = useCallback(
    async (event: Event) => {
      setEventCoverage((current) => ({
        ...current,
        [event.id]: {
          ...current[event.id],
          loading: true,
          error: null,
        },
      }));
      try {
        const parameters = new URLSearchParams({
          scope: "event",
          headline: event.headline,
        });
        if (!globalView) {
          parameters.set("country", activeCountry.name);
          if (activeCountry.iso2) parameters.set("iso2", activeCountry.iso2);
        }
        const response = await fetch(
          `/api/live-news?${parameters.toString()}`,
        );
        if (!response.ok) {
          throw new Error("Broader coverage search is temporarily unavailable.");
        }
        const payload = (await response.json()) as LiveNewsPayload;
        setEventCoverage((current) => ({
          ...current,
          [event.id]: {
            event: enrichEventWithCoverage(event, payload),
            loading: false,
            error: null,
          },
        }));
      } catch (error) {
        setEventCoverage((current) => ({
          ...current,
          [event.id]: {
            ...current[event.id],
            loading: false,
            error:
              error instanceof Error
                ? error.message
                : "Broader coverage search is temporarily unavailable.",
          },
        }));
      }
    },
    [activeCountry.iso2, activeCountry.name, globalView],
  );
  const fullCountryFeed = countryFeeds[activeCountry.name];
  const preloadedCountryFeed = preloadedCountryFeeds[activeCountry.name];
  const combinedCountryFeed =
    fullCountryFeed && !fullCountryFeed.error
      ? {
          ...fullCountryFeed,
          events: mergeEventFeeds(
            fullCountryFeed.events,
            preloadedCountryFeed?.events ?? [],
          ),
        }
      : preloadedCountryFeed ?? fullCountryFeed;
  const activeFeed = globalView
    ? globalFeed
    : combinedCountryFeed ?? {
          events: activeCountry.events,
          updatedAt: globalFeed.updatedAt,
          provider: globalFeed.provider,
          loading: fullCountryFeed?.loading ?? globalFeed.loading,
          error: fullCountryFeed?.error ?? globalFeed.error,
        };
  const baseEvents = useMemo(
    () =>
      activeFeed.events.map((event) => {
        const mentionedCountries = countriesMentionedByEvent(
          event,
          mapCountries,
          globalView ? undefined : activeCountry,
        );
        if (mentionedCountries.length < 2) return event;
        const affectedCountries = mentionedCountries.map(
          (country) => country.iso2 ?? country.name,
        );
        return {
          ...event,
          geographicScope: "International" as const,
          primaryCountry:
            event.primaryCountry === "GLOBAL"
              ? affectedCountries[0]
              : event.primaryCountry,
          affectedCountries,
          scoringInput: {
            ...event.scoringInput,
            affectedCountryCount: affectedCountries.length,
          },
        };
      }),
    [activeCountry, activeFeed.events, globalView, mapCountries],
  );
  const expandedEvents = useMemo(
    () =>
      baseEvents.map((event) => eventCoverage[event.id]?.event ?? event),
    [baseEvents, eventCoverage],
  );
  const filteredEvents = (() => {
    const limitHours =
      timeRange === "24 hours" ? 24 : timeRange === "3 days" ? 72 : 168;
    const reference = Date.now();
    return expandedEvents.filter((event) => {
      const matchesCategory = category === "All" || event.category === category;
      const matchesImportance =
        importance === "All" || event.importanceLabel === importance;
      const matchesTime =
        reference - Date.parse(event.lastUpdatedAt) <= limitHours * 3_600_000;
      const query = search.trim().toLowerCase();
      const matchesSearch =
        !query ||
        event.headline.toLowerCase().includes(query) ||
        event.summary.toLowerCase().includes(query) ||
        event.articles.some((article) =>
          article.source.publisherName.toLowerCase().includes(query),
        );
      return matchesCategory && matchesImportance && matchesTime && matchesSearch;
    });
  })();
  const focusedConnectionEvent = filteredEvents.find(
    (event) => event.id === connectionEventId,
  );
  const mapLinkEvents =
    connectionEventId !== null
      ? focusedConnectionEvent
        ? [focusedConnectionEvent]
        : []
      : globalView
        ? []
        : filteredEvents;

  const handleSelect = (country: MapCountry) => {
    setSelectedCountry(country);
    setGlobalView(false);
    setConnectionEventId(null);
    setCategory("All");
    setImportance("All");
    setTimeRange("7 days");
    setSearch("");
  };
  const handleEventActivate = (event: Event) => {
    if (event.affectedCountries.length > 1) {
      setConnectionEventId((current) =>
        current === event.id ? null : event.id,
      );
    }
    const coverage = eventCoverage[event.id];
    if (!coverage?.loading && !coverage?.event) {
      void fetchEventCoverage(event);
    }
  };
  const hasActiveFilters =
    category !== "All" ||
    importance !== "All" ||
    timeRange !== "7 days" ||
    search.trim().length > 0;

  return (
    <main className="min-h-screen bg-[#080d15]">
      <header className="flex h-16 items-center justify-between border-b border-[#222d3e] px-4 sm:px-6">
        <div className="flex items-center gap-3">
          <div className="grid h-8 w-8 place-items-center rounded-full border border-[#4d6572] bg-[#13232a] text-sm text-[#73e2cc]">
            ◉
          </div>
          <div>
            <div className="text-sm font-semibold tracking-[-0.02em]">
              WorldPulse
            </div>
            <div className="font-mono text-[8px] uppercase tracking-[0.19em] text-[#7f8da1]">
              Live global signal desk
            </div>
          </div>
        </div>
        <nav className="flex items-center gap-2" aria-label="Main navigation">
          <button
            type="button"
            onClick={() => {
              setGlobalView((value) => !value);
              setConnectionEventId(null);
            }}
            className={`rounded-full border px-3 py-2 text-[10px] transition sm:px-4 ${
              globalView
                ? "border-[#73e2cc] bg-[#14332f] text-[#b7fff1]"
                : "border-[#344157] text-[#c5cfdb] hover:bg-[#151f30]"
            }`}
          >
            {globalView ? "Map view" : "Global feed"}
          </button>
          <button
            type="button"
            onClick={() => setShowMethodology(true)}
            className="rounded-full border border-[#344157] px-3 py-2 text-[10px] text-[#c5cfdb] hover:bg-[#151f30] sm:px-4"
          >
            Methodology
          </button>
        </nav>
      </header>

      <div className="grid min-h-[calc(100vh-4rem)] lg:grid-cols-[minmax(0,1fr)_420px]">
        <section className="relative min-h-[54vh] border-b border-[#222d3e] lg:h-[calc(100vh-4rem)] lg:border-b-0 lg:border-r">
          <MapComponent
            countries={mapCountries}
            selectedMapId={globalView ? null : selectedCountry.mapId}
            onSelect={handleSelect}
            linkEvents={mapLinkEvents}
            statusLabel={
              mapPreload.total
                ? mapPreload.loaded === mapPreload.total
                  ? `${mapPreload.loaded}/${mapPreload.total} countries loaded${
                      globalFeed.loading
                        ? " · syncing live"
                        : mapPreload.refreshed
                          ? ` · ${mapPreload.refreshed} live-updated`
                          : ""
                    }`
                  : `${mapPreload.loaded}/${mapPreload.total} countries ready`
                : globalFeed.loading
                ? "Refreshing live feed…"
                : "Live · auto-refresh 10 min"
            }
          />
          <div className="absolute inset-x-4 bottom-4 z-10 rounded-xl border border-[#334055] bg-[#0d1522]/95 p-3 shadow-xl backdrop-blur-sm sm:left-auto sm:w-[min(620px,calc(100%-2rem))]">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-mono text-[9px] uppercase tracking-[0.17em] text-[#8996a8]">
                Category signal
              </span>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[9px] text-[#647286]">
                <span>Intensity = estimated importance</span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2 w-5 rounded-[50%] border-t-2 border-[#d8fff7] shadow-[0_0_6px_#73e2cc]" />
                  Glowing curves = selected event connections
                </span>
              </div>
            </div>
            <div className="mt-2 flex flex-wrap gap-x-3 gap-y-2">
              {CATEGORIES.map((item) => (
                <div
                  key={item}
                  className="flex shrink-0 items-center gap-1.5 text-[9px] text-[#b7c1ce]"
                >
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ background: categoryColor(item) }}
                  />
                  {item}
                </div>
              ))}
            </div>
          </div>
        </section>

        <aside
          className="flex min-h-[620px] flex-col bg-[#101722] lg:h-[calc(100vh-4rem)] lg:min-h-0"
          aria-label={globalView ? "Global events" : "Country news panel"}
        >
          <div className="border-b border-[#273246] px-5 pb-4 pt-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-2xl" aria-hidden="true">
                    {globalView
                      ? "🌐"
                      : activeCountry.iso2
                        ? flagEmoji(activeCountry.iso2)
                        : "◎"}
                  </span>
                  <h2 className="text-xl font-semibold tracking-[-0.035em]">
                    {globalView ? "Global events" : activeCountry.name}
                  </h2>
                </div>
                <p className="mt-1 text-[10px] text-[#8794a6]">
                  {filteredEvents.length} grouped{" "}
                  {filteredEvents.length === 1 ? "event" : "events"} · Updated
                  {activeFeed.updatedAt
                    ? ` ${formatTime(activeFeed.updatedAt)}`
                    : " when the live feed syncs"}
                </p>
              </div>
              <div className="rounded-lg bg-[#182234] px-3 py-2 text-center">
                <div className="font-mono text-lg text-[#73e2cc]">
                  {baseEvents[0]?.importanceScore ?? "—"}
                </div>
                <div className="font-mono text-[7px] uppercase tracking-[0.14em] text-[#7f8da1]">
                  top score
                </div>
              </div>
            </div>
            <div className="mt-3 flex items-center justify-between gap-3">
              <span className="font-mono text-[8px] uppercase tracking-[0.13em] text-[#6f7e92]">
                {activeFeed.loading
                  ? "Syncing current reporting…"
                  : activeFeed.error
                    ? "Live sync interrupted"
                    : activeFeed.provider
                      ? `${activeFeed.provider} · multiple publishers`
                      : "Live feed ready"}
              </span>
              <button
                type="button"
                onClick={() =>
                  void (globalView
                    ? fetchGlobalNews()
                    : fetchCountryNews(activeCountry))
                }
                disabled={activeFeed.loading || !liveUpdates}
                className="rounded-md border border-[#354359] px-2.5 py-1.5 text-[9px] text-[#aeb9c7] transition hover:border-[#64748b] hover:text-white disabled:cursor-wait disabled:opacity-50"
              >
                Refresh
              </button>
            </div>

            <div className="mt-4 grid grid-cols-3 gap-2">
              <FilterSelect
                label="Filter by category"
                value={category}
                onChange={(value) => {
                  setCategory(value as "All" | Category);
                  setConnectionEventId(null);
                }}
              >
                <option value="All">All topics</option>
                {CATEGORIES.map((item) => (
                  <option key={item}>{item}</option>
                ))}
              </FilterSelect>
              <FilterSelect
                label="Filter by importance"
                value={importance}
                onChange={(value) => {
                  setImportance(value as ImportanceFilter);
                  setConnectionEventId(null);
                }}
              >
                {["All", "Major", "Significant", "Developing", "Routine"].map(
                  (item) => (
                    <option key={item}>{item}</option>
                  ),
                )}
              </FilterSelect>
              <FilterSelect
                label="Filter by time range"
                value={timeRange}
                onChange={(value) => {
                  setTimeRange(value as TimeFilter);
                  setConnectionEventId(null);
                }}
              >
                {["24 hours", "3 days", "7 days"].map((item) => (
                  <option key={item}>{item}</option>
                ))}
              </FilterSelect>
            </div>
            <label className="mt-2 block">
              <span className="sr-only">Search news</span>
              <input
                type="search"
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setConnectionEventId(null);
                }}
                placeholder="Search headlines, summaries, sources…"
                className="h-9 w-full rounded-lg border border-[#303d51] bg-[#111a29] px-3 text-xs text-white placeholder:text-[#657286]"
              />
            </label>
          </div>

          <div className="flex-1 overflow-y-auto px-5 py-5 scrollbar-thin">
            {activeFeed.loading && !baseEvents.length ? (
              <div
                className="space-y-5"
                aria-label="Loading current reporting"
                aria-busy="true"
              >
                {[0, 1, 2].map((item) => (
                  <div
                    key={item}
                    className="animate-pulse border-b border-[#273246] pb-5"
                  >
                    <div className="h-2 w-28 rounded bg-[#263247]" />
                    <div className="mt-4 h-5 w-4/5 rounded bg-[#263247]" />
                    <div className="mt-3 h-3 w-full rounded bg-[#1d293b]" />
                    <div className="mt-2 h-3 w-2/3 rounded bg-[#1d293b]" />
                  </div>
                ))}
              </div>
            ) : activeFeed.error && !baseEvents.length ? (
              <div className="grid min-h-60 place-items-center rounded-xl border border-dashed border-[#6b3b48] p-8 text-center">
                <div>
                  <div className="text-2xl text-[#d36b7b]">!</div>
                  <h3 className="mt-3 text-sm font-medium">
                    Live feed unavailable
                  </h3>
                  <p className="mt-2 text-xs leading-5 text-[#8f9caf]">
                    {activeFeed.error}
                  </p>
                  <button
                    type="button"
                    onClick={() => void fetchGlobalNews()}
                    className="mt-4 rounded-lg border border-[#46556b] px-3 py-2 text-[10px] text-[#cad3df] hover:bg-[#192437]"
                  >
                    Try again
                  </button>
                </div>
              </div>
            ) : filteredEvents.length ? (
              filteredEvents.map((event) => (
                <EventCard
                  key={event.id}
                  event={event}
                  connectionFocused={connectionEventId === event.id}
                  coverageLoading={
                    eventCoverage[event.id]?.loading ?? false
                  }
                  coverageError={eventCoverage[event.id]?.error ?? null}
                  coverageExpanded={Boolean(eventCoverage[event.id]?.event)}
                  onActivate={() => handleEventActivate(event)}
                />
              ))
            ) : (
              <div className="grid min-h-60 place-items-center rounded-xl border border-dashed border-[#354157] p-8 text-center">
                <div>
                  <div className="text-2xl text-[#59687d]">◎</div>
                  <h3 className="mt-3 text-sm font-medium">
                    {!globalView && !baseEvents.length && !hasActiveFilters
                      ? `No indexed news for ${activeCountry.name}`
                      : globalView && !baseEvents.length && !hasActiveFilters
                        ? "No live global events"
                      : "No matching events"}
                  </h3>
                  <p className="mt-2 text-xs leading-5 text-[#7f8da1]">
                    {!globalView && !baseEvents.length && !hasActiveFilters
                      ? "No matching headlines were indexed in the current three-day window. This country will refresh automatically."
                      : globalView && !baseEvents.length && !hasActiveFilters
                        ? "The global feed will refresh automatically."
                      : "Broaden the filters or try a different search term."}
                  </p>
                  {hasActiveFilters ? (
                    <button
                      type="button"
                      onClick={() => {
                        setCategory("All");
                        setImportance("All");
                        setTimeRange("7 days");
                        setSearch("");
                        setConnectionEventId(null);
                      }}
                      className="mt-4 rounded-lg border border-[#46556b] px-3 py-2 text-[10px] text-[#cad3df] hover:bg-[#192437]"
                    >
                      Reset filters
                    </button>
                  ) : null}
                </div>
              </div>
            )}
          </div>
          <footer className="border-t border-[#273246] px-5 py-3 text-[9px] leading-4 text-[#68768a]">
            Country panels combine local top stories, country-specific search,
            and international reporting. Metadata refreshes every 10 minutes.
            Duplicate headlines about the same occurrence are grouped into one
            event. Importance is an estimate, not an objective fact.
          </footer>
        </aside>
      </div>
      {showMethodology ? (
        <MethodologyModal onClose={() => setShowMethodology(false)} />
      ) : null}
    </main>
  );
}
