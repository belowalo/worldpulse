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
const INITIAL_VISIBLE_EVENT_LIMIT = 40;

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
  new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
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
  const hasFullBiasRange =
    bias.left > 0 && bias.center > 0 && bias.right > 0;

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
      { rootMargin: "120px 0px" },
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
          <span
            title="Automatically classified from the source-backed headlines for this occurrence."
          >
            Auto-classified · {event.category}
          </span>
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
          const biasBucket = rating?.bucket ?? "unrated";
          const biasClasses = {
            left:
              "border-[#a64b58] bg-[#351a23] text-[#ffc2ca] hover:border-[#e56b78] hover:bg-[#45202b]",
            center:
              "border-[#667386] bg-[#202a38] text-[#f2f5f8] hover:border-[#9ba7b6] hover:bg-[#293546]",
            right:
              "border-[#3f6eaa] bg-[#142b49] text-[#bcd9ff] hover:border-[#6198dc] hover:bg-[#19375d]",
            unrated:
              "border-[#3b485b] bg-[#172131] text-[#bdc7d4] hover:border-[#627087] hover:bg-[#1d2a3d]",
          }[biasBucket];
          const biasDotClasses = {
            left: "bg-[#f06a76]",
            center: "bg-[#edf1f5]",
            right: "bg-[#5e9bea]",
            unrated: "bg-[#758297]",
          }[biasBucket];
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
              aria-label={`Open ${article.source.publisherName} source. ${
                rating
                  ? `Publisher rating: ${rating.label}.`
                  : "Publisher bias unrated."
              }`}
              data-bias={biasBucket}
              className={`inline-flex max-w-full items-center gap-1.5 break-words rounded-md border px-2.5 py-1.5 text-[10px] transition ${biasClasses}`}
            >
              <span
                className={`h-1.5 w-1.5 shrink-0 rounded-full ${biasDotClasses}`}
                aria-hidden="true"
              />
              <span>{article.source.publisherName}</span>
              <span className="opacity-70">
                {rating?.label ?? "Unrated"} ↗
              </span>
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
            {hasFullBiasRange ? "Left · center · right" : "Viewpoint gap"} ·{" "}
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
          news feed. Before the map appears, WorldPulse checks the initial
          country snapshot and commits its colors together. No headlines are
          bundled into the website. Opening a country runs a deeper local and
          international search; once that search succeeds, its highest-ranked
          event becomes both the panel’s top story and that country’s map
          signal. The synchronized signal remains after the selection outline
          is cleared. WorldPulse never invents headlines or sources.
        </p>
        <p className="mt-3 text-xs leading-5 text-[#8996a8]">
          Coverage is uneven. Countries with less digital reporting or fewer
          accessible sources may appear neutral until a source-backed match is
          available. Publication volume alone is never treated as importance.
          Event categories are automated labels inferred from source headline
          wording, not facts supplied by the publisher; every card says so.
          Live headlines, dates, publisher names, and links come from public
          feed metadata, and WorldPulse does not reproduce article bodies.
        </p>
        <p className="mt-3 text-xs leading-5 text-[#8996a8]">
          Visible events automatically run exact, keyword, and
          viewpoint-targeted topic searches across local and international news
          results. WorldPulse groups rewritten headlines into one occurrence,
          deduplicates publishers by identity, and displays up to five recent
          matches.
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

