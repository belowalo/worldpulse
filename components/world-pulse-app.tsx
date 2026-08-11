"use client";

import dynamic from "next/dynamic";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type ComponentType,
  type ReactNode,
} from "react";
import {
  buildLiveEvents,
  enrichEventWithCoverage,
  eventsDescribeSameOccurrence,
  mergeCanonicalEvents,
  mergeEventFeeds,
} from "@/lib/live-news";
import {
  decodePreparedWorldPayload,
  isCompletePreparedWorld,
  isPreparedWorldFresh,
} from "@/lib/prepared-world";
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
  type PreparedWorldNewsPayload,
  type PreparedWorldNewsWirePayload,
} from "@/lib/types";
import {
  countryPulses,
  defaultCountry,
} from "@/lib/seed-data";
import { categoryColor } from "@/lib/scoring";
import {
  isPreparedWorldNewsWire,
  parsePreparedWorldResponseBytes,
} from "@/lib/snapshot-transport";
import {
  applyDetectedGeography,
  prepareWorldSnapshotFeeds,
} from "@/lib/world-snapshot";
import {
  loadWorldGeometry,
  preloadWorldGlobe,
  type WorldMapProps,
} from "./world-map";

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
type TimeFilter = "24 hours" | "3 days" | "7 days" | "All stories";

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

const INITIAL_VISIBLE_EVENT_LIMIT = 40;
const LIVE_REQUEST_TIMEOUT_MS = 30_000;
const WORLD_BATCH_REQUEST_TIMEOUT_MS = 60_000;
const WORLD_BATCH_SIZE = 12;
const WORLD_BATCH_CONCURRENCY = 6;
let worldSnapshotPromise: Promise<MapNewsPayload> | null = null;
let worldSnapshotFetchIdentity: typeof fetch | null = null;
let preparedWorldPromise: Promise<PreparedWorldNewsPayload> | null = null;
let preparedWorldFetchIdentity: typeof fetch | null = null;

function loadPreparedWorld({ fresh = false }: { fresh?: boolean } = {}) {
  if (preparedWorldFetchIdentity !== fetch) {
    preparedWorldPromise = null;
    preparedWorldFetchIdentity = fetch;
  }
  if (fresh) preparedWorldPromise = null;
  const supportsCompressedSnapshots =
    typeof globalThis.DecompressionStream !== "undefined";
  const preparedWorldUrl = supportsCompressedSnapshots
    ? "/api/live-news?scope=prepared-world"
    : "/api/live-news?scope=prepared-world&plain=1";
  preparedWorldPromise ??= fetch(preparedWorldUrl, {
    signal: AbortSignal.timeout(WORLD_BATCH_REQUEST_TIMEOUT_MS),
  }).then(async (response) => {
    if (!response.ok) {
      throw new Error("The minute world state is unavailable.");
    }
    const responseBytes = new Uint8Array(await response.arrayBuffer());
    const responsePayload = await parsePreparedWorldResponseBytes(responseBytes);
    return decodePreparedWorldPayload(
      isPreparedWorldNewsWire(responsePayload)
        ? responsePayload
        : (responsePayload as PreparedWorldNewsPayload),
    );
  }).catch((error) => {
    preparedWorldPromise = null;
    throw error;
  });
  return preparedWorldPromise;
}

function loadWorldSnapshot() {
  if (worldSnapshotFetchIdentity !== fetch) {
    worldSnapshotPromise = null;
    worldSnapshotFetchIdentity = fetch;
  }
  worldSnapshotPromise ??= fetch("/api/live-news?scope=snapshot", {
    signal: AbortSignal.timeout(WORLD_BATCH_REQUEST_TIMEOUT_MS),
  }).then(async (response) => {
    if (!response.ok) {
      throw new Error("The prepared world snapshot is unavailable.");
    }
    return (await response.json()) as MapNewsPayload;
  });
  return worldSnapshotPromise;
}

function prepareWorldSnapshotOffThread(
  payloads: MapNewsPayload["countries"],
  countries: MapCountry[],
): Promise<Record<string, FeedState>> {
  if (typeof Worker === "undefined") {
    return Promise.resolve(prepareWorldSnapshotFeeds(payloads, countries));
  }
  return new Promise((resolve, reject) => {
    const snapshotWorker = new Worker(
      new URL("../lib/world-snapshot.worker.ts", import.meta.url),
      { type: "module" },
    );
    const timeout = window.setTimeout(() => {
      snapshotWorker.terminate();
      reject(new Error("Prepared world processing timed out."));
    }, WORLD_BATCH_REQUEST_TIMEOUT_MS);
    snapshotWorker.onmessage = (
      event: MessageEvent<Record<string, FeedState>>,
    ) => {
      window.clearTimeout(timeout);
      snapshotWorker.terminate();
      resolve(event.data);
    };
    snapshotWorker.onerror = () => {
      window.clearTimeout(timeout);
      snapshotWorker.terminate();
      reject(new Error("Prepared world processing failed."));
    };
    snapshotWorker.postMessage({ payloads, countries });
  });
}

function chunkItems<T>(items: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
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
  new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));

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
  hasConnections,
  connectionFocused,
  coverageLoading,
  coverageError,
  coverageExpanded,
  onActivate,
  onVisible,
}: {
  event: Event;
  hasConnections: boolean;
  connectionFocused: boolean;
  coverageLoading: boolean;
  coverageError: string | null;
  coverageExpanded: boolean;
  onActivate: () => void;
  onVisible: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [showOriginal, setShowOriginal] = useState(false);
  const cardRef = useRef<HTMLElement | null>(null);
  const bias = biasDistributionForArticles(event.articles);
  const hasFullBiasRange =
    bias.left > 0 && bias.center > 0 && bias.right > 0;
  const hasOriginal =
    Boolean(event.originalHeadline) &&
    event.originalHeadline !== event.headline;
  const displayedHeadline =
    showOriginal && event.originalHeadline
      ? event.originalHeadline
      : event.headline;
  const displayedSummary =
    showOriginal && event.originalSummary
      ? event.originalSummary
      : event.summary;

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
          {event.category}
        </span>
        <ImportancePill event={event} />
        {hasOriginal ? (
          <button
            type="button"
            onClick={() => setShowOriginal((value) => !value)}
            className="rounded-full border border-[#405068] px-2 py-1 font-mono text-[8px] uppercase tracking-[0.1em] text-[#c8d2df] transition hover:border-[#73e2cc] hover:text-white"
          >
            {showOriginal
              ? "English"
              : event.originalLanguage
                ? `Original · ${event.originalLanguage.toUpperCase()}`
                : "Original"}
          </button>
        ) : null}
        {coverageLoading ? (
          <span className="font-mono text-[8px] uppercase tracking-[0.12em] text-[#73e2cc]">
            Finding coverage…
          </span>
        ) : null}
      </div>
      <h3
        dir="auto"
        className="mt-3 break-words text-lg font-semibold leading-snug tracking-[-0.025em] text-white"
      >
        {displayedHeadline}
      </h3>
      <p
        dir="auto"
        className="mt-2 break-words text-sm leading-6 text-[#b5bfcd]"
      >
        {displayedSummary}
      </p>
      <div className="mt-4 grid grid-cols-3 gap-3">
        <Metric label="Scope" value={event.geographicScope} />
        <Metric label="Updated" value={formatTime(event.lastUpdatedAt)} />
        <Metric
          label="Sources"
          value={
            (event.matchedPublisherCount ??
              event.scoringInput.independentSourceCount) >
            event.articles.length
              ? `${event.articles.length} shown · ${
                  event.matchedPublisherCount ??
                  event.scoringInput.independentSourceCount
                } matched`
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
      className="fixed inset-0 z-50 grid place-items-center bg-black/75 p-4 backdrop-blur-md"
      role="dialog"
      aria-modal="true"
      aria-labelledby="methodology-title"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section className="max-h-[88vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-[#344157] bg-[#0e1724] p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-[#73e2cc]">
              How WorldPulse works
            </p>
            <h2
              id="methodology-title"
              className="mt-2 text-2xl font-semibold tracking-[-0.04em]"
            >
              Transparent signals, careful limits
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            autoFocus
            className="rounded-full border border-[#3a4659] px-3 py-1.5 text-sm text-[#cad2dd] hover:bg-[#1a2537]"
          >
            Close
          </button>
        </div>
        <p className="mt-5 text-sm leading-6 text-[#b5bfcd]">
          WorldPulse groups public headline metadata into developing events and
          estimates their relative impact on a 0–100 scale. The score is an
          orientation tool, not an objective fact or a judgment about human
          worth.
        </p>
        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          {[
            ["25%", "Independent sources and source-country diversity"],
            ["25%", "Countries affected and their relative significance"],
            ["20%", "Publisher prominence"],
            ["15%", "Recency"],
            ["15%", "Coverage velocity"],
          ].map(([weight, text]) => (
            <div
              key={text}
              className="flex gap-4 rounded-xl border border-[#26354a] bg-[#152132] px-4 py-3"
            >
              <span className="w-10 font-mono text-xs text-[#73e2cc]">
                {weight}
              </span>
              <span className="text-xs leading-5 text-[#d0d8e3]">{text}</span>
            </div>
          ))}
        </div>
        <div className="mt-6 space-y-4 text-xs leading-5 text-[#8996a8]">
          <p>
            Reports enter a country feed only when that country is explicitly
            identified in available headline metadata. A country with no
            current verified match stays neutral; WorldPulse does not invent a
            story to fill the map. Coverage can still be uneven where
            accessible digital reporting is limited.
          </p>
          <p>
            Similar headlines are clustered conservatively, publishers are
            deduplicated by identity, and event summaries are short extracts
            from available feed descriptions rather than generated claims. The
            globe draws a connection only after a story is selected and only
            when at least two countries are explicitly named in that story’s
            headline evidence. Capital markers are geographic reference points,
            not claims that an event occurred in the capital.
          </p>
          <p>
            Publisher lean labels use a checked Ground News ratings snapshot
            dated July 26, 2026. They describe publications—not individual
            articles or events—use a U.S.-political reference frame, and exclude
            unrated publishers from percentage calculations. Where available,
            source selection broadens viewpoint representation before using
            prominence and recency as tie-breakers.
          </p>
        </div>
      </section>
    </div>
  );
}

