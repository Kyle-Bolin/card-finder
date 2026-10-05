import { mapLimit } from "../lib/storeFinder";
import type { FetchFn } from "../lib/types";

/**
 * TCGplayer marketplace sellers enrolled in TCGplayer Pro. Every Pro storefront
 * is one of these sellers, and its /api/site returns the same seller key, so a
 * name-based guess can be verified exactly. Covers stores that aren't in the
 * Wizards store locator (Pokémon/Yu-Gi-Oh shops, non-WPN stores).
 */
export interface ProSeller {
  sellerKey: string;
  name: string;
  city?: string;
  state?: string;
}

const SEARCH_API = "https://mp-search-api.tcgplayer.com/v1";
const PAGE = 50;

interface SearchResponse {
  results?: { totalResults: number; results: { productId: number | string }[] }[];
}

interface ListingsResponse {
  results?: {
    totalResults: number;
    results: {
      sellerKey: string;
      sellerName: string;
      sellerPrograms?: string[] | null;
      sellerAddress?: { city?: string | null; territory?: string | null } | null;
    }[];
  }[];
}

async function postJson<T>(url: string, body: unknown, fetchFn: FetchFn): Promise<T | null> {
  try {
    const res = await fetchFn(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://www.tcgplayer.com" },
      body: JSON.stringify(body),
    });
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
}

/** Best-selling product IDs for a product line ("magic", "pokemon", "yugioh", …). */
export async function bestSellingProducts(
  productLine: string,
  count: number,
  fetchFn: FetchFn,
): Promise<number[]> {
  const ids: number[] = [];
  for (let from = 0; from < count; from += PAGE) {
    const data = await postJson<SearchResponse>(
      `${SEARCH_API}/search/request?q=&isList=false`,
      {
        algorithm: "sales_dismax",
        from,
        size: Math.min(PAGE, count - from),
        filters: { term: { productLineName: [productLine] }, range: {}, match: {} },
        context: { cart: {}, shippingCountry: "US" },
        settings: { useFuzzySearch: true, didYouMean: {} },
        sort: {},
      },
      fetchFn,
    );
    const page = data?.results?.[0]?.results ?? [];
    ids.push(...page.map((p) => Number(p.productId)).filter(Number.isFinite));
    if (page.length < PAGE) break;
  }
  return ids;
}

/** Pro sellers with in-stock listings for one product. */
export async function proSellersForProduct(
  productId: number,
  fetchFn: FetchFn,
  maxListings = 150,
): Promise<ProSeller[]> {
  const sellers: ProSeller[] = [];
  for (let from = 0; from < maxListings; from += PAGE) {
    const data = await postJson<ListingsResponse>(
      `${SEARCH_API}/product/${productId}/listings`,
      {
        filters: {
          term: { sellerStatus: "Live", channelId: 0, sellerPrograms: ["Pro"] },
          range: { quantity: { gte: 1 } },
          exclude: { channelExclusion: 0 },
        },
        from,
        size: PAGE,
        context: { shippingCountry: "US", cart: {} },
      },
      fetchFn,
    );
    const page = data?.results?.[0]?.results ?? [];
    for (const l of page) {
      if (!l.sellerKey || !l.sellerPrograms?.includes("Pro")) continue;
      sellers.push({
        sellerKey: l.sellerKey.toLowerCase(),
        name: l.sellerName,
        city: l.sellerAddress?.city ?? undefined,
        state: l.sellerAddress?.territory ?? undefined,
      });
    }
    if (page.length < PAGE) break;
  }
  return sellers;
}

/** Unique Pro sellers across the best sellers of several product lines. */
export async function collectProSellers(
  productLines: string[],
  productsPerLine: number,
  fetchFn: FetchFn,
  log: (message: string) => void = () => {},
): Promise<Map<string, ProSeller>> {
  const products: number[] = [];
  for (const line of productLines) {
    const ids = await bestSellingProducts(line, productsPerLine, fetchFn);
    log(`  ${line}: ${ids.length} products`);
    products.push(...ids);
  }
  const sellers = new Map<string, ProSeller>();
  let done = 0;
  await mapLimit([...new Set(products)], 3, async (id) => {
    for (const seller of await proSellersForProduct(id, fetchFn)) {
      if (!sellers.has(seller.sellerKey)) sellers.set(seller.sellerKey, seller);
    }
    if (++done % 100 === 0) log(`  ${done}/${products.length} products, ${sellers.size} sellers`);
  });
  return sellers;
}
