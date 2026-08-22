/// <reference lib="webworker" />

import { buildLiveWorldView } from "@/lib/world-snapshot";
import type {
  LiveNewsPayload,
  MapCountry,
  MapNewsPayload,
} from "@/lib/types";

interface SnapshotWorkerRequest {
  generatedAt: string;
  global: LiveNewsPayload;
  countries: MapCountry[];
  payloads: MapNewsPayload["countries"];
}

self.onmessage = (event: MessageEvent<SnapshotWorkerRequest>) => {
  try {
    self.postMessage({
      ok: true,
      payload: buildLiveWorldView(
        event.data.global,
        event.data.payloads,
        event.data.countries,
        event.data.generatedAt,
      ),
    });
  } catch (error) {
    self.postMessage({
      ok: false,
      message:
        error instanceof Error
          ? error.message
          : "The live world feed could not be prepared.",
    });
  }
};

export {};
