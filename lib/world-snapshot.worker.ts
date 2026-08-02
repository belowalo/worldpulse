/// <reference lib="webworker" />

import { prepareWorldSnapshotFeeds } from "@/lib/world-snapshot";
import type { MapCountry, MapNewsPayload } from "@/lib/types";

interface SnapshotWorkerRequest {
  countries: MapCountry[];
  payloads: MapNewsPayload["countries"];
}

self.onmessage = (event: MessageEvent<SnapshotWorkerRequest>) => {
  self.postMessage(
    prepareWorldSnapshotFeeds(event.data.payloads, event.data.countries),
  );
};

export {};