function NewsModalShell({
  children,
  description,
  eyebrow,
  onClose,
  title,
  titleId,
}: {
  children: ReactNode;
  description: string;
  eyebrow: string;
  onClose: () => void;
  title: string;
  titleId: string;
}) {
  return (
    <div
      className="fixed inset-0 z-50 overflow-y-auto bg-[#04070d]/97 px-4 py-4 backdrop-blur-xl sm:px-7 sm:py-7"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      <section className="mx-auto w-full max-w-7xl pb-8">
        <header className="sticky top-0 z-20 flex items-start justify-between gap-5 rounded-2xl border border-[#2a384c] bg-[#08111d]/95 px-5 py-5 shadow-[0_18px_60px_rgba(0,0,0,0.3)] backdrop-blur-xl sm:px-6">
          <div>
            <div className="flex items-center gap-2">
              <span
                className="h-1.5 w-1.5 rounded-full bg-[#ff6874] shadow-[0_0_10px_rgba(255,104,116,0.8)]"
                aria-hidden="true"
              />
              <p className="font-mono text-[9px] uppercase tracking-[0.24em] text-[#ff7b85]">
                {eyebrow}
              </p>
            </div>
            <h2
              id={titleId}
              className="mt-2 text-3xl font-semibold tracking-[-0.045em] text-white"
            >
              {title}
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-[#92a0b3]">
              {description}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            autoFocus
            className="shrink-0 rounded-full border border-[#3a4659] bg-[#0d1724] px-4 py-2 text-xs text-[#d4dce7] transition hover:border-[#5b6c83] hover:bg-[#182335]"
          >
            Close
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}

function LiveSituationModal({
  events,
  onClose,
}: {
  events: Event[];
  onClose: () => void;
}) {
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  const stories = events.slice(0, 12);
  return (
    <NewsModalShell
      titleId="live-situation-title"
      eyebrow="Updated live"
      title="Top Stories"
      description="The twelve strongest current global stories, with one primary source per story for a fast, uncluttered briefing."
      onClose={onClose}
    >
        {stories.length ? (
          <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {stories.map((event, index) => {
              const source =
                event.articles.find((article) => article.imageUrl) ??
                event.articles[0];
              const content = (
                <div className="relative z-10 flex min-h-64 flex-col p-5">
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-[#8593a6]">
                      Story {String(index + 1).padStart(2, "0")}
                    </span>
                    <span
                      className="rounded-full border px-2 py-1 font-mono text-[8px] uppercase tracking-[0.12em]"
                      style={{
                        borderColor: `${categoryColor(event.category)}70`,
                        color: categoryColor(event.category),
                      }}
                    >
                      {event.importanceLabel} · {event.importanceScore}
                    </span>
                  </div>
                  <div
                    className="mt-5 h-px w-12"
                    style={{ background: categoryColor(event.category) }}
                  />
                  <h3
                    dir="auto"
                    className="mt-4 text-lg font-semibold leading-snug tracking-[-0.025em] text-white"
                  >
                    {event.headline}
                  </h3>
                  <p
                    dir="auto"
                    className="mt-3 line-clamp-3 text-xs leading-5 text-[#a9b4c3]"
                  >
                    {event.summary}
                  </p>
                  <div className="mt-auto flex items-center justify-between gap-3 border-t border-white/10 pt-4 font-mono text-[8px] uppercase tracking-[0.12em] text-[#aeb9c8]">
                    <span>{source?.source.publisherName ?? event.category}</span>
                    <span>{formatTime(event.lastUpdatedAt)}</span>
                  </div>
                </div>
              );
              const backdrop = source?.imageUrl ? (
                <div
                  aria-hidden="true"
                  className="absolute inset-0 bg-cover bg-center opacity-45 transition duration-500 group-hover:scale-[1.025] group-hover:opacity-55"
                  style={{ backgroundImage: `url("${source.imageUrl}")` }}
                />
              ) : (
                <div
                  aria-hidden="true"
                  className="absolute inset-0 opacity-25"
                  style={{
                    background: `radial-gradient(circle at 85% 15%, ${categoryColor(event.category)}, transparent 52%)`,
                  }}
                />
              );
              return source?.originalUrl ? (
                <a
                  key={event.id}
                  href={source.originalUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="group relative isolate min-h-64 overflow-hidden rounded-2xl border border-[#2a394e] bg-[#0b131f] shadow-[0_18px_60px_rgba(0,0,0,0.22)] transition hover:-translate-y-0.5 hover:border-[#52667f]"
                >
                  {backdrop}
                  <div
                    aria-hidden="true"
                    className="absolute inset-0 bg-[linear-gradient(180deg,rgba(5,9,16,0.34),rgba(5,9,16,0.9)_66%,#08101b)]"
                  />
                  {content}
                </a>
              ) : (
                <article
                  key={event.id}
                  className="group relative isolate min-h-64 overflow-hidden rounded-2xl border border-[#2a394e] bg-[#0b131f]"
                >
                  {backdrop}
                  <div
                    aria-hidden="true"
                    className="absolute inset-0 bg-[linear-gradient(180deg,rgba(5,9,16,0.34),rgba(5,9,16,0.9)_66%,#08101b)]"
                  />
                  {content}
                </article>
              );
            })}
          </div>
        ) : (
          <div className="mt-6 rounded-2xl border border-dashed border-[#34445a] p-12 text-center text-sm text-[#8996a8]">
            Top stories are still settling. Try again shortly.
          </div>
        )}
    </NewsModalShell>
  );
}

interface LiveVideo {
  id: string;
  title: string;
  channelName: string;
  newsroomName?: string;
  coverageDescription?: string;
  viewerCount: number;
  thumbnailUrl?: string;
  watchUrl: string;
  embedUrl: string;
}

interface LiveVideoState {
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  videos: LiveVideo[];
  selectedVideoId: string;
  generatedAt: string | null;
}

const LIVE_DIRECTORY_REFRESH_MS = 90_000;

function formatViewerCount(value: number) {
  return new Intl.NumberFormat("en", {
    notation: value >= 1_000 ? "compact" : "standard",
    maximumFractionDigits: 1,
  }).format(value);
}

function LiveNewsDirectory() {
  const requestRef = useRef<AbortController | null>(null);
  const [coverage, setCoverage] = useState<LiveVideoState>({
    loading: true,
    refreshing: false,
    error: null,
    videos: [],
    selectedVideoId: "",
    generatedAt: null,
  });

  const loadNewsrooms = useCallback(async (initial: boolean) => {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setCoverage((current) => ({
      ...current,
      loading: initial && !current.videos.length,
      refreshing: !initial || Boolean(current.videos.length),
      error: null,
    }));
    try {
      const response = await fetch("/api/live-video?mode=newsrooms", {
        signal: controller.signal,
      });
      const payload = (await response.json()) as {
        error?: string;
        generatedAt?: string;
        videos?: LiveVideo[];
      };
      if (!response.ok) {
        throw new Error(
          payload.error ?? "Live newsrooms could not be checked right now.",
        );
      }
      const videos = payload.videos ?? [];
      setCoverage((current) => ({
        loading: false,
        refreshing: false,
        error: null,
        videos,
        selectedVideoId: videos.some(
          (video) => video.id === current.selectedVideoId,
        )
          ? current.selectedVideoId
          : (videos[0]?.id ?? ""),
        generatedAt: payload.generatedAt ?? new Date().toISOString(),
      }));
    } catch (error) {
      if (controller.signal.aborted) return;
      setCoverage((current) => ({
        ...current,
        loading: false,
        refreshing: false,
        error:
          error instanceof Error
            ? error.message
            : "Live newsrooms could not be checked right now.",
      }));
    }
  }, []);

  useEffect(() => {
    void loadNewsrooms(true);
    const interval = window.setInterval(() => {
      if (!document.hidden) void loadNewsrooms(false);
    }, LIVE_DIRECTORY_REFRESH_MS);
    const refreshWhenVisible = () => {
      if (!document.hidden) void loadNewsrooms(false);
    };
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
      requestRef.current?.abort();
    };
  }, [loadNewsrooms]);

  if (coverage.loading) {
    return (
      <div
        className="mt-6 grid min-h-[420px] place-items-center rounded-2xl border border-[#313d50] bg-[#080e17]"
        aria-busy="true"
      >
        <div className="text-center">
          <div className="mx-auto h-7 w-7 animate-spin rounded-full border-2 border-[#4e5e73] border-t-[#ff6874]" />
          <p className="mt-4 font-mono text-[9px] uppercase tracking-[0.18em] text-[#8290a3]">
            Checking the live newsrooms
          </p>
        </div>
      </div>
    );
  }

  if (coverage.error && !coverage.videos.length) {
    return (
      <div className="mt-6 grid min-h-[360px] place-items-center rounded-2xl border border-[#4a3037] bg-[#140c11] px-6 text-center">
        <div>
          <p className="text-lg font-semibold text-white">
            Live newsrooms could not be checked
          </p>
          <p className="mt-2 text-xs leading-5 text-[#a9999f]">
            {coverage.error}
          </p>
          <button
            type="button"
            onClick={() => void loadNewsrooms(true)}
            className="mt-5 rounded-full border border-[#70414a] px-4 py-2 text-[10px] text-[#f1c1c6] transition hover:bg-[#2a1117]"
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  if (!coverage.videos.length) {
    return (
      <div className="mt-6 grid min-h-[360px] place-items-center rounded-2xl border border-[#343f50] bg-[#09111c] px-6 text-center">
        <div className="max-w-lg">
          <div className="mx-auto h-3 w-3 rounded-full bg-[#5d6979]" />
          <p className="mt-4 text-xl font-semibold text-white">
            No major newsrooms are live right now
          </p>
          <p className="mt-2 text-xs leading-5 text-[#8996a8]">
            WorldPulse will check again automatically, or you can refresh now.
          </p>
          <button
            type="button"
            onClick={() => void loadNewsrooms(false)}
            className="mt-5 rounded-full border border-[#3a4659] px-4 py-2 text-[10px] text-[#cad2dd] transition hover:bg-[#182335]"
          >
            Refresh live directory
          </button>
        </div>
      </div>
    );
  }

  const selectedVideo =
    coverage.videos.find((video) => video.id === coverage.selectedVideoId) ??
    coverage.videos[0];
  const updatedAt = coverage.generatedAt
    ? new Date(coverage.generatedAt).toLocaleTimeString("en", {
        hour: "numeric",
        minute: "2-digit",
      })
    : null;

  return (
    <>
      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <div aria-live="polite" className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-[#ff5964] shadow-[0_0_10px_#ff5964]" />
          <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-[#aab5c4]">
            {coverage.refreshing
              ? "Updating live directory"
              : `${coverage.videos.length} newsrooms live${updatedAt ? ` · Updated ${updatedAt}` : ""}`}
          </span>
        </div>
        <button
          type="button"
          onClick={() => void loadNewsrooms(false)}
          disabled={coverage.refreshing}
          className="rounded-full border border-[#3a4659] px-3 py-2 text-[9px] uppercase tracking-[0.12em] text-[#cad2dd] transition hover:bg-[#182335] disabled:cursor-wait disabled:opacity-60"
        >
          {coverage.refreshing ? "Refreshing" : "Refresh"}
        </button>
      </div>

      {coverage.error ? (
        <p className="mt-3 text-[10px] text-[#c89a9f]" role="status">
          The latest update was delayed. The current directory remains available.
        </p>
      ) : null}

      <div className="mt-4 grid gap-5 xl:grid-cols-[minmax(0,1fr)_390px]">
        <div className="overflow-hidden rounded-2xl border border-[#2a394e] bg-black shadow-[0_18px_60px_rgba(0,0,0,0.3)]">
          <div className="aspect-video">
            <iframe
              key={selectedVideo.id}
              className="h-full w-full"
              src={selectedVideo.embedUrl}
              title={`${selectedVideo.newsroomName ?? selectedVideo.channelName}: ${selectedVideo.title}`}
              allow="autoplay; encrypted-media; picture-in-picture"
              allowFullScreen
            />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#2a3445] bg-[#0a101a] px-4 py-3">
            <div className="min-w-0">
              <div className="font-mono text-[8px] uppercase tracking-[0.16em] text-[#ff7480]">
                Top live coverage
              </div>
              <div className="mt-1 truncate text-sm font-semibold text-white">
                {selectedVideo.newsroomName ?? selectedVideo.channelName}
              </div>
              <div className="mt-1 line-clamp-2 text-[10px] leading-4 text-[#8996a8]">
                {selectedVideo.title}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-[#ff7a84]">
                {selectedVideo.viewerCount
                  ? `${formatViewerCount(selectedVideo.viewerCount)} watching`
                  : "Live"}
              </span>
              <a
                href={selectedVideo.watchUrl}
                target="_blank"
                rel="noreferrer"
                className="rounded-full border border-[#3a4659] px-3 py-2 text-[10px] text-[#cad2dd] transition hover:bg-[#182335]"
              >
                Open feed
              </a>
            </div>
          </div>
        </div>

        <aside className="rounded-2xl border border-[#2a394e] bg-[#0b131f] p-4 shadow-[0_18px_60px_rgba(0,0,0,0.18)]">
          <div className="flex items-end justify-between gap-3">
            <div>
              <p className="font-mono text-[9px] uppercase tracking-[0.2em] text-[#718197]">
                Across the newsrooms
              </p>
              <p className="mt-1 text-[10px] text-[#647287]">
                What leading channels are covering now
              </p>
            </div>
            <span className="font-mono text-[8px] uppercase text-[#ff7480]">
              Live
            </span>
          </div>
          <div className="mt-3 max-h-[620px] space-y-2 overflow-y-auto pr-1">
            {coverage.videos.map((video) => (
              <button
                type="button"
                key={video.id}
                aria-label={`Watch ${video.newsroomName ?? video.channelName}: ${video.title}`}
                aria-pressed={video.id === selectedVideo.id}
                onClick={() =>
                  setCoverage((current) => ({
                    ...current,
                    selectedVideoId: video.id,
                  }))
                }
                className={`w-full overflow-hidden rounded-xl border text-left transition ${
                  video.id === selectedVideo.id
                    ? "border-[#b94552] bg-[#32151d] text-white"
                    : "border-[#253247] bg-[#0d1724] text-[#b8c2cf] hover:border-[#4b5c73]"
                }`}
              >
                {video.thumbnailUrl ? (
                  <div
                    aria-hidden="true"
                    className="h-16 w-full bg-cover bg-center opacity-65"
                    style={{
                      backgroundImage: `linear-gradient(90deg, rgba(7,12,20,0.08), rgba(7,12,20,0.72)), url("${video.thumbnailUrl}")`,
                    }}
                  />
                ) : null}
                <div className="px-3 py-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium">
                      {video.newsroomName ?? video.channelName}
                    </span>
                    <span className="shrink-0 font-mono text-[8px] uppercase text-[#ff7a84]">
                      {video.viewerCount
                        ? `${formatViewerCount(video.viewerCount)} watching`
                        : "Live"}
                    </span>
                  </div>
                  <span className="mt-1 line-clamp-2 block text-[10px] leading-4 text-[#8f9caf]">
                    {video.title}
                  </span>
                </div>
              </button>
            ))}
          </div>
        </aside>
      </div>
    </>
  );
}

function LiveNewsModal({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  return (
    <NewsModalShell
      titleId="live-news-title"
      eyebrow="Active broadcasts"
      title="Live News"
      description="See what leading international newsrooms are broadcasting now. Choose any active channel without leaving the live desk."
      onClose={onClose}
    >
      <LiveNewsDirectory />
    </NewsModalShell>
  );
}

function BreakingNewsBar({ events }: { events: Event[] }) {
  const items = events.slice(0, 6);
  if (!items.length) {
    return (
      <div className="breaking-news-bar sticky top-0 z-50 flex h-9 items-center border-b border-[#5a232b] bg-[#15090c]">
        <div className="flex h-full shrink-0 items-center bg-[#d44752] px-3 font-mono text-[9px] font-semibold uppercase tracking-[0.18em] text-white sm:px-5">
          Breaking
        </div>
        <p className="truncate px-4 font-mono text-[9px] uppercase tracking-[0.14em] text-[#d9a9ae]">
          The latest stories from around the world
        </p>
      </div>
    );
  }

  const renderItems = (duplicate = false) =>
    items.map((event, index) => {
      const article = event.articles[0];
      const content = (
        <>
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-[#ff5964] shadow-[0_0_8px_#ff5964]" />
          <strong className="text-[#ff7c85]">{event.importanceLabel}</strong>
          <span dir="auto" className="text-[#f1d8da]">
            {event.headline}
          </span>
          <span className="text-[#84656a]">
            {article?.source.publisherName ?? event.category}
          </span>
        </>
      );
      return article?.originalUrl ? (
        <a
          aria-hidden={duplicate || undefined}
          className="breaking-news-item"
          href={article.originalUrl}
          key={`${duplicate ? "duplicate" : "primary"}-${event.id}-${index}`}
          rel="noreferrer"
          tabIndex={duplicate ? -1 : undefined}
          target="_blank"
        >
          {content}
        </a>
      ) : (
        <span
          aria-hidden={duplicate || undefined}
          className="breaking-news-item"
          key={`${duplicate ? "duplicate" : "primary"}-${event.id}-${index}`}
        >
          {content}
        </span>
      );
    });

  return (
    <div
      className="breaking-news-bar sticky top-0 z-50 flex h-9 items-center overflow-hidden border-b border-[#5a232b] bg-[#15090c]"
      aria-label="Breaking news"
    >
      <div className="relative z-10 flex h-full shrink-0 items-center bg-[#d44752] px-3 font-mono text-[9px] font-semibold uppercase tracking-[0.18em] text-white shadow-[12px_0_24px_rgba(21,9,12,0.95)] sm:px-5">
        Breaking
      </div>
      <div className="breaking-news-viewport">
        <div
          className="breaking-news-track"
          data-breaking-direction="right-to-left"
        >
          <div className="breaking-news-set">{renderItems()}</div>
          <div aria-hidden="true" className="breaking-news-set">
            {renderItems(true)}
          </div>
        </div>
      </div>
    </div>
  );
}

interface WorldPulseAppProps {
  MapComponent?: ComponentType<WorldMapProps>;
  liveUpdates?: boolean;
  initialWorld?: PreparedWorldNewsPayload | PreparedWorldNewsWirePayload;
  initialWorldCompressed?: string;
  initialWorldUrl?: string;
}

function decodeBase64Bytes(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function WorldLoadingScreen({
  countryDirectoryReady,
  preparedCountryCount,
  totalCountryCount,
  globalReady,
  globeReady,
  settled,
}: {
  countryDirectoryReady: boolean;
  preparedCountryCount: number;
  totalCountryCount: number;
  globalReady: boolean;
  globeReady: boolean;
  settled: boolean;
}) {
  const countryProgress =
    totalCountryCount > 0
      ? Math.min(1, preparedCountryCount / totalCountryCount)
      : settled
        ? 1
        : 0;
  const progress = Math.min(
    100,
    Math.round(
      (globalReady ? 15 : 5) +
        countryProgress * 70 +
        (globeReady ? 15 : 0),
    ),
  );
  const stage =
    !globalReady
      ? "Loading the latest stories"
      : !countryDirectoryReady
        ? "Loading the country index"
      : !settled
        ? `Preparing ${preparedCountryCount} of ${totalCountryCount} countries`
        : !globeReady
          ? "Rendering the globe"
          : "Ready";
  const steps = [
    {
      label: "Loading the latest stories",
      detail: globalReady ? "Ready" : "In progress",
      ready: globalReady,
    },
    {
      label: "Preparing every country",
      detail: settled
        ? "Ready"
        : countryDirectoryReady && totalCountryCount
          ? `${preparedCountryCount} / ${totalCountryCount}`
          : "In progress",
      ready: settled,
    },
    {
      label: "Rendering the world map",
      detail: globeReady ? "Ready" : "In progress",
      ready: globeReady,
    },
  ];

  return (
    <main
      className="loading-command-center relative grid min-h-screen place-items-center overflow-hidden bg-[#040810] px-6"
      aria-busy="true"
    >
      <div className="loading-grid absolute inset-0" aria-hidden="true" />
      <div className="loading-glow absolute left-1/2 top-1/2 h-[34rem] w-[34rem] -translate-x-1/2 -translate-y-1/2 rounded-full" />
      <section className="relative z-10 w-full max-w-3xl">
        <div className="grid items-center gap-10 md:grid-cols-[230px_1fr]">
          <div className="loading-orbit mx-auto h-52 w-52" aria-hidden="true">
            <div className="loading-orbit__ring loading-orbit__ring--outer" />
            <div className="loading-orbit__ring loading-orbit__ring--inner" />
            <div className="loading-orbit__globe">
              <div className="loading-orbit__longitude" />
              <div className="loading-orbit__latitude" />
              <div className="loading-orbit__scan" />
            </div>
          </div>
          <div>
            <p className="font-mono text-[9px] uppercase tracking-[0.28em] text-[#73e2cc]">
              WorldPulse
            </p>
            <h1 className="mt-3 text-3xl font-semibold tracking-[-0.05em] text-white sm:text-4xl">
              Preparing the live world
            </h1>
            <p className="mt-3 max-w-lg text-sm leading-6 text-[#8e9caf]">
              Bringing the world’s latest stories into focus.
            </p>
            <div className="mt-7 space-y-2">
              {steps.map((step) => (
                <div
                  key={step.label}
                  className="flex items-center justify-between gap-4 rounded-xl border border-[#203044] bg-[#09121e]/80 px-4 py-3"
                >
                  <span className="flex items-center gap-3 text-xs text-[#c4ceda]">
                    <span
                      className={`h-2 w-2 rounded-full ${
                        step.ready
                          ? "bg-[#73e2cc] shadow-[0_0_12px_#73e2cc]"
                          : "animate-pulse bg-[#53647a]"
                      }`}
                    />
                    {step.label}
                  </span>
                  <span className="font-mono text-[8px] uppercase tracking-[0.14em] text-[#738197]">
                    {step.detail}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="mt-10">
          <div className="flex items-center justify-between gap-4 font-mono text-[9px] uppercase tracking-[0.14em] text-[#8090a5]">
            <span role="status" aria-live="polite">
              {stage}
            </span>
            <span>{progress}%</span>
          </div>
          <div className="mt-3 h-1 overflow-hidden rounded-full bg-[#192638]">
            <div
              className="h-full rounded-full bg-[linear-gradient(90deg,#2e817a,#73e2cc,#d4fff7)] shadow-[0_0_18px_rgba(115,226,204,0.5)] transition-[width] duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      </section>
    </main>
  );
}

export function WorldPulseApp({
  MapComponent = WorldMap,
  liveUpdates = true,
  initialWorld: initialWorldPayload,
  initialWorldCompressed,
  initialWorldUrl,
}: WorldPulseAppProps = {}) {
  const decodedInitialWorld = useMemo(
    () =>
      initialWorldPayload
        ? decodePreparedWorldPayload(initialWorldPayload)
        : undefined,
    [initialWorldPayload],
  );
  const [initialWorld, setInitialWorld] = useState(decodedInitialWorld);
  const hasServerWorldPayload = Boolean(
    initialWorldPayload || initialWorldCompressed || initialWorldUrl,
  );
  const [initialWorldDecodeFailed, setInitialWorldDecodeFailed] =
    useState(false);
  const [selectedCountry, setSelectedCountry] =
    useState<MapCountry>(initialCountry);
  const [countryDirectory, setCountryDirectory] =
    useState<MapCountry[]>(countryMetadata);
  const [globalFeed, setGlobalFeed] = useState<FeedState>(
    initialWorld?.globalFeed ?? EMPTY_FEED,
  );
  const [countryFeeds, setCountryFeeds] = useState<Record<string, FeedState>>(
    initialWorld?.countryFeeds ?? {},
  );
  const [liveCountryFeeds, setLiveCountryFeeds] = useState<
    Record<string, FeedState>
  >(initialWorld?.countryFeeds ?? {});
  const [countrySignalFeeds, setCountrySignalFeeds] = useState<
    Record<string, FeedState>
  >(initialWorld?.countryFeeds ?? {});
  const [countryDirectoryReady, setCountryDirectoryReady] = useState(false);
  const [worldScanSettled, setWorldScanSettled] = useState(
    !liveUpdates || Boolean(initialWorld),
  );
  const [preparedCountryCount, setPreparedCountryCount] = useState(
    initialWorld ? Object.keys(initialWorld.countryFeeds).length : 0,
  );
  const [globalFeedReady, setGlobalFeedReady] = useState(
    !liveUpdates || Boolean(initialWorld),
  );
  const [globeReady, setGlobeReady] = useState(!liveUpdates);
  const [globalView, setGlobalView] = useState(false);
  const [connectionEventId, setConnectionEventId] = useState<string | null>(
    null,
  );
  const [category, setCategory] = useState<"All" | Category>("All");
  const [importance, setImportance] = useState<ImportanceFilter>("All");
  const [timeRange, setTimeRange] = useState<TimeFilter>("7 days");
  const [search, setSearch] = useState("");
  const [showMethodology, setShowMethodology] = useState(false);
  const [showLiveSituation, setShowLiveSituation] = useState(false);
  const [showLiveNews, setShowLiveNews] = useState(false);
  const [visibleEventLimit, setVisibleEventLimit] = useState(
    INITIAL_VISIBLE_EVENT_LIMIT,
  );
  const [eventCoverage, setEventCoverage] = useState<
    Record<string, CoverageState>
  >({});
  const coverageRequests = useRef(new Set<string>());
  const activeCoverageRequests = useRef(0);
  const coverageGeneration = useRef(0);
  const [isSwitchingCountry, startCountryTransition] = useTransition();

  useEffect(() => {
    if (!initialWorldCompressed && !initialWorldUrl) return;
    let cancelled = false;
    const decodeServerWorld = async () => {
      try {
        let responseBytes: Uint8Array;
        if (initialWorldCompressed) {
          responseBytes = decodeBase64Bytes(initialWorldCompressed);
        } else {
          const response = await fetch(initialWorldUrl as string, {
            signal: AbortSignal.timeout(WORLD_BATCH_REQUEST_TIMEOUT_MS),
          });
          if (!response.ok) {
            throw new Error("The complete server world state is unavailable.");
          }
          responseBytes = new Uint8Array(await response.arrayBuffer());
        }
        const responsePayload = await parsePreparedWorldResponseBytes(
          responseBytes,
        );
        const prepared = decodePreparedWorldPayload(
          isPreparedWorldNewsWire(responsePayload)
            ? responsePayload
            : (responsePayload as PreparedWorldNewsPayload),
        );
        if (!cancelled) setInitialWorld(prepared);
      } catch {
        if (!cancelled) setInitialWorldDecodeFailed(true);
      }
    };
    void decodeServerWorld();
    return () => {
      cancelled = true;
    };
  }, [initialWorldCompressed, initialWorldUrl]);

  useEffect(() => {
    if (!initialWorldDecodeFailed) return;
    const reloadTimer = window.setTimeout(() => window.location.reload(), 3_000);
    return () => window.clearTimeout(reloadTimer);
  }, [initialWorldDecodeFailed]);

  const fetchGlobalNews = useCallback(async () => {
    setGlobalFeed((current) => ({
      ...current,
      loading: true,
      error: null,
    }));
    try {
      const response = await fetch("/api/live-news?scope=global", {
        signal: AbortSignal.timeout(LIVE_REQUEST_TIMEOUT_MS),
      });
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
    } finally {
      setGlobalFeedReady(true);
    }
  }, []);

  const invalidateCoverage = useCallback(() => {
    coverageGeneration.current += 1;
    coverageRequests.current.clear();
    setEventCoverage({});
  }, []);

  useEffect(() => {
    if (!liveUpdates) return;
    if (MapComponent === WorldMap) {
      void preloadWorldGlobe()
        .catch(() => {
          // A terminal preload failure is handled by the globe's own
          // retry/error state. It must not trap the user here forever.
        });
    } else {
      setGlobeReady(true);
    }
    if (!hasServerWorldPayload) {
      void loadPreparedWorld().catch(() => {
        // The legacy fallback remains available outside the server-rendered app.
      });
    }
  }, [MapComponent, hasServerWorldPayload, liveUpdates]);

  useEffect(() => {
    if (!liveUpdates) return;
    let cancelled = false;
    loadWorldGeometry({ fresh: MapComponent !== WorldMap })
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
  }, [MapComponent, liveUpdates]);

  useEffect(() => {
    if (!liveUpdates || !countryDirectoryReady) return;
    if (!countryDirectory.length) {
      setWorldScanSettled(true);
      return;
    }
    if (hasServerWorldPayload && !initialWorld) {
      setWorldScanSettled(false);
      return;
    }
    if (initialWorld) {
      const countryNames = countryDirectory.map((country) => country.name);
      if (!isCompletePreparedWorld(initialWorld, countryNames)) {
        setWorldScanSettled(false);
        return;
      }
      setGlobalFeed(initialWorld.globalFeed);
      setCountryFeeds(initialWorld.countryFeeds);
      setLiveCountryFeeds(initialWorld.countryFeeds);
      setCountrySignalFeeds(initialWorld.countryFeeds);
      setPreparedCountryCount(countryNames.length);
      setGlobalFeedReady(true);
      setWorldScanSettled(true);
      return;
    }

    let cancelled = false;
    setLiveCountryFeeds({});
    setPreparedCountryCount(0);
    setWorldScanSettled(false);

    const initializePreparedWorld = async () => {
      const checkedAt = new Date().toISOString();
      const neutralFeed = (): FeedState => ({
        events: [],
        updatedAt: checkedAt,
        provider: "WorldPulse",
        loading: false,
        error: null,
      });
      const requestBatch = async (
        countryNames: string[],
        forceFresh = false,
      ) => {
        const parameters = new URLSearchParams({
          scope: "map",
          countries: countryNames.join("|"),
        });
        if (forceFresh) parameters.set("fresh", "1");
        const response = await fetch(`/api/live-news?${parameters.toString()}`, {
          signal: AbortSignal.timeout(WORLD_BATCH_REQUEST_TIMEOUT_MS),
        });
        if (!response.ok) throw new Error("World news is temporarily unavailable.");
        return (await response.json()) as MapNewsPayload;
      };
      const compileFeeds = (
        payloads: MapNewsPayload["countries"],
        countryNames: string[],
      ) => {
        const batchFeeds: Record<string, FeedState> = {
          ...prepareWorldSnapshotFeeds(payloads, countryDirectory),
        };
        for (const countryName of countryNames) {
          batchFeeds[countryName] ??= neutralFeed();
        }
        return batchFeeds;
      };
      const commitFeeds = (
        batchFeeds: Record<string, FeedState>,
        preparedCount: number,
      ) => {
        if (cancelled) return;
        setLiveCountryFeeds((current) => ({
          ...current,
          ...batchFeeds,
        }));
        setPreparedCountryCount((current) =>
          Math.min(countryDirectory.length, current + preparedCount),
        );
      };
      const prepareBatch = async (countryNames: string[]) => {
        let payloads: MapNewsPayload["countries"] = [];
        try {
          const first = await requestBatch(countryNames);
          payloads = first.countries ?? [];
          const received = new Set(
            payloads.map((country) => country.countryName),
          );
          const missing = countryNames.filter((name) => !received.has(name));
          if (missing.length) {
            const retry = await requestBatch(missing, true);
            payloads = [...payloads, ...(retry.countries ?? [])];
          }
        } catch {
          try {
            const retry = await requestBatch(countryNames, true);
            payloads = retry.countries ?? [];
          } catch {
            payloads = [];
          }
        }
        commitFeeds(
          compileFeeds(payloads, countryNames),
          countryNames.length,
        );
      };
      const allCountryNames = countryDirectory.map((country) => country.name);
      let missingCountryNames = allCountryNames;
      try {
        const prepared = await loadPreparedWorld();
        if (cancelled) return;
        setGlobalFeed(prepared.globalFeed);
        setGlobalFeedReady(true);
        const receivedNames = allCountryNames.filter(
          (countryName) => prepared.countryFeeds[countryName],
        );
        if (receivedNames.length) {
          const snapshotFeeds = Object.fromEntries(
            receivedNames.map((countryName) => [
              countryName,
              prepared.countryFeeds[countryName],
            ]),
          );
          commitFeeds(
            snapshotFeeds,
            receivedNames.length,
          );
        }
        const received = new Set(receivedNames);
        missingCountryNames = allCountryNames.filter(
          (countryName) => !received.has(countryName),
        );
      } catch {
        void fetchGlobalNews();
        try {
          const snapshot = await loadWorldSnapshot();
          const requestedNames = new Set(allCountryNames);
          const snapshotPayloads = (snapshot.countries ?? []).filter(
            (country) => requestedNames.has(country.countryName),
          );
          const receivedNames = [
            ...new Set(snapshotPayloads.map((country) => country.countryName)),
          ];
          if (receivedNames.length) {
            const snapshotFeeds = await prepareWorldSnapshotOffThread(
              snapshotPayloads,
              countryDirectory,
            );
            commitFeeds(snapshotFeeds, receivedNames.length);
          }
          const received = new Set(receivedNames);
          missingCountryNames = allCountryNames.filter(
            (countryName) => !received.has(countryName),
          );
        } catch {
          // A cold or unavailable snapshot falls back to the bounded live scan.
        }
      }
      const batches = chunkItems(missingCountryNames, WORLD_BATCH_SIZE);
      let nextBatchIndex = 0;
      const worker = async () => {
        while (!cancelled) {
          const batchIndex = nextBatchIndex;
          nextBatchIndex += 1;
          const batch = batches[batchIndex];
          if (!batch) return;
          await prepareBatch(batch);
        }
      };
      try {
        await Promise.all(
          Array.from(
            { length: Math.min(WORLD_BATCH_CONCURRENCY, batches.length) },
            () => worker(),
          ),
        );
      } finally {
        if (!cancelled) {
          setPreparedCountryCount(countryDirectory.length);
          setWorldScanSettled(true);
        }
      }
    };

    void initializePreparedWorld();
    return () => {
      cancelled = true;
    };
  }, [
    countryDirectory,
    countryDirectoryReady,
    fetchGlobalNews,
    hasServerWorldPayload,
    initialWorld,
    liveUpdates,
  ]);

  const refreshPreparedWorldFromServer = useCallback(async () => {
    if (!countryDirectoryReady || !countryDirectory.length) return false;
    try {
      const prepared = await loadPreparedWorld({ fresh: true });
      const countryNames = countryDirectory.map((country) => country.name);
      if (
        !isCompletePreparedWorld(prepared, countryNames) ||
        !isPreparedWorldFresh(prepared)
      ) {
        return false;
      }
      setGlobalFeed(prepared.globalFeed);
      setCountryFeeds(prepared.countryFeeds);
      setLiveCountryFeeds(prepared.countryFeeds);
      setCountrySignalFeeds(prepared.countryFeeds);
      setPreparedCountryCount(countryNames.length);
      setGlobalFeedReady(true);
      setWorldScanSettled(true);
      invalidateCoverage();
      return true;
    } catch {
      return false;
    }
  }, [countryDirectory, countryDirectoryReady, invalidateCoverage]);

  useEffect(() => {
    if (!liveUpdates || !initialWorld || !countryDirectoryReady) return;
    const refreshTimer = window.setInterval(() => {
      void refreshPreparedWorldFromServer();
    }, 60_000);
    return () => window.clearInterval(refreshTimer);
  }, [
    countryDirectoryReady,
    initialWorld,
    liveUpdates,
    refreshPreparedWorldFromServer,
  ]);

  const mapCountries = useMemo(
    () =>
      countryDirectory.map((country): MapCountry => {
        const fullSignalFeed = countrySignalFeeds[country.name];
        const mapSignalFeed = liveCountryFeeds[country.name];
        const signalFeed = fullSignalFeed ?? mapSignalFeed;
        if (signalFeed) {
          const synchronizedEvents = mergeEventFeeds(
            fullSignalFeed?.events ?? [],
            mapSignalFeed?.events ?? [],
          ).sort(
            (left, right) =>
              right.importanceScore - left.importanceScore ||
              Date.parse(right.lastUpdatedAt) -
                Date.parse(left.lastUpdatedAt),
          );
          return {
            ...country,
            events: synchronizedEvents,
            topEvent: synchronizedEvents[0],
            signalReady: true,
          };
        }
        return {
          ...country,
          events: [],
          topEvent: undefined,
          signalReady: false,
        };
      }),
    [
      countryDirectory,
      countrySignalFeeds,
      liveCountryFeeds,
    ],
  );
  const activeCountry =
    mapCountries.find((country) => country.mapId === selectedCountry.mapId) ??
    selectedCountry;
  const fetchEventCoverage = useCallback(
    async (event: Event) => {
      if (coverageRequests.current.has(event.id)) return;
      if (coverageRequests.current.size >= 4) return;
      const generation = coverageGeneration.current;
      coverageRequests.current.add(event.id);
      while (activeCoverageRequests.current >= 2) {
        await new Promise<void>((resolve) =>
          window.setTimeout(resolve, 120),
        );
        if (generation !== coverageGeneration.current) {
          coverageRequests.current.delete(event.id);
          return;
        }
      }
      activeCoverageRequests.current += 1;
      if (generation === coverageGeneration.current) {
        setEventCoverage((current) => ({
          ...current,
          [event.id]: {
            ...current[event.id],
            event,
            loading: true,
            error: null,
          },
        }));
      }
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
        const response = await fetch(`/api/live-news?${parameters.toString()}`, {
          signal: AbortSignal.timeout(LIVE_REQUEST_TIMEOUT_MS),
        });
        if (!response.ok) {
          throw new Error("Broader coverage search is temporarily unavailable.");
        }
        const payload = (await response.json()) as LiveNewsPayload;
        if (generation !== coverageGeneration.current) return;
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
        if (generation !== coverageGeneration.current) return;
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
    () => {
      const combined =
        fullCountryFeed && !fullCountryFeed.error
          ? {
              ...fullCountryFeed,
              events: mergeEventFeeds(
                fullCountryFeed.events,
                liveCountryFeed?.events ?? [],
              ),
            }
          : liveCountryFeed ?? fullCountryFeed;
      if (!combined || !activeCountry.signalReady) return combined;
      return {
        ...combined,
        events: activeCountry.events,
      };
    },
    [
      activeCountry.events,
      activeCountry.signalReady,
      fullCountryFeed,
      liveCountryFeed,
    ],
  );
  const activeCountrySignal = countrySignalFeeds[activeCountry.name];
  const countryFeedPending =
    liveUpdates &&
    !activeCountrySignal &&
    !liveCountryFeed &&
    Boolean(fullCountryFeed?.loading);
  const fallbackCountryFeed: FeedState = {
    events: activeCountry.events,
    updatedAt: globalFeed.updatedAt,
    provider: globalFeed.provider,
    loading:
      fullCountryFeed?.loading ??
      (liveUpdates ? true : globalFeed.loading),
    error: fullCountryFeed?.error ?? globalFeed.error,
  };
  const resolvedCountryFeed =
    combinedCountryFeed ?? fallbackCountryFeed;
  const activeFeed = globalView
    ? globalFeed
    : countryFeedPending
      ? {
          ...resolvedCountryFeed,
          provider:
            "Full country feed syncing automatically in the background",
          loading: true,
          error: null,
        }
      : resolvedCountryFeed;
  const geocodedGlobalEvents = useMemo(
    () =>
      globalFeed.events.map((event) =>
        applyDetectedGeography(event, countryDirectory),
      ),
    [countryDirectory, globalFeed.events],
  );
  const canonicalEvents = useMemo(() => {
    if (!globalView) return activeFeed.events;

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
    // Seed the registry directly, then merge the matching preloaded country
    // record so every view uses the same sources, geography, and score.
    registry.push(...geocodedGlobalEvents);
    const globalEventCount = registry.length;
    for (let index = 0; index < globalEventCount; index += 1) {
      const globalEvent = registry[index];
      const affected = new Set(globalEvent.affectedCountries);
      for (const country of mapCountries) {
        const identifier = country.iso2 ?? country.name;
        if (
          !affected.has(identifier) &&
          !affected.has(country.name)
        ) {
          continue;
        }
        for (const countryEvent of country.events) {
          if (
            globalEvent.id === countryEvent.id ||
            eventsDescribeSameOccurrence(globalEvent, countryEvent)
          ) {
            registry[index] = mergeCanonicalEvents(
              registry[index],
              countryEvent,
            );
          }
        }
      }
    }
    for (const [countryName, feed] of Object.entries(countryFeeds)) {
      addEvents(
        feed.events,
        mapCountries.find((country) => country.name === countryName),
      );
    }
    return registry;
  }, [
    activeFeed.events,
    countryFeeds,
    geocodedGlobalEvents,
    globalView,
    mapCountries,
  ]);
  const baseEvents = useMemo(
    () => {
      if (!globalView) return activeFeed.events;
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
  const filteredEvents = useMemo(() => {
    const limitHours =
      timeRange === "24 hours"
        ? 24
        : timeRange === "3 days"
          ? 72
          : timeRange === "7 days"
            ? 168
            : Number.POSITIVE_INFINITY;
    const reference = Date.now();
    const query = search.trim().toLowerCase();
    return expandedEvents.filter((event) => {
      const matchesCategory = category === "All" || event.category === category;
      const matchesImportance =
        importance === "All" || event.importanceLabel === importance;
      const matchesTime =
        !Number.isFinite(limitHours) ||
        reference - Date.parse(event.lastUpdatedAt) <=
          limitHours * 3_600_000;
      const matchesSearch =
        !query ||
        event.headline.toLowerCase().includes(query) ||
        event.summary.toLowerCase().includes(query) ||
        event.articles.some((article) =>
          article.source.publisherName.toLowerCase().includes(query),
        );
      return matchesCategory && matchesImportance && matchesTime && matchesSearch;
    });
  }, [category, expandedEvents, importance, search, timeRange]);
  const focusedConnectionEvent = filteredEvents.find(
    (event) => event.id === connectionEventId,
  );
  const visibleEvents = filteredEvents.slice(0, visibleEventLimit);
  const mapLinkEvents = focusedConnectionEvent
    ? [focusedConnectionEvent]
    : [];
  const breakingEvents = useMemo(() => {
    const candidates = globalFeed.events.length
      ? globalFeed.events
      : mapCountries.flatMap((country) => country.topEvent ?? []);
    const seen = new Set<string>();
    return [...candidates]
      .sort(
        (left, right) =>
          Date.parse(right.lastUpdatedAt) - Date.parse(left.lastUpdatedAt) ||
          right.importanceScore - left.importanceScore,
      )
      .filter((event) => {
        if (seen.has(event.id)) return false;
        seen.add(event.id);
        return true;
      })
      .slice(0, 10);
  }, [globalFeed.events, mapCountries]);
  const situationEvents = useMemo(
    () =>
      [...globalFeed.events]
        .sort(
          (left, right) =>
            right.importanceScore - left.importanceScore ||
            Date.parse(right.lastUpdatedAt) -
              Date.parse(left.lastUpdatedAt),
        )
        .slice(0, 12),
    [globalFeed.events],
  );

  const handleSelect = useCallback((country: MapCountry) => {
    const resolvedCountry =
      mapCountries.find(
        (candidate) =>
          candidate.mapId === country.mapId ||
          candidate.name === country.name,
      ) ?? country;
    invalidateCoverage();
    startCountryTransition(() => {
      setSelectedCountry(resolvedCountry);
      setGlobalView(false);
      setVisibleEventLimit(INITIAL_VISIBLE_EVENT_LIMIT);
      setConnectionEventId(null);
      setCategory("All");
      setImportance("All");
      setTimeRange("7 days");
      setSearch("");
    });
  }, [
    invalidateCoverage,
    mapCountries,
    startCountryTransition,
  ]);
  const handleEventActivate = (event: Event) => {
    const hasExplicitConnections =
      countriesMentionedByEvent(event, mapCountries).length > 1;
    if (hasExplicitConnections) {
      setConnectionEventId((current) =>
        current === event.id ? null : event.id,
      );
    } else {
      setConnectionEventId(null);
    }
    const coverage = coverageForEvent(event, eventCoverage);
    if (!coverage?.loading && !coverageIsFresh(coverage)) {
      void fetchEventCoverage(event);
    }
  };
  const handleEventVisible = (event: Event) => {
    if (countryFeedPending && !globalView) return;
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
    void refreshPreparedWorldFromServer();
  };

  const initialWorldReady =
    !liveUpdates ||
    (countryDirectoryReady &&
      worldScanSettled &&
      globalFeedReady &&
      globeReady);
  const worldIndexComplete =
    !liveUpdates || worldScanSettled;
  const worldStatusLabel = isSwitchingCountry
    ? "Opening country"
    : worldIndexComplete
      ? "Live"
      : "Preparing the world";

  return (
    <>
      {!initialWorldReady ? (
        <WorldLoadingScreen
          countryDirectoryReady={countryDirectoryReady}
          preparedCountryCount={preparedCountryCount}
          totalCountryCount={
            countryDirectoryReady ? countryDirectory.length : 0
          }
          globalReady={globalFeedReady}
          globeReady={globeReady}
          settled={worldScanSettled}
        />
      ) : null}
      <main
        className="min-h-screen bg-[#080d15]"
        hidden={!initialWorldReady}
        aria-hidden={!initialWorldReady || undefined}
      >
      <BreakingNewsBar events={breakingEvents} />
      <header className="sticky top-9 z-40 flex h-16 items-center justify-between border-b border-[#222d3e] bg-[#080d15]/95 px-3 backdrop-blur sm:px-6">
        <div className="flex items-center gap-3">
          <div
            className="relative h-8 w-8 rounded-full border border-[#4d6572] bg-[#13232a] shadow-[inset_0_0_0_6px_#0b151f,0_0_18px_rgba(115,226,204,0.12)]"
            aria-hidden="true"
          >
            <span className="absolute inset-[11px] rounded-full bg-[#73e2cc]" />
          </div>
          <div>
            <div className="text-sm font-semibold tracking-[-0.02em]">
              WorldPulse
            </div>
            <div className="hidden font-mono text-[8px] uppercase tracking-[0.19em] text-[#7f8da1] sm:block">
              News around the world
            </div>
          </div>
        </div>
        <nav className="flex items-center gap-2" aria-label="Main navigation">
          <button
            type="button"
            onClick={() => setShowLiveNews(true)}
            aria-label="Live News"
            className="live-news-button-pulse inline-flex items-center gap-2 whitespace-nowrap rounded-full border border-[#df5b67] bg-[#701822] px-2.5 py-2 text-[10px] text-white transition hover:border-[#ff8b94] sm:px-4"
          >
            <span
              className="world-live-status__dot h-1.5 w-1.5 rounded-full bg-white"
              aria-hidden="true"
            />
            <span>Live</span>
          </button>
          <button
            type="button"
            onClick={() => setShowLiveSituation(true)}
            aria-label="Top Stories"
            className="whitespace-nowrap rounded-full border border-[#3978b7] bg-[#122a44] px-2.5 py-2 text-[10px] text-[#d5ebff] transition hover:border-[#65a9e8] hover:bg-[#193a5d] sm:px-4"
          >
            <span className="sm:hidden">Stories</span>
            <span className="hidden sm:inline">Top Stories</span>
          </button>
          <button
            type="button"
            onClick={() => setShowMethodology(true)}
            aria-label="Methodology"
            className="whitespace-nowrap rounded-full border border-[#344157] px-2.5 py-2 text-[10px] text-[#c5cfdb] hover:bg-[#151f30] sm:px-4"
          >
            <span className="sm:hidden">Method</span>
            <span className="hidden sm:inline">Methodology</span>
          </button>
        </nav>
      </header>

      <div className="grid min-h-[calc(100vh-6.25rem)] lg:grid-cols-[minmax(0,1fr)_420px]">
        <section className="relative min-h-[54vh] border-b border-[#222d3e] lg:h-[calc(100vh-6.25rem)] lg:border-b-0 lg:border-r">
          <MapComponent
            countries={mapCountries}
            selectedMapId={globalView ? null : selectedCountry.mapId}
            onSelect={handleSelect}
            onReady={() => setGlobeReady(true)}
            readyForDisplay={worldIndexComplete && globalFeedReady}
            linkEvents={mapLinkEvents}
            statusLabel={worldStatusLabel}
          />
          <span className="sr-only" aria-live="polite">
            {worldIndexComplete
              ? "Live country index complete"
              : "Preparing country stories"}
          </span>
          <div className="absolute inset-x-4 bottom-4 z-10 rounded-xl border border-[#334055] bg-[#0d1522]/95 p-3 shadow-xl backdrop-blur-sm sm:left-auto sm:w-[min(620px,calc(100%-2rem))]">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-mono text-[9px] uppercase tracking-[0.17em] text-[#8996a8]">
                Topics
              </span>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[9px] text-[#647286]">
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2 w-5 rounded-[50%] border-t-2 border-[#d8fff7] shadow-[0_0_6px_#73e2cc]" />
                  Select a story to see its verified international connections
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
                No current coverage
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
                  <h2 className="text-xl font-semibold tracking-[-0.035em]">
                    {globalView ? "Global events" : activeCountry.name}
                  </h2>
                </div>
                <p className="mt-1 text-[10px] text-[#8794a6]">
                  {filteredEvents.length} grouped{" "}
                  {filteredEvents.length === 1 ? "event" : "events"} · Updated
                  {activeFeed.updatedAt
                    ? ` ${formatTime(activeFeed.updatedAt)}`
                    : " shortly"}
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
                  ? "Updating stories…"
                  : activeFeed.error
                    ? "Stories are temporarily unavailable"
                    : "Latest stories"}
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
                {["24 hours", "3 days", "7 days", "All stories"].map(
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
                    hasConnections={
                      countriesMentionedByEvent(event, mapCountries).length > 1
                    }
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
                  <div
                    className="mx-auto h-8 w-8 rounded-full border border-[#59687d] shadow-[inset_0_0_0_8px_#101722]"
                    aria-hidden="true"
                  />
                  <h3 className="mt-3 text-sm font-medium">
                    {noRecentEvents
                      ? "No events in the last 7 days"
                      : !globalView && !baseEvents.length && !hasActiveFilters
                        ? `No recent news for ${activeCountry.name}`
                        : globalView && !baseEvents.length && !hasActiveFilters
                          ? "No live global events"
                          : "No matching events"}
                  </h3>
                  <p className="mt-2 text-xs leading-5 text-[#7f8da1]">
                    {noRecentEvents
                      ? "Older headlines are still available."
                      : !globalView && !baseEvents.length && !hasActiveFilters
                        ? "No matching headlines were found in the last seven days."
                        : globalView && !baseEvents.length && !hasActiveFilters
                          ? "New global stories will appear here."
                          : "Broaden the filters or try a different search term."}
                  </p>
                  {noRecentEvents ? (
                    <button
                      type="button"
                      onClick={() => {
                        setTimeRange("All stories");
                        setVisibleEventLimit(INITIAL_VISIBLE_EVENT_LIMIT);
                      }}
                      className="mt-4 rounded-lg border border-[#46556b] px-3 py-2 text-[10px] text-[#cad3df] hover:bg-[#192437]"
                    >
                      Show all stories
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
        </aside>
      </div>
      {showMethodology ? (
        <MethodologyModal onClose={() => setShowMethodology(false)} />
      ) : null}
      {showLiveSituation ? (
        <LiveSituationModal
          events={situationEvents}
          onClose={() => setShowLiveSituation(false)}
        />
      ) : null}
      {showLiveNews ? (
        <LiveNewsModal onClose={() => setShowLiveNews(false)} />
      ) : null}
      </main>
    </>
  );
}
