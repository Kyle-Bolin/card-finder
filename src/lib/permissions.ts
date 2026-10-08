import browser from "webextension-polyfill";
import type { Store } from "./types";

/** Match patterns for the sites Card Finder reads; the browser may require each to be granted separately. */
export const STORE_ORIGINS = ["https://*.tcgplayerpro.com/*"];
export const FIND_STORES_ORIGINS = [
  ...STORE_ORIGINS,
  "https://api.tabletop.wizards.com/*",
  "https://api.zippopotam.us/*",
  "https://raw.githubusercontent.com/*",
];
/** Location lookup by IP, the ZIP override, and the store directory. */
export const AUTO_STORE_ORIGINS = [
  "https://ipapi.co/*",
  "https://get.geojs.io/*",
  "https://api.zippopotam.us/*",
  "https://raw.githubusercontent.com/*",
];

/** Match pattern for one storefront origin. */
export function originPattern(storeUrl: string): string {
  return `${new URL(storeUrl).origin}/*`;
}

/** What a check of `stores` needs: the TCGplayer Pro hosts, plus each other store's own origin. */
export function originsForStores(stores: Store[]): string[] {
  const custom = stores
    .filter((s) => s.platform && s.platform !== "tcgplayerpro")
    .map((s) => originPattern(s.url));
  return [...new Set([...STORE_ORIGINS, ...custom])];
}

/** The subset of `origins` the extension doesn't have access to yet. */
export async function missingOrigins(origins: string[]): Promise<string[]> {
  const granted = await Promise.all(
    origins.map((origin) => browser.permissions.contains({ origins: [origin] })),
  );
  return origins.filter((_, i) => !granted[i]);
}

/**
 * Ask the user for access to `origins`. Must be called from a user gesture (a click
 * handler), before any `await`, or the browser won't show the prompt.
 */
export async function requestOrigins(origins: string[]): Promise<boolean> {
  try {
    return await browser.permissions.request({ origins });
  } catch {
    return false;
  }
}