function WorldLoadingScreen({
  checked,
  matched,
  total,
}: {
  checked: number;
  matched: number;
  total: number;
}) {
  const progress = total
    ? Math.max(3, Math.min(100, Math.round((checked / total) * 100)))
    : 3;

  return (
    <main
      className="grid min-h-screen place-items-center overflow-hidden bg-[#080d15] px-6"
      aria-busy="true"
    >
      <section className="relative w-full max-w-lg text-center">
        <div
          className="absolute left-1/2 top-4 h-56 w-56 -translate-x-1/2 rounded-full border border-[#2d4b55] opacity-60 shadow-[0_0_80px_rgba(115,226,204,0.12)]"
          aria-hidden="true"
        />
        <div
          className="absolute left-1/2 top-11 h-[10.5rem] w-[10.5rem] -translate-x-1/2 rounded-full border border-dashed border-[#3b6670] opacity-70"
          aria-hidden="true"
        />
        <div className="relative mx-auto grid h-20 w-20 place-items-center rounded-full border border-[#4d6572] bg-[#13232a] text-3xl text-[#73e2cc] shadow-[0_0_45px_rgba(115,226,204,0.18)]">
          ◉
        </div>
        <p className="relative mt-8 font-mono text-[10px] uppercase tracking-[0.24em] text-[#73e2cc]">
          WorldPulse source verification
        </p>
        <h1 className="relative mt-3 text-3xl font-semibold tracking-[-0.045em] text-white">
          Checking live world reporting
        </h1>
        <p className="relative mx-auto mt-3 max-w-md text-sm leading-6 text-[#9eabba]">
          Checking current headlines, publisher attribution, and country
          matches before the map is shown.
        </p>
        <div className="relative mt-8 overflow-hidden rounded-full bg-[#1b2737]">
          <div
            className="h-2 rounded-full bg-gradient-to-r from-[#2f8b82] via-[#73e2cc] to-[#a7fff0] transition-[width] duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>
        <div
          className="relative mt-3 flex items-center justify-between gap-3 font-mono text-[9px] uppercase tracking-[0.13em] text-[#8290a3]"
          role="status"
          aria-live="polite"
        >
          <span>
            {total
              ? `${checked}/${total} countries checked`
              : "Preparing country index"}
          </span>
          <span>{matched} source-backed matches</span>
        </div>
        <p className="relative mt-7 text-[11px] leading-5 text-[#718095]">
          No bundled or invented headlines. Countries without a source-backed
          current match remain neutral.
        </p>
      </section>
    </main>
  );
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
  const [mapSnapshotFeeds, setMapSnapshotFeeds] = useState<
    Record<string, FeedState>
  >({});
  const [countryDirectoryReady, setCountryDirectoryReady] = useState(false);
  const [initialWorldReady, setInitialWorldReady] = useState(!liveUpdates);
  const [worldLoad, setWorldLoad] = useState({
    loaded: 0,
    total: 0,
    matched: 0,
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
  const [visibleEventLimit, setVisibleEventLimit] = useState(
    INITIAL_VISIBLE_EVENT_LIMIT,
  );
  const [eventCoverage, setEventCoverage] = useState<
    Record<string, CoverageState>
  >({});
  const coverageRequests = useRef(new Set<string>());
  const activeCoverageRequests = useRef(0);

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
        matched: 0,
        refreshed: 0,
        retrying: 0,
        pass: 1,
      });
      setInitialWorldReady(true);
      return;
    }

    let cancelled = false;
    let refreshTimer: number | undefined;
    let readinessTimer: number | undefined;
    const loadedCountries = new Set<string>();
    const matchedCountries = new Set<string>();
    const missingCountries = new Set<string>();
    const scanFeeds: Record<string, FeedState> = {};
    const countriesByName = new Map(
      countryDirectory.map((country) => [country.name, country]),
    );

    setLiveCountryFeeds({});
    setMapSnapshotFeeds({});
    setInitialWorldReady(false);
    setWorldLoad({
      loaded: 0,
      total: countryDirectory.length,
      matched: 0,
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
      forceFresh = false,
    ) => {
      try {
        const parameters = new URLSearchParams({
          scope: "map",
          countries: batch.map((country) => country.name).join("|"),
        });
        if (forceFresh) parameters.set("fresh", "1");
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
          if (!countryPayload.articles.length) {
            if (phase === "initial") missingCountries.add(country.name);
            continue;
          }
          const livePayload: LiveNewsPayload = {
            countryName: country.name,
            scope: "country",
            generatedAt: countryPayload.generatedAt,
            refreshAfterSeconds: payload.refreshAfterSeconds,
            provider: payload.provider,
            articles: countryPayload.articles,
          };
          const events = buildLiveEvents(livePayload, country);
          if (!events.length) {
            if (phase === "initial") missingCountries.add(country.name);
            continue;
          }
          matchedCountries.add(country.name);
          missingCountries.delete(country.name);
          nextFeeds[country.name] = {
            events,
            updatedAt: countryPayload.generatedAt,
            provider: `${payload.provider} · live world search`,
            loading: false,
            error: null,
          };
        }

        if (Object.keys(nextFeeds).length) {
          Object.assign(scanFeeds, nextFeeds);
          setLiveCountryFeeds((current) => ({ ...current, ...nextFeeds }));
        }
        setWorldLoad((current) => ({
          ...current,
          loaded:
            phase === "initial" ? loadedCountries.size : current.loaded,
          matched: matchedCountries.size,
          refreshed:
            phase === "refresh"
              ? refreshedCountries.size
              : current.refreshed,
          retrying: missingCountries.size,
        }));
      } catch {
        if (phase === "initial") {
          for (const country of batch) missingCountries.add(country.name);
          setWorldLoad((current) => ({
            ...current,
            loaded: loadedCountries.size,
            matched: matchedCountries.size,
            retrying: missingCountries.size,
          }));
        }
        // Initial misses are retried automatically; refresh misses wait for the
        // next ten-minute sweep.
      }
    };

    const runBatches = async (
      countries: MapCountry[],
      phase: "initial" | "refresh",
      forceFresh = false,
    ) => {
      const batches: MapCountry[][] = [];
      for (let index = 0; index < countries.length; index += 8) {
        batches.push(countries.slice(index, index + 8));
      }
      let cursor = 0;
      const refreshedCountries = new Set<string>();
      const worker = async () => {
        while (!cancelled && cursor < batches.length) {
          const batch = batches[cursor];
          cursor += 1;
          await fetchBatch(batch, phase, refreshedCountries, forceFresh);
        }
      };
      await Promise.all(
        Array.from(
          {
            length: Math.min(forceFresh ? 1 : 4, batches.length),
          },
          () => worker(),
        ),
      );
    };

    const refreshWorld = async () => {
      if (cancelled) return;
      setWorldLoad((current) => ({ ...current, refreshed: 0 }));
      await runBatches(countryDirectory, "refresh", true);
      if (!cancelled) {
        setMapSnapshotFeeds({ ...scanFeeds });
        refreshTimer = window.setTimeout(() => void refreshWorld(), 600_000);
      }
    };

    const loadWorld = async () => {
      readinessTimer = window.setTimeout(() => {
        if (cancelled) return;
        setMapSnapshotFeeds({ ...scanFeeds });
        setInitialWorldReady(true);
      }, 12_000);
      await runBatches(countryDirectory, "initial");
      if (cancelled) return;
      if (readinessTimer !== undefined) {
        window.clearTimeout(readinessTimer);
        readinessTimer = undefined;
      }
      setWorldLoad((current) => ({
        ...current,
        loaded: loadedCountries.size,
        matched: matchedCountries.size,
        retrying: missingCountries.size,
      }));
      setMapSnapshotFeeds({ ...scanFeeds });
      setInitialWorldReady(true);
      let pass = 2;
      while (!cancelled && missingCountries.size && pass <= 4) {
        await wait(Math.min(30_000, 5_000 * 2 ** Math.min(pass - 2, 3)));
        if (cancelled) return;
        const pending = countryDirectory.filter((country) =>
          missingCountries.has(country.name),
        );
        setWorldLoad((current) => ({
          ...current,
          retrying: pending.length,
          pass,
        }));
        await runBatches(pending, "initial", true);
        if (!cancelled) setMapSnapshotFeeds({ ...scanFeeds });
        pass += 1;
        setWorldLoad((current) => ({
          ...current,
          matched: matchedCountries.size,
          retrying: missingCountries.size,
          pass,
        }));
      }
      if (!cancelled) {
        refreshTimer = window.setTimeout(() => void refreshWorld(), 120_000);
      }
    };

    void loadWorld();
    return () => {
      cancelled = true;
      if (refreshTimer !== undefined) window.clearTimeout(refreshTimer);
      if (readinessTimer !== undefined) window.clearTimeout(readinessTimer);
    };
  }, [countryDirectory, countryDirectoryReady, liveUpdates]);

  useEffect(() => {
    if (!liveUpdates) return;
    void fetchCountryNews(selectedCountry);
  }, [fetchCountryNews, liveUpdates, selectedCountry]);

  useEffect(() => {
    if (!liveUpdates) return;
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
    selectedCountry,
  ]);

  const mapCountries = useMemo(
    () =>
      countryDirectory.map((country): MapCountry => {
        const detailedFeed = countryFeeds[country.name];
        const authoritativeFeed =
          detailedFeed?.events.length && !detailedFeed.error
            ? detailedFeed
            : mapSnapshotFeeds[country.name];
        if (authoritativeFeed?.events.length) {
          const synchronizedEvents = authoritativeFeed.events
            .map((event) => {
              const payload = coverageForEvent(event, eventCoverage)?.payload;
              return payload ? enrichEventWithCoverage(event, payload) : event;
            })
            .sort(
              (left, right) =>
                right.importanceScore - left.importanceScore ||
                Date.parse(right.lastUpdatedAt) -
                  Date.parse(left.lastUpdatedAt),
            );
          return {
            ...country,
            events: synchronizedEvents,
            topEvent: synchronizedEvents[0],
          };
        }
        return country;
      }),
    [countryDirectory, countryFeeds, eventCoverage, mapSnapshotFeeds],
  );
  const activeCountry =
    mapCountries.find((country) => country.mapId === selectedCountry.mapId) ??
    selectedCountry;
  const fetchEventCoverage = useCallback(
    async (event: Event) => {
      if (coverageRequests.current.has(event.id)) return;
      coverageRequests.current.add(event.id);
      while (activeCoverageRequests.current >= 2) {
        await new Promise<void>((resolve) =>
          window.setTimeout(resolve, 120),
        );
      }
      activeCoverageRequests.current += 1;
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
        activeCoverageRequests.current = Math.max(
          0,
          activeCoverageRequests.current - 1,
        );
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
          loading:
            fullCountryFeed?.loading ??
            (liveUpdates ? true : globalFeed.loading),
          error: fullCountryFeed?.error ?? globalFeed.error,
        };
  const canonicalEvents = useMemo(() => {
    const registry: Event[] = [];
    const addEvents = (
      events: Event[],
      anchorCountry?: MapCountry,
      assumeDistinct = false,
    ) => {
      for (const event of events) {
        const prepared = applyDetectedGeography(
          event,
          mapCountries,
          anchorCountry,
        );
        if (assumeDistinct) {
          registry.push(prepared);
          continue;
        }
        const canonicalIndex = registry.findIndex(
          (canonicalEvent) =>
            canonicalEvent.id === prepared.id ||
            eventsDescribeSameOccurrence(canonicalEvent, prepared),
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

    // The global feed is already occurrence-clustered by buildLiveEvents.
    // Seed the registry directly, then reconcile the smaller country feeds
    // against it.
    addEvents(globalFeed.events, undefined, true);
    for (const [countryName, feed] of Object.entries(countryFeeds)) {
      addEvents(
        feed.events,
        mapCountries.find((country) => country.name === countryName),
      );
    }
    if (!globalView) addEvents(activeFeed.events, activeCountry);
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
      const canonicalById = new Map(
        canonicalEvents.map((event) => [event.id, event]),
      );
      const canonicalized = activeFeed.events.map((event) => {
        const prepared = applyDetectedGeography(
          event,
          mapCountries,
          globalView ? undefined : activeCountry,
        );
        return (
          canonicalById.get(prepared.id) ??
          canonicalEvents.find((canonicalEvent) =>
            eventsDescribeSameOccurrence(canonicalEvent, prepared),
          ) ??
          prepared
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
  const visibleEvents = filteredEvents.slice(0, visibleEventLimit);
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
    setVisibleEventLimit(INITIAL_VISIBLE_EVENT_LIMIT);
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
  const displayedMapCountries = useMemo(() => {
    const displayedTopEvent =
      !globalView && !hasActiveFilters ? filteredEvents[0] : undefined;
    if (!displayedTopEvent) return mapCountries;
    return mapCountries.map((country) =>
      country.mapId === activeCountry.mapId
        ? {
            ...country,
            topEvent: displayedTopEvent,
            events: [
              displayedTopEvent,
              ...country.events.filter(
                (event) => event.id !== displayedTopEvent.id,
              ),
            ],
          }
        : country,
    );
  }, [
    activeCountry.mapId,
    filteredEvents,
    globalView,
    hasActiveFilters,
    mapCountries,
  ]);
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

  if (liveUpdates && !initialWorldReady) {
    return (
      <WorldLoadingScreen
        checked={worldLoad.loaded}
        matched={worldLoad.matched}
        total={worldLoad.total}
      />
    );
  }

  return (
    <main className="min-h-screen bg-[#080d15]">
      <header className="sticky top-0 z-40 flex h-16 items-center justify-between border-b border-[#222d3e] bg-[#080d15]/95 px-3 backdrop-blur sm:px-6">
        <div className="flex items-center gap-3">
          <div className="grid h-8 w-8 place-items-center rounded-full border border-[#4d6572] bg-[#13232a] text-sm text-[#73e2cc]">
            ◉
          </div>
          <div>
            <div className="text-sm font-semibold tracking-[-0.02em]">
              WorldPulse
            </div>
            <div className="hidden font-mono text-[8px] uppercase tracking-[0.19em] text-[#7f8da1] sm:block">
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
              setVisibleEventLimit(INITIAL_VISIBLE_EVENT_LIMIT);
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
            className={`whitespace-nowrap rounded-full border px-2.5 py-2 text-[10px] transition sm:px-4 ${
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
            className="whitespace-nowrap rounded-full border border-[#344157] px-2.5 py-2 text-[10px] text-[#c5cfdb] hover:bg-[#151f30] sm:px-4"
          >
            Methodology
          </button>
        </nav>
      </header>

      <div className="grid min-h-[calc(100vh-4rem)] lg:grid-cols-[minmax(0,1fr)_420px]">
        <section className="relative min-h-[54vh] border-b border-[#222d3e] lg:h-[calc(100vh-4rem)] lg:border-b-0 lg:border-r">
          <MapComponent
            countries={displayedMapCountries}
            selectedMapId={globalView ? null : selectedCountry.mapId}
            onSelect={handleSelect}
            linkEvents={mapLinkEvents}
            statusLabel={
              worldLoad.total
                ? `${worldLoad.matched}/${worldLoad.total} source-backed country signals${
                    worldLoad.refreshed
                      ? ` · ${worldLoad.refreshed} refreshed`
                      : worldLoad.retrying
                        ? " · unmatched countries retrying"
                        : " · live"
                  }`
                : countryDirectoryReady
                  ? "Starting live world scan…"
                  : "Preparing live world index…"
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
              <div className="flex shrink-0 items-center gap-1.5 text-[9px] text-[#b7c1ce]">
                <span
                  className="h-2 w-2 rounded-full bg-[#5a6573]"
                  aria-hidden="true"
                />
                No source-backed match
              </div>
            </div>
          </div>
        </section>

        <aside
          className="flex min-h-[620px] flex-col bg-[#101722] lg:h-[calc(100vh-4rem)] lg:min-h-0"
          aria-label={globalView ? "Global events" : "Country news panel"}
        >
          <div className="sticky top-16 z-20 border-b border-[#273246] bg-[#101722]/95 px-5 pb-4 pt-5 backdrop-blur lg:static">
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
                  setVisibleEventLimit(INITIAL_VISIBLE_EVENT_LIMIT);
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
                  setVisibleEventLimit(INITIAL_VISIBLE_EVENT_LIMIT);
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
                  setVisibleEventLimit(INITIAL_VISIBLE_EVENT_LIMIT);
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
                  setVisibleEventLimit(INITIAL_VISIBLE_EVENT_LIMIT);
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
              <>
                {visibleEvents.map((event) => (
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
                ))}
                {visibleEvents.length < filteredEvents.length ? (
                  <div className="border-t border-[#273246] pt-5 text-center">
                    <p className="text-[10px] text-[#7f8da1]">
                      Showing {visibleEvents.length} of {filteredEvents.length}{" "}
                      matching events
                    </p>
                    <button
                      type="button"
                      onClick={() =>
                        setVisibleEventLimit((current) => current + 40)
                      }
                      className="mt-3 rounded-lg border border-[#46556b] px-4 py-2 text-[10px] font-medium text-[#cad3df] transition hover:border-[#73e2cc] hover:bg-[#16302e] hover:text-white"
                    >
                      Load 40 more
                    </button>
                  </div>
                ) : null}
              </>
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
                      onClick={() => {
                        setTimeRange("All indexed");
                        setVisibleEventLimit(INITIAL_VISIBLE_EVENT_LIMIT);
                      }}
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
                        setVisibleEventLimit(INITIAL_VISIBLE_EVENT_LIMIT);
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
            and international reporting. A recent live index appears
            immediately while a fresh sweep runs in the background. Related
            headlines describing the same occurrence are grouped into one
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
