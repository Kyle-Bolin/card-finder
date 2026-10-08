import type { KeyValueStore } from "./cache";
import { describeFetchError } from "./fetchError";
import { findListings } from "./check";
import { limitFetch } from "./limit";
import { MIN_BASKET_CARDS, PRICE_BASKET } from "./priceBasket";
import { mapLimit, distanceMiles } from "./storeFinder";
import type { FetchFn, GeoPoint, Listing, Store, WantedCard } from "./types";

/** Basket prices are reused for a day; reopening the tab or changing the range reuses them. */
export const BASKET_TTL_MS = 24 * 60 * 60 * 1000;
const CACHE_PREFIX = "basket:";

/**
 * Hosts whose robots.txt forbids automated requests (see docs/spikes/store-platforms.md).
 * The crawler never touches them, and neither does the price ranking.
 */
export const ROBOTS_BLOCKED_HOSTS: readonly string[] = ["store.battlegroundgames.com"];

export function isRobotsBlocked(store: Store): boolean {
  try {
    return ROBOTS_BLOCKED_HOSTS.includes(new URL(store.url).hostname);
  } catch {
    return false;
  }
}

/** The cheapest in-stock copy a buyer would pick: non-foil, English, NM or LP. */
export function cheapestBasketPrice(listings: Listing[], cardName: string): number | null {
  let best: number | null = null;
  for (const l of listings) {
    if (l.cardName !== cardName || l.foil || l.language !== "English") continue;
    if (l.condition !== "NM" && l.condition !== "LP") continue;
    if (!(l.price > 0)) continue;
    if (best === null || l.price < best) best = l.price;
  }
  return best;
}

/** One store's cheapest price for each basket card it stocks. */
export type BasketPrices = Record<string, number>;

export interface StoreBasket {
  store: Store;
  /** Epoch ms the prices were fetched. */
  at: number;
  prices: BasketPrices;
  error?: string;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? (sorted[mid] as number)
    : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
}

/** Median price of each card across the stores that stock it. */
export function areaMedians(baskets: { prices: BasketPrices }[]): Record<string, number> {
  const byCard = new Map<string, number[]>();
  for (const { prices } of baskets) {
    for (const [name, price] of Object.entries(prices)) {
      byCard.set(name, [...(byCard.get(name) ?? []), price]);
    }
  }
  return Object.fromEntries([...byCard].map(([name, prices]) => [name, median(prices)]));
}

export interface CardComparison {
  name: string;
  price: number;
  median: number;
}

export interface StoreScore {
  store: Store;
  distanceMiles: number | null;
  /** How many basket cards the store stocks. */
  coverage: number;
  basketSize: number;
  /** Geometric mean of price ÷ area median; below 1 is cheaper. Null when not enough data. */
  ratio: number | null;
  /** Sum of the store's cheapest copies, only for a store with every basket card. */
  total: number | null;
  cards: CardComparison[];
}

/** Score the stores that loaded: ratio to the area median per card, then the geometric mean. */
export function scoreStores(
  baskets: StoreBasket[],
  home: GeoPoint | undefined,
  basket: readonly { name: string }[] = PRICE_BASKET,
  minCards = MIN_BASKET_CARDS,
): StoreScore[] {
  const loaded = baskets.filter((b) => !b.error);
  const medians = areaMedians(loaded);
  return loaded.map(({ store, prices }) => {
    const cards = basket.flatMap(({ name }) => {
      const price = prices[name];
      const med = medians[name];
      return price !== undefined && med !== undefined ? [{ name, price, median: med }] : [];
    });
    const enough = cards.length >= minCards;
    const ratio = enough
      ? Math.exp(cards.reduce((sum, c) => sum + Math.log(c.price / c.median), 0) / cards.length)
      : null;
    const { latitude, longitude } = store;
    return {
      store,
      distanceMiles:
        home && latitude !== undefined && longitude !== undefined
          ? distanceMiles(home, { latitude, longitude })
          : null,
      coverage: cards.length,
      basketSize: basket.length,
      ratio,
      total:
        cards.length === basket.length && basket.length
          ? cards.reduce((sum, c) => sum + c.price, 0)
          : null,
      cards,
    };
  });
}

