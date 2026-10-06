import { isSingleCard, matchesCard, parseCondition } from "./matching";
import { mapLimit } from "./storeFinder";
import { getSkus, productUrl, searchProducts, type CatalogProduct } from "./tcgplayerpro";
import type { FetchFn, Listing, Store, WantedCard } from "./types";

export interface StoreResult {
  store: Store;
  listings: Listing[];
  /** Wanted cards this store has in stock. */
  found: string[];
  error?: string;
}

/**
 * In-stock listings of the wanted cards at one store: one catalog search per card
 * (exact name matches only), then one batched inventory lookup.
 */
export async function findListings(
  store: Store,
  wanted: WantedCard[],
  fetchFn: FetchFn = fetch,
): Promise<Listing[]> {
  const matches: { card: string; product: CatalogProduct }[] = [];
  for (const card of wanted) {
    for (const product of await searchProducts(store.url, card.name, fetchFn)) {
      if (matchesCard(product.name, card.name) && isSingleCard(product.setName, product.name)) {
        matches.push({ card: card.name, product });
      }
    }
  }
  if (!matches.length) return [];
  const skus = await getSkus(store.url, [...new Set(matches.map((m) => m.product.id))], fetchFn);
  const listings: Listing[] = [];
  for (const { card, product } of matches) {
    for (const sku of skus.get(product.id) ?? []) {
      if (sku.quantity <= 0) continue;
      listings.push({
        storeUrl: store.url,
        cardName: card,
        productName: product.name,
        setName: product.setName,
        condition: parseCondition(sku.conditionName),
        language: sku.languageName,
        foil: sku.isFoil,
        price: Number(sku.price),
        quantity: sku.quantity,
        url: productUrl(store.url, product),
      });
    }
  }
  return listings.sort((a, b) => a.cardName.localeCompare(b.cardName) || a.price - b.price);
}

/**
 * Check several stores (a few at a time), reporting each store's result as soon
 * as it's done. A failing store reports its error; the others carry on.
 */
export async function checkStores(
  stores: Store[],
  wanted: WantedCard[],
  onResult: (result: StoreResult) => void,
  { fetchFn = fetch, concurrency = 3 }: { fetchFn?: FetchFn; concurrency?: number } = {},
): Promise<StoreResult[]> {
  return mapLimit(stores, concurrency, async (store) => {
    let result: StoreResult;
    try {
      const listings = await findListings(store, wanted, fetchFn);
      result = { store, listings, found: [...new Set(listings.map((l) => l.cardName))] };
    } catch (err) {
      result = {
        store,
        listings: [],
        found: [],
        error: err instanceof Error ? err.message : String(err),
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
