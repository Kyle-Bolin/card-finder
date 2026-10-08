import { METERS_PER_MILE, nearbyFromDirectory, type Directory } from "./directory";
import type { GeoPoint, Store } from "./types";

export const RANGE_OPTIONS_MILES = [10, 25, 50, 100] as const;
export const DEFAULT_RANGE_MILES = 25;
/** Above this many stores a check gets slow enough to warn about. */
export const MANY_STORES = 40;

export interface StoreSetInput {
  /** The resolved location; without it only always-include stores are checked. */
  home?: GeoPoint;
  rangeMiles: number;
  includeOnline: boolean;
  /** URLs of in-range stores the user switched off. */
  excluded: readonly string[];
  /** Stores added by hand or saved before automatic selection; always checked. */
  alwaysInclude: readonly Store[];
  directory: Directory | null;
}

export interface StoreSet {
  /** Everything to check: always-include stores plus in-range stores not excluded. */
  stores: Store[];
  /** Every store in range (excluded ones too), nearest first, for the settings list. */
  inRange: Store[];
}

/** One store per storefront (its nearest branch) from the directory within range. */
export function storesInRange(
  directory: Directory | null,
  home: GeoPoint | undefined,
  rangeMiles: number,
  includeOnline: boolean,
): Store[] {
  if (!directory || !home) return [];
  const seen = new Set<string>();
  const stores: Store[] = [];
  // Matches come back nearest first, so the first branch seen is the closest.
  for (const { store, site } of nearbyFromDirectory(directory, home, rangeMiles * METERS_PER_MILE, {
    includeOnlineOnly: includeOnline,
  })) {
    if (seen.has(site.url)) continue;
    seen.add(site.url);
    stores.push({
      url: site.url,
      name: site.name,
      address: site.address,
      phone: site.phone,
      latitude: store.latitude,
      longitude: store.longitude,
    });
  }
  return stores;
}

/** The single definition of which stores get checked; used by the background, popup and settings. */
export function computeStoreSet(input: StoreSetInput): StoreSet {
  const inRange = storesInRange(input.directory, input.home, input.rangeMiles, input.includeOnline);
  const excluded = new Set(input.excluded);
  const stores = [...input.alwaysInclude];
  const have = new Set(stores.map((s) => s.url));
  for (const store of inRange) {
    if (have.has(store.url) || excluded.has(store.url)) continue;
    have.add(store.url);
    stores.push(store);
  }
  return { stores, inRange };
}
