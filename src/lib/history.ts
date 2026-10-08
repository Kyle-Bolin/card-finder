import browser from "webextension-polyfill";
import type { StoreResult } from "./check";
import type { Listing, WantedCard } from "./types";

/** What we remember about one listing between checks. */
export interface HistoryEntry {
  storeUrl: string;
  storeName: string;
  card: string;
  set: string;
  condition: string;
  foil: boolean;
  price: number;
  /** Missing for stores that don't report counts. */
  qty?: number;
  firstSeen: string;
  lastSeen: string;
}

/** The last check of one deck: listing key → entry. */
export interface DeckHistory {
  checkedAt: string;
  entries: Record<string, HistoryEntry>;
}

export type Badge = { kind: "new" } | { kind: "drop"; oldPrice: number };

/** How a check differs from the one before it. Plain data, so it can cross message ports. */
export interface CheckChanges {
  /** When the deck was last checked before this; null on a first check. */
  previousAt: string | null;
  badges: Record<string, Badge>;
  soldOut: HistoryEntry[];
}

export const HISTORY_MAX_AGE_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;
const KEY = "history";

/** Identifies a listing across checks: store, normalized name, set, condition, foil. */
export function listingKey(
  listing: Pick<Listing, "storeUrl" | "cardName" | "setName" | "condition" | "foil">,
): string {
  return [
    listing.storeUrl,
    listing.cardName.trim().toLowerCase(),
    listing.setName.trim().toLowerCase(),
    String(listing.condition).toUpperCase(),
    listing.foil ? "foil" : "nonfoil",
  ].join("|");
}

/** Storage key for a pasted card list: the same cards give the same key. */
export function listKey(wanted: WantedCard[]): string {
  const names = wanted.map((w) => w.name.trim().toLowerCase()).sort();
  let hash = 5381;
  for (const ch of names.join("|")) hash = ((hash * 33) ^ ch.charCodeAt(0)) >>> 0;
  return `list:${hash.toString(36)}`;
}

/**
 * Compare this check with the previous one. `previous` null (first check, or
 * missing or corrupt data) gives no badges. Stores that errored keep their old
 * entries and never count as sold out.
 */
