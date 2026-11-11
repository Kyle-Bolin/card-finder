import browser from "webextension-polyfill";
import { storageAreaStore, type KeyValueStore } from "./cache";
import { fetchArtistEvents, type ArtistEvents } from "./artistEvents";
import type { FetchFn } from "./types";

export const ARTIST_EVENTS_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const CACHE_KEY = "artistEventsCache";

interface Cached {
  fetchedAt: number;
  events: ArtistEvents;
}

/** Artist events from storage if fetched within a day, else fetched (a stale copy beats nothing). */
export async function loadArtistEvents({
  fetchFn = fetch,
  store = storageAreaStore(() => browser.storage?.local),
  now = Date.now,
}: {
  fetchFn?: FetchFn;
  store?: KeyValueStore;
  now?: () => number;
} = {}): Promise<ArtistEvents | null> {
  const cached = (await store.get(CACHE_KEY)) as Cached | undefined;
  const valid = cached && typeof cached.fetchedAt === "number" && cached.events;
  if (valid && now() - cached.fetchedAt < ARTIST_EVENTS_CACHE_TTL_MS) return cached.events;
  const events = await fetchArtistEvents(fetchFn);
  if (events) {
    await store.set(CACHE_KEY, { fetchedAt: now(), events } satisfies Cached);
    return events;
  }
  return valid ? cached.events : null;
}
