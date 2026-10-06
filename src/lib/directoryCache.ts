import browser from "webextension-polyfill";
import { storageAreaStore, type KeyValueStore } from "./cache";
import { fetchDirectory, type Directory } from "./directory";
import type { FetchFn } from "./types";

export const DIRECTORY_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const DIRECTORY_CACHE_KEY = "directoryCache";

interface DirectoryCache {
  fetchedAt: number;
  directory: Directory;
}

/**
 * The directory from `browser.storage.local` if it was fetched within a day,
 * otherwise freshly fetched (and cached). `refresh` forces a fetch. If the fetch
 * fails, a stale cached copy is better than nothing.
 */
export async function loadDirectory({
  fetchFn = fetch,
  refresh = false,
  store = storageAreaStore(() => browser.storage?.local),
  now = Date.now,
}: {
  fetchFn?: FetchFn;
  refresh?: boolean;
  store?: KeyValueStore;
  now?: () => number;
} = {}): Promise<Directory | null> {
  const cached = (await store.get(DIRECTORY_CACHE_KEY)) as DirectoryCache | undefined;
  const valid = cached && typeof cached.fetchedAt === "number" && cached.directory;
  if (valid && !refresh && now() - cached.fetchedAt < DIRECTORY_CACHE_TTL_MS) {
    return cached.directory;
  }
  const directory = await fetchDirectory(fetchFn);
  if (directory) {
    await store.set(DIRECTORY_CACHE_KEY, { fetchedAt: now(), directory } satisfies DirectoryCache);
    return directory;
  }
  return valid ? cached.directory : null;
}
