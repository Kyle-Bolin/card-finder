import browser from "webextension-polyfill";
import type { StoreResult } from "./check";
import type { CheckChanges } from "./history";
import type { Filters } from "./filters";
import type { WantedCard } from "./types";

/** The most recent check, shown again in the popup and results page. */
export interface LastCheck {
  at: string;
  label: string;
  wanted: WantedCard[];
  totalStores: number;
  /** Filters in effect for this check; absent in checks saved before filters existed. */
  filters?: Filters;
  results: StoreResult[];
  /** What changed since the check before; absent on older saves. */
  changes?: CheckChanges;
}

const KEY = "lastCheck";

export async function saveLastCheck(check: LastCheck): Promise<void> {
  await browser.storage.local.set({ [KEY]: check });
}

export async function loadLastCheck(): Promise<LastCheck | null> {
  try {
    return ((await browser.storage.local.get(KEY))[KEY] as LastCheck | undefined) ?? null;
  } catch {
    return null;
  }
}
