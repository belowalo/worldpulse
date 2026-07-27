"use client";

import dynamic from "next/dynamic";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
} from "react";
import {
  buildLiveEvents,
  enrichEventWithCoverage,
  eventsDescribeSameOccurrence,
  mergeCanonicalEvents,
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
import { calculateImportance, categoryColor } from "@/lib/scoring";
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
type TimeFilter = "24 hours" | "3 days" | "7 days" | "All indexed";

interface FeedState {
  events: Event[];
  updatedAt: string | null;
  provider: string | null;
  loading: boolean;
  error: string | null;
}

interface CoverageState {
  event?: Event;
  payload?: LiveNewsPayload;
  fetchedAt?: number;
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

const MAX_REMEMBERED_COUNTRY_FEEDS = 8;

function rememberCountryFeed(
  feeds: Record<string, FeedState>,
  countryName: string,
  feed: FeedState,
) {
  const next = { ...feeds };
  delete next[countryName];
  next[countryName] = feed;
  while (Object.keys(next).length > MAX_REMEMBERED_COUNTRY_FEEDS) {
    delete next[Object.keys(next)[0]];
  }
  return next;
}

function coverageIsFresh(coverage?: CoverageState) {
  if (!coverage?.payload || !coverage.fetchedAt) return false;
  const lifetime =
    Math.max(300, coverage.payload.refreshAfterSeconds) * 1_000;
  return Date.now() - coverage.fetchedAt < lifetime;
}

function coverageForEvent(
  event: Event,
  coverageById: Record<string, CoverageState>,
) {
  return (
    coverageById[event.id] ??
    Object.values(coverageById).find(
      (coverage) =>
        coverage.event &&
        coverage.event.category === event.category &&
        eventsDescribeSameOccurrence(coverage.event, event),
    )
  );
}

function feedIsFresh(feed: FeedState, lifetimeMs = 300_000) {
  if (!feed.updatedAt) return false;
  const updatedAt = Date.parse(feed.updatedAt);
  return Number.isFinite(updatedAt) && Date.now() - updatedAt < lifetimeMs;
}

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

function applyDetectedGeography(
  event: Event,
  countries: MapCountry[],
  anchorCountry?: MapCountry,
) {
  const mentionedCountries = countriesMentionedByEvent(
    event,
    countries,
    anchorCountry,
  );
  const detectedCountries = mentionedCountries.map(
    (country) => country.iso2 ?? country.name,
  );
  const affectedCountries = [
    ...new Set(
      detectedCountries.length
        ? detectedCountries
        : event.affectedCountries.length
          ? event.affectedCountries
          : event.primaryCountry !== "GLOBAL"
            ? [event.primaryCountry]
            : [],
    ),
  ];
  const scoringInput = {
    ...event.scoringInput,
    affectedCountryCount: Math.max(1, affectedCountries.length),
  };
  const scoring = calculateImportance(scoringInput);
  return {
    ...event,
    geographicScope:
      affectedCountries.length > 1
        ? ("International" as const)
        : event.geographicScope,
    primaryCountry:
      event.primaryCountry === "GLOBAL" && affectedCountries[0]
        ? affectedCountries[0]
        : event.primaryCountry,
    affectedCountries,
    importanceScore: scoring.score,
    importanceLabel: scoring.label,
    scoringComponents: scoring.components,
    scoringInput,
  };
}

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
  onVisible,
}: {
  event: Event;
  connectionFocused: boolean;
  coverageLoading: boolean;
  coverageError: string | null;
  coverageExpanded: boolean;
  onActivate: () => void;
  onVisible: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const cardRef = useRef<HTMLElement | null>(null);
  const hasConnections = event.affectedCountries.length > 1;
  const bias = biasDistributionForArticles(event.articles);

  useEffect(() => {
    if (coverageExpanded || coverageLoading || coverageError) return;
    const card = cardRef.current;
    if (!card || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          onVisible();
          observer.disconnect();
        }
      },
      { rootMargin: "300px 0px" },
    );
    observer.observe(card);
    return () => observer.disconnect();
  }, [coverageError, coverageExpanded, coverageLoading, onVisible]);

  return (
    <article
      ref={cardRef}
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
      aria-label={`${event.headline}. Press Enter for event details${
        hasConnections ? " and to isolate this event's map connections" : ""
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
          outlets are excluded. Labels use Ground News&apos;s U.S.-political
          reference frame. When available, the five displayed sources include
          at least one left-rated and one right-rated publisher, then favor
          center-rated publishers before prominence and recency.{" "}
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
        <p className="mt-3 text-[10px] text-[#d58a96]">
          {coverageError} Select the card to retry.
        </p>
      ) : !coverageExpanded && !coverageLoading ? (
        <p className="mt-3 text-[10px] text-[#7f8da1]">
          Broader source coverage loads automatically when this event becomes
          visible.
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
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

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
            autoFocus
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
          news feed. On startup, WorldPulse searches current reporting for
          every country before opening the interactive map. No bundled
          headlines are used. Opening a country also runs a deeper local and
          international search. WorldPulse never invents headlines or sources.
        </p>
        <p className="mt-3 text-xs leading-5 text-[#8996a8]">
          Coverage is uneven. Countries with less digital reporting or fewer
          accessible sources may appear less active. Publication volume alone
          is never treated as importance, and political summaries use neutral
          wording. Live headlines and publisher links come from public RSS
          metadata; WorldPulse does not reproduce article bodies.
        </p>
        <p className="mt-3 text-xs leading-5 text-[#8996a8]">
          Visible events automatically run an exact and keyword topic search
          across local and international Google News editions. WorldPulse
          groups rewritten headlines into one occurrence, deduplicates
          publishers by identity, and displays up to five recent matches.
          Publisher lean labels use a checked Ground News ratings snapshot
          (July 26, 2026). They describe publications—not individual articles
          or the event—use a U.S.-political reference frame, and exclude
          unrated publishers from the percentage bar. When available, source
          selection includes left- and right-rated publishers before filling
          remaining slots with center-rated reporting.
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
  const [globalFeed, setGlobalFeed] = useState<FeedState>(EMPTY_FEED);
  const [countryFeeds, setCountryFeeds] = useState<Record<string, FeedState>>(
    {},
  );
  const [liveCountryFeeds, setLiveCountryFeeds] = useState<
    Record<string, FeedState>
  >({});
  const [countryDirectoryReady, setCountryDirectoryReady] = useState(false);
  const [mapSnapshotReady, setMapSnapshotReady] = useState(false);
  const [worldLoad, setWorldLoad] = useState({
    loaded: 0,
    total: 0,
    refreshed: 0,
    retrying: 0,
    pass: 1,
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
  const coverageRequests = useRef(new Set<string>());

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
      ...rememberCountryFeed(current, key, {
        ...(current[key] ?? EMPTY_FEED),
        loading: true,
        error: null,
      }),
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
      setCountryFeeds((current) =>
        rememberCountryFeed(current, key, {
          events: buildLiveEvents(payload, country),
          updatedAt: payload.generatedAt,
          provider: `${payload.provider} · local + international discovery`,
          loading: false,
          error: null,
        }),
      );
    } catch (error) {
      setCountryFeeds((current) =>
        rememberCountryFeed(current, key, {
          ...(current[key] ?? EMPTY_FEED),
          loading: false,
          error:
            error instanceof Error
              ? error.message
              : `Local reporting for ${country.name} is temporarily unavailable.`,
        }),
      );
    }
  }, []);

  const invalidateCoverage = useCallback(() => {
    coverageRequests.current.clear();
    setEventCoverage({});
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
    if (!liveUpdates || !countryDirectoryReady) return;
    if (!countryDirectory.length) {
      setWorldLoad({
        loaded: 0,
        total: 0,
        refreshed: 0,
        retrying: 0,
        pass: 1,
      });
      setMapSnapshotReady(true);
      return;
    }

    let cancelled = false;
    let refreshTimer: number | undefined;
    const loadedCountries = new Set<string>();
    const countriesByName = new Map(
      countryDirectory.map((country) => [country.name, country]),
    );

    setLiveCountryFeeds({});
    setMapSnapshotReady(false);
    setWorldLoad({
      loaded: 0,
      total: countryDirectory.length,
      refreshed: 0,
      retrying: 0,
      pass: 1,
    });

    const wait = (delay: number) =>
      new Promise<void>((resolve) => window.setTimeout(resolve, delay));

    const fetchBatch = async (
      batch: MapCountry[],
      phase: "initial" | "refresh",
      refreshedCountries: Set<string>,
    ) => {
      try {
        const parameters = new URLSearchParams({
          scope: "map",
          countries: batch.map((country) => country.name).join("|"),
          fresh: "1",
        });
        const response = await fetch(`/api/live-news?${parameters.toString()}`);
        if (!response.ok) throw new Error("Country live search failed.");
        const payload = (await response.json()) as MapNewsPayload;
        if (cancelled) return;

        const nextFeeds: Record<string, FeedState> = {};
        for (const countryPayload of payload.countries) {
          const country = countriesByName.get(countryPayload.countryName);
          if (!country) continue;
          if (phase === "initial") loadedCountries.add(country.name);
          else refreshedCountries.add(country.name);
          if (!countryPayload.articles.length) continue;
          const livePayload: LiveNewsPayload = {
            countryName: country.name,
            scope: "country",
            generatedAt: countryPayload.generatedAt,
            refreshAfterSeconds: payload.refreshAfterSeconds,
            provider: payload.provider,
            articles: countryPayload.articles,
          };
          const events = buildLiveEvents(livePayload, country);
          if (!events.length) continue;
          nextFeeds[country.name] = {
            events,
            updatedAt: countryPayload.generatedAt,
            provider: `${payload.provider} · live world search`,
            loading: false,
            error: null,
          };
        }

        if (Object.keys(nextFeeds).length) {
          setLiveCountryFeeds((current) => ({ ...current, ...nextFeeds }));
        }
        setWorldLoad((current) => ({
          ...current,
          loaded:
            phase === "initial" ? loadedCountries.size : current.loaded,
          refreshed:
            phase === "refresh"
              ? refreshedCountries.size
              : current.refreshed,
        }));
      } catch {
        // Initial misses are retried automatically; refresh misses wait for the
        // next ten-minute sweep.
      }
    };

    const runBatches = async (
      countries: MapCountry[],
      phase: "initial" | "refresh",
    ) => {
      const batches: MapCountry[][] = [];
      for (let index = 0; index < countries.length; index += 2) {
        batches.push(countries.slice(index, index + 2));
      }
      let cursor = 0;
      const refreshedCountries = new Set<string>();
      const worker = async () => {
        while (!cancelled && cursor < batches.length) {
          const batch = batches[cursor];
          cursor += 1;
          await fetchBatch(batch, phase, refreshedCountries);
        }
      };
      await Promise.all(
        Array.from(
          { length: Math.min(3, batches.length) },
          () => worker(),
        ),
      );
    };

    const refreshWorld = async () => {
      if (cancelled) return;
      setWorldLoad((current) => ({ ...current, refreshed: 0 }));
      await runBatches(countryDirectory, "refresh");
      if (!cancelled) {
        refreshTimer = window.setTimeout(() => void refreshWorld(), 600_000);
      }
    };

    const loadWorld = async () => {
      let pass = 1;
      while (!cancelled && loadedCountries.size < countryDirectory.length) {
        const pending = countryDirectory.filter(
          (country) => !loadedCountries.has(country.name),
        );
        setWorldLoad((current) => ({
          ...current,
          retrying: pass === 1 ? 0 : pending.length,
          pass,
        }));
        await runBatches(pending, "initial");
        if (loadedCountries.size < countryDirectory.length) {
          pass += 1;
          await wait(Math.min(5_000, 1_000 * 2 ** Math.min(pass - 2, 3)));
        }
      }
      if (cancelled) return;
      setWorldLoad((current) => ({
        ...current,
        loaded: countryDirectory.length,
        retrying: 0,
      }));
      setMapSnapshotReady(true);
      refreshTimer = window.setTimeout(() => void refreshWorld(), 600_000);
    };

    void loadWorld();
    return () => {
      cancelled = true;
      if (refreshTimer !== undefined) window.clearTimeout(refreshTimer);
    };
  }, [countryDirectory, countryDirectoryReady, liveUpdates]);

  useEffect(() => {
    if (!liveUpdates || !mapSnapshotReady) return;
    void fetchCountryNews(selectedCountry);
  }, [fetchCountryNews, liveUpdates, mapSnapshotReady, selectedCountry]);

  useEffect(() => {
    if (!liveUpdates || !mapSnapshotReady) return;
    const refreshTimer = window.setInterval(() => {
      invalidateCoverage();
      if (globalView || globalFeed.updatedAt) void fetchGlobalNews();
      void fetchCountryNews(selectedCountry);
    }, 600_000);
    return () => window.clearInterval(refreshTimer);
  }, [
    fetchCountryNews,
    fetchGlobalNews,
    globalFeed.updatedAt,
    globalView,
    invalidateCoverage,
    liveUpdates,
    mapSnapshotReady,
    selectedCountry,
  ]);

  const mapCountries = useMemo(
    () =>
      countryDirectory.map((country): MapCountry => {
        const countryFeed = countryFeeds[country.name];
        const liveCountryFeed = liveCountryFeeds[country.name];
        if (
          countryFeed &&
          !countryFeed.loading &&
          !countryFeed.error
        ) {
          const mergedEvents = mergeEventFeeds(
            countryFeed.events,
            liveCountryFeed?.events ?? [],
          );
          return {
            ...country,
            events: mergedEvents,
            topEvent: mergedEvents[0],
          };
        }
        if (liveCountryFeed?.events.length) {
          return {
            ...country,
            events: liveCountryFeed.events,
            topEvent: liveCountryFeed.events[0],
          };
        }
        return country;
      }),
    [
      countryDirectory,
      countryFeeds,
      liveCountryFeeds,
    ],
  );
  const activeCountry =
    mapCountries.find((country) => country.mapId === selectedCountry.mapId) ??
    selectedCountry;
  const fetchEventCoverage = useCallback(
    async (event: Event) => {
      if (coverageRequests.current.has(event.id)) return;
      coverageRequests.current.add(event.id);
      setEventCoverage((current) => ({
        ...current,
        [event.id]: {
          ...current[event.id],
          event,
          loading: true,
          error: null,
        },
      }));
      try {
        const parameters = new URLSearchParams({
          scope: "event",
          headline: event.headline,
        });
        const eventCountry = mapCountries.find(
          (country) =>
            country.iso2 === event.primaryCountry ||
            country.name === event.primaryCountry ||
            event.affectedCountries.includes(country.iso2 ?? country.name),
        );
        if (eventCountry) {
          parameters.set("country", eventCountry.name);
          if (eventCountry.iso2) parameters.set("iso2", eventCountry.iso2);
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
            event,
            payload,
            fetchedAt: Date.now(),
            loading: false,
            error: null,
          },
        }));
      } catch (error) {
        setEventCoverage((current) => ({
          ...current,
          [event.id]: {
            ...current[event.id],
            event,
            loading: false,
            error:
              error instanceof Error
                ? error.message
                : "Broader coverage search is temporarily unavailable.",
          },
        }));
      } finally {
        coverageRequests.current.delete(event.id);
      }
    },
    [mapCountries],
  );
  const fullCountryFeed = countryFeeds[activeCountry.name];
  const liveCountryFeed = liveCountryFeeds[activeCountry.name];
  const combinedCountryFeed = useMemo(
    () =>
      fullCountryFeed && !fullCountryFeed.error
        ? {
            ...fullCountryFeed,
            events: mergeEventFeeds(
              fullCountryFeed.events,
              liveCountryFeed?.events ?? [],
            ),
          }
        : liveCountryFeed ?? fullCountryFeed,
    [fullCountryFeed, liveCountryFeed],
  );
  const activeFeed = globalView
    ? globalFeed
    : combinedCountryFeed ?? {
          events: activeCountry.events,
          updatedAt: globalFeed.updatedAt,
          provider: globalFeed.provider,
          loading: fullCountryFeed?.loading ?? globalFeed.loading,
          error: fullCountryFeed?.error ?? globalFeed.error,
        };
  const canonicalEvents = useMemo(() => {
    const registry: Event[] = [];
    const addEvents = (events: Event[], anchorCountry?: MapCountry) => {
      for (const event of events) {
        const prepared = applyDetectedGeography(
          event,
          mapCountries,
          anchorCountry,
        );
        const canonicalIndex = registry.findIndex(
          (canonicalEvent) =>
            canonicalEvent.id === prepared.id ||
            (canonicalEvent.category === prepared.category &&
              eventsDescribeSameOccurrence(canonicalEvent, prepared)),
        );
        if (canonicalIndex >= 0) {
          registry[canonicalIndex] = mergeCanonicalEvents(
            registry[canonicalIndex],
            prepared,
          );
        } else {
          registry.push(prepared);
        }
      }
    };

    addEvents(globalFeed.events);
    for (const [countryName, feed] of Object.entries(countryFeeds)) {
      addEvents(
        feed.events,
        mapCountries.find((country) => country.name === countryName),
      );
    }
    addEvents(activeFeed.events, globalView ? undefined : activeCountry);
    return registry;
  }, [
    activeCountry,
    activeFeed.events,
    countryFeeds,
    globalFeed.events,
    globalView,
    mapCountries,
  ]);
  const baseEvents = useMemo(
    () => {
      const canonicalized = activeFeed.events.map((event) => {
        const prepared = applyDetectedGeography(
          event,
          mapCountries,
          globalView ? undefined : activeCountry,
        );
        return (
          canonicalEvents.find(
            (canonicalEvent) =>
              canonicalEvent.id === prepared.id ||
              (canonicalEvent.category === prepared.category &&
                eventsDescribeSameOccurrence(canonicalEvent, prepared)),
          ) ?? prepared
        );
      });
      const seenEventIds = new Set<string>();
      return canonicalized.filter((event) => {
        if (seenEventIds.has(event.id)) return false;
        seenEventIds.add(event.id);
        return true;
      });
    },
    [
      activeCountry,
      activeFeed.events,
      canonicalEvents,
      globalView,
      mapCountries,
    ],
  );
  const expandedEvents = useMemo(
    () =>
      baseEvents
        .map((event) => {
          const payload = coverageForEvent(event, eventCoverage)?.payload;
          return payload ? enrichEventWithCoverage(event, payload) : event;
        })
        .sort(
          (left, right) =>
            right.importanceScore - left.importanceScore ||
            Date.parse(right.lastUpdatedAt) -
              Date.parse(left.lastUpdatedAt),
        ),
    [baseEvents, eventCoverage],
  );
  const presentedMapCountries = useMemo(
    () =>
      mapCountries.map((country) => {
        if (country.mapId === activeCountry.mapId && expandedEvents[0]) {
          return { ...country, topEvent: expandedEvents[0] };
        }
        if (!country.topEvent) return country;
        const prepared = applyDetectedGeography(
          country.topEvent,
          mapCountries,
          country,
        );
        const canonical =
          canonicalEvents.find(
            (event) =>
              event.id === prepared.id ||
              (event.category === prepared.category &&
                eventsDescribeSameOccurrence(event, prepared)),
          ) ?? prepared;
        const payload = coverageForEvent(canonical, eventCoverage)?.payload;
        return {
          ...country,
          topEvent: payload
            ? enrichEventWithCoverage(canonical, payload)
            : canonical,
        };
      }),
    [
      activeCountry.mapId,
      canonicalEvents,
      eventCoverage,
      expandedEvents,
      mapCountries,
    ],
  );
  const filteredEvents = (() => {
    const limitHours =
      timeRange === "24 hours"
        ? 24
        : timeRange === "3 days"
          ? 72
          : timeRange === "7 days"
            ? 168
            : Number.POSITIVE_INFINITY;
    const reference = Date.now();
    return expandedEvents.filter((event) => {
      const matchesCategory = category === "All" || event.category === category;
      const matchesImportance =
        importance === "All" || event.importanceLabel === importance;
      const matchesTime =
        !Number.isFinite(limitHours) ||
        reference - Date.parse(event.lastUpdatedAt) <=
          limitHours * 3_600_000;
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
    const coverage = coverageForEvent(event, eventCoverage);
    if (!coverage?.loading && !coverageIsFresh(coverage)) {
      void fetchEventCoverage(event);
    }
  };
  const handleEventVisible = (event: Event) => {
    const coverage = coverageForEvent(event, eventCoverage);
    if (!coverage?.loading && !coverageIsFresh(coverage) && !coverage?.error) {
      void fetchEventCoverage(event);
    }
  };
  const hasActiveFilters =
    category !== "All" ||
    importance !== "All" ||
    timeRange !== "7 days" ||
    search.trim().length > 0;
  const noRecentEvents =
    baseEvents.length > 0 &&
    filteredEvents.length === 0 &&
    !hasActiveFilters;
  const refreshActiveFeed = () => {
    invalidateCoverage();
    void (globalView
      ? fetchGlobalNews()
      : fetchCountryNews(activeCountry));
  };

  if (liveUpdates && !mapSnapshotReady) {
    const progress =
      worldLoad.total > 0
        ? Math.round((worldLoad.loaded / worldLoad.total) * 100)
        : 0;
    return (
      <main
        className="relative grid min-h-screen place-items-center overflow-hidden bg-[#080d15] px-6"
        role="status"
        aria-live="polite"
        aria-busy="true"
      >
        <div
          className="pointer-events-none absolute inset-0 opacity-80"
          aria-hidden="true"
          style={{
            background:
              "radial-gradient(circle at 50% 38%, rgba(65, 147, 139, 0.2), transparent 30%), radial-gradient(circle at 20% 70%, rgba(49, 83, 122, 0.16), transparent 25%)",
          }}
        />
        <section className="relative w-full max-w-xl rounded-2xl border border-[#304256] bg-[#0d1522]/95 p-7 shadow-2xl backdrop-blur sm:p-10">
          <div className="flex items-center gap-3">
            <div
              className="grid h-10 w-10 place-items-center rounded-full border border-[#4d776f] bg-[#132b2a] text-lg text-[#73e2cc]"
              aria-hidden="true"
            >
              ◉
            </div>
            <div>
              <div className="text-lg font-semibold tracking-[-0.03em]">
                WorldPulse
              </div>
              <div className="font-mono text-[9px] uppercase tracking-[0.2em] text-[#7f8da1]">
                Building the live world index
              </div>
            </div>
          </div>

          <h1 className="mt-10 text-2xl font-semibold tracking-[-0.04em] sm:text-3xl">
            Gathering current reporting worldwide
          </h1>
          <p className="mt-3 max-w-lg text-sm leading-6 text-[#9ca9ba]">
            WorldPulse is searching live local and international news sources
            for every country. The map opens only when the complete world sweep
            is ready—no stored headline bundle is being loaded.
          </p>

          <div className="mt-8">
            <div className="mb-2 flex items-end justify-between gap-4">
              <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-[#73e2cc]">
                {countryDirectoryReady
                  ? `${worldLoad.loaded} of ${worldLoad.total} countries`
                  : "Preparing world index…"}
              </span>
              <span className="font-mono text-xs text-[#d4dde7]">
                {progress}%
              </span>
            </div>
            <div
              className="h-2 overflow-hidden rounded-full bg-[#1a2637]"
              role="progressbar"
              aria-label="Live world news loading progress"
              aria-valuemin={0}
              aria-valuemax={worldLoad.total || 100}
              aria-valuenow={worldLoad.loaded}
            >
              <div
                className="h-full rounded-full bg-[#73e2cc] shadow-[0_0_16px_rgba(115,226,204,0.65)] transition-[width] duration-500"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>

          <div className="mt-5 flex min-h-5 items-center gap-2 font-mono text-[10px] uppercase tracking-[0.13em] text-[#7f8da1]">
            <span
              className="h-3 w-3 animate-spin rounded-full border border-[#41536a] border-t-[#73e2cc]"
              aria-hidden="true"
            />
            {worldLoad.retrying > 0
              ? `Retrying ${worldLoad.retrying} countries · pass ${worldLoad.pass}`
              : worldLoad.loaded > 0
                ? "Live country searches in progress"
                : "Connecting to live sources"}
          </div>
          <p className="mt-5 text-xs leading-5 text-[#728096]">
            The first full sweep can take several minutes because every country
            is being checked directly before the map opens.
          </p>
        </section>
      </main>
    );
  }

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
              const nextGlobalView = !globalView;
              setGlobalView(nextGlobalView);
              if (
                nextGlobalView &&
                liveUpdates &&
                !globalFeed.loading &&
                !feedIsFresh(globalFeed)
              ) {
                void fetchGlobalNews();
              }
              setConnectionEventId(null);
              setCategory("All");
              setImportance("All");
              setTimeRange("7 days");
              setSearch("");
            }}
            aria-pressed={globalView}
            className={`rounded-full border px-3 py-2 text-[10px] transition sm:px-4 ${
              globalView
                ? "border-[#73e2cc] bg-[#14332f] text-[#b7fff1]"
                : "border-[#344157] text-[#c5cfdb] hover:bg-[#151f30]"
            }`}
          >
            {globalView ? "Country feed" : "Global feed"}
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
            countries={presentedMapCountries}
            selectedMapId={globalView ? null : selectedCountry.mapId}
            onSelect={handleSelect}
            linkEvents={mapLinkEvents}
            statusLabel={
              worldLoad.total
                ? worldLoad.loaded === worldLoad.total
                  ? `${worldLoad.loaded}/${worldLoad.total} countries checked live${
                      worldLoad.refreshed
                        ? ` · ${worldLoad.refreshed} refreshed`
                        : ""
                    }`
                  : `${worldLoad.loaded}/${worldLoad.total} countries checked live`
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
                  Curves = cross-border events; select a card to isolate one
                </span>
              </div>
            </div>
            <div className="mt-2 flex flex-nowrap gap-3 overflow-x-auto pb-1 scrollbar-thin">
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
                  {filteredEvents[0]?.importanceScore ?? "—"}
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
                onClick={refreshActiveFeed}
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
                {["24 hours", "3 days", "7 days", "All indexed"].map(
                  (item) => (
                    <option key={item}>{item}</option>
                  ),
                )}
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
                    onClick={refreshActiveFeed}
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
                    coverageForEvent(event, eventCoverage)?.loading ?? false
                  }
                  coverageError={
                    coverageForEvent(event, eventCoverage)?.error ?? null
                  }
                  coverageExpanded={coverageIsFresh(
                    coverageForEvent(event, eventCoverage),
                  )}
                  onActivate={() => handleEventActivate(event)}
                  onVisible={() => handleEventVisible(event)}
                />
              ))
            ) : (
              <div className="grid min-h-60 place-items-center rounded-xl border border-dashed border-[#354157] p-8 text-center">
                <div>
                  <div className="text-2xl text-[#59687d]">◎</div>
                  <h3 className="mt-3 text-sm font-medium">
                    {noRecentEvents
                      ? "No events in the last 7 days"
                      : !globalView && !baseEvents.length && !hasActiveFilters
                        ? `No indexed news for ${activeCountry.name}`
                        : globalView && !baseEvents.length && !hasActiveFilters
                          ? "No live global events"
                          : "No matching events"}
                  </h3>
                  <p className="mt-2 text-xs leading-5 text-[#7f8da1]">
                    {noRecentEvents
                      ? "Older verified headlines are available in the current index."
                      : !globalView && !baseEvents.length && !hasActiveFilters
                        ? "No matching headlines were found in the current seven-day index. This country will refresh automatically."
                        : globalView && !baseEvents.length && !hasActiveFilters
                          ? "The global feed will refresh automatically."
                          : "Broaden the filters or try a different search term."}
                  </p>
                  {noRecentEvents ? (
                    <button
                      type="button"
                      onClick={() => setTimeRange("All indexed")}
                      className="mt-4 rounded-lg border border-[#46556b] px-3 py-2 text-[10px] text-[#cad3df] hover:bg-[#192437]"
                    >
                      Show all indexed
                    </button>
                  ) : hasActiveFilters ? (
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
            Related headlines describing the same occurrence are grouped into
            one event. Importance is an estimate, not an objective fact.
          </footer>
        </aside>
      </div>
      {showMethodology ? (
        <MethodologyModal onClose={() => setShowMethodology(false)} />
      ) : null}
    </main>
  );
}
