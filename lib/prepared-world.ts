import {
  decodePreparedWorldNews,
  isPreparedWorldNewsWire,
} from "@/lib/snapshot-transport";
import type {
  PreparedWorldNewsPayload,
  PreparedWorldNewsWirePayload,
} from "@/lib/types";

export const COMPLETE_WORLD_COUNTRY_COUNT = 215;
export const PREPARED_WORLD_MAX_AGE_MS = 3 * 60_000;

export function decodePreparedWorldPayload(
  payload: PreparedWorldNewsPayload | PreparedWorldNewsWirePayload,
) {
  const decoded = isPreparedWorldNewsWire(payload)
    ? decodePreparedWorldNews(payload)
    : payload;
  if (
    decoded.scope !== "prepared-world" ||
    !decoded.globalFeed ||
    !decoded.countryFeeds
  ) {
    throw new Error("The minute world state is invalid.");
  }
  return decoded;
}

export function isCompletePreparedWorld(
  payload: PreparedWorldNewsPayload,
  countryNames: string[],
) {
  return (
    countryNames.length > 0 &&
    countryNames.every((countryName) => payload.countryFeeds[countryName])
  );
}

export function hasCompleteWorldCardinality(
  payload: PreparedWorldNewsPayload,
) {
  return (
    Object.keys(payload.countryFeeds).length >= COMPLETE_WORLD_COUNTRY_COUNT
  );
}

export function isPreparedWorldFresh(
  payload: PreparedWorldNewsPayload,
  now = Date.now(),
) {
  const generatedAt = Date.parse(payload.generatedAt);
  if (!Number.isFinite(generatedAt)) return false;
  const age = now - generatedAt;
  return age >= -60_000 && age <= PREPARED_WORLD_MAX_AGE_MS;
}

function bytesToBase64(bytes: Uint8Array) {
  const chunkSize = 32_768;
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

export function isPreparedWorldGeneratedAtFresh(
  generatedAt: string,
  now = Date.now(),
) {
  const timestamp = Date.parse(generatedAt);
  if (!Number.isFinite(timestamp)) return false;
  const age = now - timestamp;
  return age >= -60_000 && age <= PREPARED_WORLD_MAX_AGE_MS;
}

export async function fetchPreparedWorldFromServer(
  origin: string,
  fetchImpl: typeof fetch = fetch,
) {
  const response = await fetchImpl(
    `${origin}/api/live-news?scope=prepared-world&plain=1`,
    { cache: "no-store" },
  );
  if (!response.ok) {
    throw new Error("The complete server world state is unavailable.");
  }
  return decodePreparedWorldPayload(
    (await response.json()) as
      | PreparedWorldNewsPayload
      | PreparedWorldNewsWirePayload,
  );
}

export async function fetchPreparedWorldCompressedFromServer(
  origin: string,
  fetchImpl: typeof fetch = fetch,
) {
  const response = await fetchImpl(
    `${origin}/api/live-news?scope=prepared-world`,
    { cache: "no-store" },
  );
  if (!response.ok) {
    throw new Error("The complete server world state is unavailable.");
  }
  const generatedAt =
    response.headers.get("X-WorldPulse-Snapshot-Generated-At") ?? "";
  const countryCount = Number(
    response.headers.get("X-WorldPulse-Country-Count") ?? "0",
  );
  const responseBytes = new Uint8Array(await response.arrayBuffer());
  if (!responseBytes.length) {
    throw new Error("The complete server world state is empty.");
  }
  return {
    compressed: bytesToBase64(responseBytes),
    countryCount,
    generatedAt,
  };
}
