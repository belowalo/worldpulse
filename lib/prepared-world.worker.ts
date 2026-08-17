/// <reference lib="webworker" />

import { decodePreparedWorldPayload } from "@/lib/prepared-world";
import {
  isPreparedWorldNewsWire,
  parsePreparedWorldResponseBytes,
} from "@/lib/snapshot-transport";
import type {
  PreparedWorldNewsPayload,
  PreparedWorldNewsWirePayload,
} from "@/lib/types";

self.onmessage = async (event: MessageEvent<ArrayBuffer>) => {
  try {
    const responsePayload = await parsePreparedWorldResponseBytes(
      new Uint8Array(event.data),
    );
    const payload = decodePreparedWorldPayload(
      isPreparedWorldNewsWire(responsePayload)
        ? responsePayload
        : (responsePayload as PreparedWorldNewsPayload | PreparedWorldNewsWirePayload),
    );
    self.postMessage({ ok: true, payload });
  } catch (error) {
    self.postMessage({
      ok: false,
      message:
        error instanceof Error
          ? error.message
          : "Prepared world decoding failed.",
    });
  }
};