export function diffCheck(
  previous: DeckHistory | null,
  results: StoreResult[],
  wanted: WantedCard[],
  now: string,
): { history: DeckHistory; changes: CheckChanges } {
  const current = new Map<string, HistoryEntry>();
  for (const result of results) {
    if (result.error) continue;
    for (const l of result.listings) {
      const key = listingKey(l);
      const seen = current.get(key);
      if (seen) {
        // Same key, e.g. two printings in one set: show the cheapest, count all copies.
        seen.price = Math.min(seen.price, l.price);
        seen.qty =
          seen.qty === undefined || l.quantity === undefined ? undefined : seen.qty + l.quantity;
        continue;
      }
      current.set(key, {
        storeUrl: l.storeUrl,
        storeName: result.store.name,
        card: l.cardName,
        set: l.setName,
        condition: String(l.condition),
        foil: l.foil,
        price: l.price,
        qty: l.quantity,
        firstSeen: now,
        lastSeen: now,
      });
    }
  }

  const badges: Record<string, Badge> = {};
  const entries: Record<string, HistoryEntry> = {};
  for (const [key, entry] of current) {
    const before = previous?.entries[key];
    if (before) entry.firstSeen = before.firstSeen;
    if (previous) {
      if (!before) badges[key] = { kind: "new" };
      else if (entry.price < before.price - 0.005) {
        badges[key] = { kind: "drop", oldPrice: before.price };
      }
    }
    entries[key] = entry;
  }

  const soldOut: HistoryEntry[] = [];
  if (previous) {
    const failed = new Set(results.filter((r) => r.error).map((r) => r.store.url));
    const checked = new Set(results.filter((r) => !r.error).map((r) => r.store.url));
    const wantedNames = new Set(wanted.map((w) => w.name.trim().toLowerCase()));
    for (const [key, entry] of Object.entries(previous.entries)) {
      if (entries[key]) continue;
      if (failed.has(entry.storeUrl)) entries[key] = entry;
      else if (checked.has(entry.storeUrl) && wantedNames.has(entry.card.trim().toLowerCase())) {
        soldOut.push(entry);
      }
    }
  }

  return {
    history: { checkedAt: now, entries },
    changes: { previousAt: previous?.checkedAt ?? null, badges, soldOut },
  };
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

function parseEntry(raw: unknown): HistoryEntry | null {
  if (!isObject(raw)) return null;
  const { storeUrl, storeName, card, set, condition, foil, price, qty, firstSeen, lastSeen } = raw;
  if (
    typeof storeUrl !== "string" ||
    typeof storeName !== "string" ||
    typeof card !== "string" ||
    typeof set !== "string" ||
    typeof condition !== "string" ||
    typeof foil !== "boolean" ||
    typeof price !== "number" ||
    !Number.isFinite(price) ||
    (qty !== undefined && (typeof qty !== "number" || !Number.isFinite(qty))) ||
    typeof firstSeen !== "string" ||
    typeof lastSeen !== "string"
  ) {
    return null;
  }
  return {
    storeUrl,
    storeName,
    card,
    set,
    condition,
    foil,
    price,
    qty,
    firstSeen,
    lastSeen,
  };
}

/** Validate stored data; anything unusable is null, which callers treat as a first check. */
export function parseDeckHistory(raw: unknown): DeckHistory | null {
  if (!isObject(raw) || typeof raw.checkedAt !== "string" || !isObject(raw.entries)) return null;
  if (Number.isNaN(Date.parse(raw.checkedAt))) return null;
  const entries: Record<string, HistoryEntry> = {};
  for (const [key, value] of Object.entries(raw.entries)) {
    const entry = parseEntry(value);
    if (entry) entries[key] = entry;
  }
  return { checkedAt: raw.checkedAt, entries };
}

/** Drop decks not checked within `maxAgeDays` (and any with an unreadable date). */
export function pruneHistory(
  all: Record<string, DeckHistory>,
  now: string,
  maxAgeDays = HISTORY_MAX_AGE_DAYS,
): Record<string, DeckHistory> {
  const cutoff = Date.parse(now) - maxAgeDays * DAY_MS;
  return Object.fromEntries(
    Object.entries(all).filter(([, h]) => Date.parse(h.checkedAt) >= cutoff),
  );
}

/** "just now", "5 minutes ago", "2 days ago"; empty if the date is unreadable. */
export function formatAgo(iso: string, now: Date = new Date()): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "";
  const minutes = Math.floor((now.getTime() - then) / 60000);
  if (minutes < 1) return "just now";
  const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? "" : "s"} ago`;
  if (minutes < 60) return plural(minutes, "minute");
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return plural(hours, "hour");
  return plural(Math.floor(hours / 24), "day");
}

async function loadAll(): Promise<Record<string, DeckHistory>> {
  try {
    const raw = (await browser.storage.local.get(KEY))[KEY];
    if (!isObject(raw)) return {};
    const all: Record<string, DeckHistory> = {};
    for (const [deck, value] of Object.entries(raw)) {
      const parsed = parseDeckHistory(value);
      if (parsed) all[deck] = parsed;
    }
    return all;
  } catch {
    return {};
  }
}

export async function loadDeckHistory(deckKey: string): Promise<DeckHistory | null> {
  return (await loadAll())[deckKey] ?? null;
}

/** Save a deck's history, pruning decks that haven't been checked in 90 days. */
export async function saveDeckHistory(deckKey: string, history: DeckHistory): Promise<void> {
  const all = await loadAll();
  all[deckKey] = history;
  await browser.storage.local.set({ [KEY]: pruneHistory(all, history.checkedAt) });
}

export async function clearHistory(): Promise<void> {
  await browser.storage.local.remove(KEY);
}
