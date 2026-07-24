"use client";

export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main className="grid min-h-screen place-items-center bg-[#080d15] p-6 text-center">
      <div>
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-[#ff7d88]">
          Signal interrupted
        </p>
        <h1 className="mt-3 text-2xl font-semibold">
          WorldPulse could not load.
        </h1>
        <p className="mt-2 text-sm text-[#9aa5b5]">
          Check your connection and try the news desk again.
        </p>
        <button
          type="button"
          onClick={reset}
          className="mt-5 rounded-lg border border-[#4d5b70] px-4 py-2 text-sm"
        >
          Try again
        </button>
      </div>
    </main>
  );
}
