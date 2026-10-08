import { applyFilters } from "./filters";
import { describeFetchError } from "./fetchError";
import { limitFetch } from "./limit";
import type { Filters } from "./settings";
import { mapLimit } from "./storeFinder";
import { shopifyProvider } from "./providers/shopify";
import { tcgplayerProProvider } from "./providers/tcgplayerpro";
import type { SearchCache, StoreProvider } from "./providers/types";
import type { FetchFn, Listing, Store, StorePlatform, WantedCard } from "./types";

export interface StoreResult {
  store: Store;
  listings: Listing[];
  /** Wanted cards this store has in stock. */
  found: string[];
  error?: string;
}

export interface FindOptions {
  /** Card searches in flight per store. */
  cardConcurrency?: number;
  /** Short-lived cache of catalog searches (never used for SKU stock). */
  searchCache?: SearchCache;
}

const PROVIDERS: Record<StorePlatform, StoreProvider> = {
  tcgplayerpro: tcgplayerProProvider,
  shopify: shopifyProvider,
};

/** In-stock listings of the wanted cards at one store, using its platform's provider. */
export async function findListings(
  store: Store,
  wanted: WantedCard[],
  fetchFn: FetchFn = fetch,
  { cardConcurrency = 1, searchCache }: FindOptions = {},
): Promise<Listing[]> {
  const provider = PROVIDERS[store.platform ?? "tcgplayerpro"] ?? tcgplayerProProvider;
  const listings = await provider.findListings(store, wanted, fetchFn, {
    cardConcurrency,
    searchCache,
  });
  return listings.sort((a, b) => a.cardName.localeCompare(b.cardName) || a.price - b.price);
}

/** Stores that had finds in the previous check first; otherwise the original order. */
export function prioritizeStores(stores: Store[], previous: StoreResult[] = []): Store[] {
  const hadFinds = new Set(previous.filter((r) => r.found.length).map((r) => r.store.url));
  return [
    ...stores.filter((s) => hadFinds.has(s.url)),
    ...stores.filter((s) => !hadFinds.has(s.url)),
  ];
}

export const DEFAULT_MAX_IN_FLIGHT = 8;

export interface CheckOptions extends FindOptions {
  fetchFn?: FetchFn;
  /** Stores checked at once. */
  concurrency?: number;
  /** Total requests in flight across all stores. */
  maxInFlight?: number;
  /** Results of the last check, used to put stores with earlier finds first. */
  previous?: StoreResult[];
  /** Only listings passing these count. */
  filters?: Filters;
}

/**
 * Check several stores (a few at a time, each searching a few cards at a time, with
 * a cap on total in-flight requests), reporting each store's result as soon as it's
 * done. A failing store reports its error; the others carry on.
 */
export async function checkStores(
  stores: Store[],
  wanted: WantedCard[],
  onResult: (result: StoreResult) => void,
  {
    fetchFn = fetch,
    concurrency = 3,
    cardConcurrency = 3,
    maxInFlight = DEFAULT_MAX_IN_FLIGHT,
    searchCache,
    previous,
    filters,
  }: CheckOptions = {},
): Promise<StoreResult[]> {
  const limited = limitFetch(fetchFn, maxInFlight);
  const ordered = prioritizeStores(stores, previous);
  return mapLimit(ordered, concurrency, async (store) => {
    let result: StoreResult;
    try {
      const all = await findListings(store, wanted, limited, { cardConcurrency, searchCache });
      const listings = filters ? applyFilters(all, filters) : all;
      result = { store, listings, found: [...new Set(listings.map((l) => l.cardName))] };
    } catch (err) {
      result = {
        store,
        listings: [],
        found: [],
        error: describeFetchError(err, store.url),
      };
    }
    onResult(result);
    return result;
  });
}

/** Parse a pasted card list: "1 Sol Ring", "2x Cloudshift", "Sol Ring (CMR) 472 *F*", or bare names. */
export function parseCardList(text: string): WantedCard[] {
  const cards = new Map<string, WantedCard>();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (
      !line ||
      /^(\/\/|#)/.test(line) ||
      /^(sideboard|maybeboard|commander|deck|considering)\b:?$/i.test(line)
    ) {
      continue;
    }
    const match = line.match(/^(\d+)\s*x?\s+(.+)$/i);
    const quantity = match ? Number(match[1]) : 1;
    const name = (match ? (match[2] ?? "") : line)
      .replace(/\s+\([A-Z0-9]{2,6}\)\s+\S+.*$/, "") // "(CMR) 472 *F*" set/collector suffix
      .replace(/\s+\*[A-Z]+\*$/, "")
      .replace(/\s+#\S+.*$/, "") // Moxfield "#tag" annotations
      .trim();
    if (!name) continue;
    const key = name.toLowerCase();
    const existing = cards.get(key);
    if (existing) existing.quantity = Math.max(existing.quantity, quantity);
    else cards.set(key, { name, quantity, sources: [] });
  }
  return [...cards.values()];
}
