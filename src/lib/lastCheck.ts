import browser from "webextension-polyfill";
import type { StoreResult } from "./check";
import type { WantedCard } from "./types";

/** The most recent check, shown again in the popup and results page. */
export interface LastCheck {
  at: string;
  label: string;
  wanted: WantedCard[];
  totalStores: number;
  results: StoreResult[];
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