export type PriceSort = "cheapest" | "closest" | "coverage";

/** Ranked stores first (in the chosen order); "not enough data" stores always last. */
export function sortScores(scores: StoreScore[], mode: PriceSort): StoreScore[] {
  const dist = (s: StoreScore) => s.distanceMiles ?? Infinity;
  const byName = (a: StoreScore, b: StoreScore) => a.store.name.localeCompare(b.store.name);
  const order = {
    cheapest: (a: StoreScore, b: StoreScore) =>
      (a.ratio as number) - (b.ratio as number) || b.coverage - a.coverage || dist(a) - dist(b),
    closest: (a: StoreScore, b: StoreScore) => dist(a) - dist(b),
    coverage: (a: StoreScore, b: StoreScore) =>
      b.coverage - a.coverage || (a.ratio as number) - (b.ratio as number) || dist(a) - dist(b),
  }[mode];
  const ranked = scores.filter((s) => s.ratio !== null).sort((a, b) => order(a, b) || byName(a, b));
  const sparse = scores
    .filter((s) => s.ratio === null)
    .sort((a, b) => b.coverage - a.coverage || byName(a, b));
  return [...ranked, ...sparse];
}

/** "12% below" / "8% above" / "at" the area median. */
export function describeRatio(ratio: number): string {
  const pct = Math.round(Math.abs(ratio - 1) * 100);
  if (pct === 0) return "at area median";
  return `${pct}% ${ratio < 1 ? "below" : "above"} area median`;
}

export interface LoadOptions {
  fetchFn?: FetchFn;
  store: KeyValueStore;
  now?: () => number;
  /** Ignore cached prices (the Refresh button). */
  force?: boolean;
  /** Stores fetched at once. */
  concurrency?: number;
  maxInFlight?: number;
  onProgress?: (done: number, total: number, basket: StoreBasket) => void;
}

interface CacheEntry {
  at: number;
  prices: BasketPrices;
}

function validEntry(value: unknown): value is CacheEntry {
  const e = value as CacheEntry | undefined;
  return !!e && typeof e.at === "number" && !!e.prices && typeof e.prices === "object";
}

/**
 * Basket prices for each store: cached ones under 24 hours old are reused, the rest are
 * fetched (a failing store reports its error and the others carry on). Only runs when called.
 */
export async function loadBaskets(
  stores: Store[],
  {
    fetchFn = fetch,
    store: cache,
    now = Date.now,
    force = false,
    concurrency = 3,
    maxInFlight = 8,
    onProgress,
  }: LoadOptions,
): Promise<StoreBasket[]> {
  const limited = limitFetch(fetchFn, maxInFlight);
  const wanted: WantedCard[] = PRICE_BASKET.map((c) => ({
    name: c.name,
    quantity: 1,
    sources: [],
  }));
  const eligible = stores.filter((s) => !isRobotsBlocked(s));
  let done = 0;
  return mapLimit(eligible, concurrency, async (s) => {
    let result: StoreBasket;
    const cached = force ? undefined : await cache.get(CACHE_PREFIX + s.url);
    if (validEntry(cached) && now() - cached.at < BASKET_TTL_MS) {
      result = { store: s, at: cached.at, prices: cached.prices };
    } else {
      try {
        const listings = await findListings(s, wanted, limited, { cardConcurrency: 3 });
        const prices: BasketPrices = {};
        for (const { name } of PRICE_BASKET) {
          const price = cheapestBasketPrice(listings, name);
          if (price !== null) prices[name] = price;
        }
        const at = now();
        await cache.set(CACHE_PREFIX + s.url, { at, prices } satisfies CacheEntry);
        result = { store: s, at, prices };
      } catch (err) {
        result = { store: s, at: now(), prices: {}, error: describeFetchError(err, s.url) };
      }
    }
    onProgress?.(++done, eligible.length, result);
    return result;
  });
}
