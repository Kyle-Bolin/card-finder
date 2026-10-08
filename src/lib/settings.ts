import browser from "webextension-polyfill";
import { DEFAULT_FILTERS, normalizeFilters, type Filters } from "./filters";
import type { ApproxLocation } from "./location";
import { DEFAULT_RANGE_MILES } from "./storeSet";
import type { GeoPoint, Store } from "./types";

export type { Filters };

export interface Settings {
  /** Moxfield tag that marks a card as wanted (case-insensitive). */
  tag: string;
  /** Stores always checked, even outside the range: added by URL, or saved before automatic selection. */
  stores: Store[];
  filters: Filters;
  /** The resolved location (ZIP override, else approximate); results are sorted by distance to it. */
  home?: GeoPoint;
  /** Location from a ZIP the user typed; replaces the approximate one. */
  manualLocation?: GeoPoint;
  /** City-level location from the device's IP, cached for a day. */
  approxLocation?: ApproxLocation;
  rangeMiles: number;
  includeOnline: boolean;
  /** URLs of in-range stores the user turned off. */
  excluded: string[];
}

export const DEFAULT_SETTINGS: Settings = {
  tag: "unowned",
  stores: [],
  filters: DEFAULT_FILTERS,
  rangeMiles: DEFAULT_RANGE_MILES,
  includeOnline: false,
  excluded: [],
};

const KEY = "settings";

export async function loadSettings(): Promise<Settings> {
  const stored = (await browser.storage.local.get(KEY))[KEY] as Partial<Settings> | undefined;
  const settings = { ...DEFAULT_SETTINGS, ...stored, filters: normalizeFilters(stored?.filters) };
  // Before automatic location, `home` was the point the user searched from: keep it as their override.
  if (stored?.home && !stored.manualLocation && !stored.approxLocation) {
    settings.manualLocation = stored.home;
  }
  return settings;
}

export async function saveSettings(settings: Settings): Promise<void> {
  await browser.storage.local.set({ [KEY]: settings });
}

/** Add a store, or replace the saved one with the same URL. */
export function upsertStore(stores: Store[], store: Store): Store[] {
  const i = stores.findIndex((s) => s.url === store.url);
  if (i === -1) return [...stores, store];
  return stores.map((s, j) => (j === i ? store : s));
}

export function removeStore(stores: Store[], url: string): Store[] {
  return stores.filter((s) => s.url !== url);
}
