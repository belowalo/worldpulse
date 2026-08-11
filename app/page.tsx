import { WorldPulseApp } from "@/components/world-pulse-app";
import {
  COMPLETE_WORLD_COUNTRY_COUNT,
  fetchPreparedWorldCompressedFromServer,
  isPreparedWorldGeneratedAtFresh,
} from "@/lib/prepared-world";
import { headers } from "next/headers";

async function requestOrigin() {
  const requestHeaders = await headers();
  const host = requestHeaders.get("host") ?? "localhost:3000";
  const forwardedProtocol = requestHeaders
    .get("x-forwarded-proto")
    ?.split(",")[0]
    ?.trim();
  const local = /^(localhost|127\.0\.0\.1|\[::1\])(?::|$)/i.test(host);
  const protocol =
    forwardedProtocol === "http" || forwardedProtocol === "https"
      ? forwardedProtocol
      : local
        ? "http"
        : "https";
  return `${protocol}://${host}`;
}

function ServerWorldLoading() {
  return (
    <main className="loading-command-center grid min-h-screen place-items-center px-6">
      <meta httpEquiv="refresh" content="3" />
      <section className="max-w-lg text-center">
        <p className="font-mono text-[9px] uppercase tracking-[0.28em] text-[#73e2cc]">
          WorldPulse
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-[-0.05em] text-white">
          Preparing the complete world
        </h1>
        <p className="mt-3 text-sm leading-6 text-[#8e9caf]">
          The server is finishing a complete news snapshot before opening the
          map.
        </p>
      </section>
    </main>
  );
}

export default async function Home() {
  let initialWorldCompressed: string | null = null;
  try {
    const serverWorld = await fetchPreparedWorldCompressedFromServer(
      await requestOrigin(),
    );
    if (
      serverWorld.countryCount >= COMPLETE_WORLD_COUNTRY_COUNT &&
      isPreparedWorldGeneratedAtFresh(serverWorld.generatedAt)
    ) {
      initialWorldCompressed = serverWorld.compressed;
    }
  } catch {
    // Keep the application closed until a complete server snapshot exists.
  }
  if (!initialWorldCompressed) {
    return <ServerWorldLoading />;
  }
  return <WorldPulseApp initialWorldCompressed={initialWorldCompressed} />;
}
