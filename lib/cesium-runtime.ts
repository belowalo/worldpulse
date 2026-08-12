const CESIUM_VERSION = "1.143.0";
const CESIUM_ASSET_BASE =
  `https://cdn.jsdelivr.net/npm/cesium@${CESIUM_VERSION}/Build/Cesium/`;

let runtimePromise: Promise<typeof import("cesium")> | null = null;

export function loadCesiumRuntime() {
  if (!runtimePromise) {
    Object.assign(globalThis, { CESIUM_BASE_URL: CESIUM_ASSET_BASE });
    runtimePromise = import("cesium").catch((error) => {
      runtimePromise = null;
      throw error;
    });
  }
  return runtimePromise;
}

export type CesiumRuntime = Awaited<ReturnType<typeof loadCesiumRuntime>>;
