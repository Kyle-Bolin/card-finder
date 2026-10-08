import type { TtlCache } from "../cache";
import type { FetchFn, Listing, Store, StorePlatform, WantedCard } from "../types";

/** Short-lived cache of catalog searches (never used for stock lookups). */
export type SearchCache = TtlCache<unknown>;

export interface ProviderOptions {
  /** Card searches in flight per store. */
  cardConcurrency: number;
  searchCache?: SearchCache;
}

/** How to look up wanted cards at one kind of store. */
export interface StoreProvider {
  platform: StorePlatform;
  findListings(
    store: Store,
    wanted: WantedCard[],
    fetchFn: FetchFn,
    options: ProviderOptions,
  ): Promise<Listing[]>;
}

/** A cached search, or `load` when there is no cache. */
export function cachedSearch<T>(
  cache: SearchCache | undefined,
  key: string,
  load: () => Promise<T>,
): Promise<T> {
  return cache ? (cache.getOrLoad(key, load) as Promise<T>) : load();
}
