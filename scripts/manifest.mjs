// Derives each browser's manifest from static/manifest.json.

export const TARGETS = ["safari", "chrome", "firefox"];

export const FIREFOX_ID = "card-finder@kylebolin.com";
export const FIREFOX_MIN_VERSION = "128.0";

/** The manifest for `target`, built from the shared base manifest. */
export function manifestFor(base, target) {
  const manifest = structuredClone(base);
  if (target === "firefox") {
    // Firefox MV3 has no service-worker background; the same script runs as an event page.
    manifest.background = { scripts: [manifest.background.service_worker] };
    manifest.browser_specific_settings = {
      gecko: {
        id: FIREFOX_ID,
        strict_min_version: FIREFOX_MIN_VERSION,
        data_collection_permissions: { required: ["none"] },
      },
    };
  }
  return manifest;
}
