"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { WorldPulseDiagnostics } from "@/lib/types";

function ageLabel(value: string) {
  const ageSeconds = Math.max(0, Math.round((Date.now() - Date.parse(value)) / 1_000));
  if (ageSeconds < 60) return `${ageSeconds}s ago`;
  return `${Math.floor(ageSeconds / 60)}m ${ageSeconds % 60}s ago`;
}

export function WorldDiagnostics() {
  const [health, setHealth] = useState<WorldPulseDiagnostics | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(true);

  const requestHealth = useCallback(async () => {
    try {
      const response = await fetch("/api/diagnostics/world", {
        cache: "no-store",
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) throw new Error("Health data is unavailable.");
      setHealth((await response.json()) as WorldPulseDiagnostics);
      setError(null);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Health data is unavailable.");
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    const initial = window.setTimeout(() => void requestHealth(), 0);
    const interval = window.setInterval(() => void requestHealth(), 60_000);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(interval);
    };
  }, [requestHealth]);

  const refreshNow = () => {
    setRefreshing(true);
    void requestHealth();
  };

  return (
    <main className="min-h-screen bg-[#080d15] px-4 py-8 text-[#f6f7f9] sm:px-8 lg:px-12">
      <div className="mx-auto max-w-6xl">
        <header className="flex flex-wrap items-start justify-between gap-4 border-b border-[#283447] pb-6">
          <div>
            <Link href="/" className="font-mono text-xs uppercase tracking-[0.18em] text-[#73e2cc]">WorldPulse</Link>
            <h1 className="mt-3 text-3xl font-semibold tracking-[-0.04em]">World feed health</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-[#9aa5b5]">Live-index freshness, country coverage, and upstream provider status. This view refreshes once a minute.</p>
          </div>
          <button type="button" onClick={refreshNow} disabled={refreshing} className="min-h-11 rounded-lg border border-[#3b4a60] px-4 text-sm text-white disabled:opacity-50">
            {refreshing ? "Checking…" : "Check now"}
          </button>
        </header>

        {error ? <div role="alert" className="mt-6 rounded-xl border border-[#8b3947] bg-[#32151c] p-4 text-sm text-[#ffd7dc]">{error}</div> : null}
        {health ? (
          <>
            <section aria-label="Live index summary" className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {[
                ["Status", health.status],
                ["Live index age", `${ageLabel(health.snapshotGeneratedAt)}${health.fresh ? "" : " · stale"}`],
                ["Country coverage", `${health.inhabitedCountriesWithNews}/${health.inhabitedCountries}`],
                ["Delivery", "Direct D1"],
              ].map(([label, value]) => (
                <article key={label} className="rounded-xl border border-[#283447] bg-[#111927] p-4">
                  <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-[#8290a3]">{label}</div>
                  <div className={`mt-2 text-2xl font-semibold capitalize ${label === "Status" && value === "degraded" ? "text-[#ff8992]" : "text-white"}`}>{value}</div>
                </article>
              ))}
            </section>

            <section className="mt-6 grid gap-6 lg:grid-cols-2">
              <article className="rounded-xl border border-[#283447] bg-[#111927] p-5">
                <h2 className="text-lg font-semibold">Coverage monitor</h2>
                <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                  <div><dt className="text-[#8290a3]">All map countries</dt><dd className="mt-1 text-xl text-white">{health.countriesWithNews}/{health.totalCountries}</dd></div>
                  <div><dt className="text-[#8290a3]">Global events</dt><dd className="mt-1 text-xl text-white">{health.globalEventCount}</dd></div>
                </dl>
                <div className="mt-5 border-t border-[#283447] pt-4 text-sm">
                  <div className="text-[#8290a3]">Missing inhabited countries</div>
                  <p className="mt-2 text-white">{health.missingInhabitedCountries.length ? health.missingInhabitedCountries.join(", ") : "None"}</p>
                  <div className="mt-4 text-[#8290a3]">Expected empty territories</div>
                  <p className="mt-2 text-white">{health.expectedEmptyCountries.length ? health.expectedEmptyCountries.join(", ") : "None"}</p>
                </div>
              </article>

              <article className="rounded-xl border border-[#283447] bg-[#111927] p-5">
                <h2 className="text-lg font-semibold">Provider health</h2>
                <div className="mt-4 max-h-80 overflow-auto rounded-lg border border-[#283447]">
                  <table className="w-full text-left text-sm">
                    <thead className="sticky top-0 bg-[#151f30] text-[#9aa5b5]"><tr><th className="px-3 py-2 font-medium">Provider</th><th className="px-3 py-2 font-medium">Status</th><th className="px-3 py-2 text-right font-medium">Articles</th></tr></thead>
                    <tbody>{health.providerHealth.map((provider) => <tr key={provider.name} className="border-t border-[#283447]"><td className="px-3 py-2 text-white">{provider.name}</td><td className={`px-3 py-2 ${provider.status === "ok" ? "text-[#73e2cc]" : "text-[#ff8992]"}`}>{provider.status}</td><td className="px-3 py-2 text-right text-[#d4dbe5]">{provider.articleCount}</td></tr>)}</tbody>
                  </table>
                </div>
              </article>
            </section>
            <p className="mt-6 font-mono text-[10px] uppercase tracking-[0.14em] text-[#68758a]" role="status" aria-live="polite">Last health record: {new Date(health.generatedAt).toLocaleString()}</p>
          </>
        ) : null}
      </div>
    </main>
  );
}
