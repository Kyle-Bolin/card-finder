import browser from "webextension-polyfill";
import { DEFAULT_FILTERS, normalizeFilters, type Filters } from "./filters";
import type { Store } from "./types";

export type { Filters };

export interface Settings {
  /** Moxfield tag that marks a card as wanted (case-insensitive). */
  tag: string;
  stores: Store[];
  filters: Filters;
}

export const DEFAULT_SETTINGS: Settings = {
  tag: "unowned",
  stores: [],
  filters: DEFAULT_FILTERS,
};

const KEY = "settings";

export async function loadSettings(): Promise<Settings> {
  const stored = (await browser.storage.local.get(KEY))[KEY] as Partial<Settings> | undefined;
  return { ...DEFAULT_SETTINGS, ...stored, filters: normalizeFilters(stored?.filters) };
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
