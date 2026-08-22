export default function Loading() {
  return (
    <main className="min-h-screen bg-[#080d15] p-6" aria-busy="true">
      <div className="h-10 w-48 animate-pulse rounded-lg bg-[#1b2638]" />
      <div className="mt-6 grid min-h-[70vh] gap-4 lg:grid-cols-[1fr_420px]">
        <div className="animate-pulse rounded-xl bg-[#111a29]" />
        <div className="space-y-3">
          <div className="h-24 animate-pulse rounded-xl bg-[#111a29]" />
          <div className="h-48 animate-pulse rounded-xl bg-[#111a29]" />
          <div className="h-48 animate-pulse rounded-xl bg-[#111a29]" />
        </div>
      </div>
      <span className="sr-only">Loading Hemisphere Herald</span>
    </main>
  );
}
