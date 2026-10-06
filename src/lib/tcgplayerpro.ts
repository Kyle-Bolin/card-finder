import type { FetchFn, StoreSite } from "./types";

const STOREFRONT_HOST = /^[a-z0-9-]+\.tcgplayerpro\.com$/;

/**
 * Normalize user input ("dmcomics", "dmcomics.tcgplayerpro.com",
 * "https://dmcomics.tcgplayerpro.com/search/products?q=x") to a storefront origin.
 * Returns null if it isn't a TCGplayer Pro storefront.
 */
export function normalizeStoreUrl(input: string): string | null {
  let value = input.trim().toLowerCase();
  if (!value) return null;
  if (/^[a-z0-9-]+$/.test(value)) value = `${value}.tcgplayerpro.com`;
  if (!/^https?:\/\//.test(value)) value = `https://${value}`;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (!STOREFRONT_HOST.test(url.hostname)) return null;
  return `https://${url.hostname}`;
}

interface SiteResponse {
  settings?: { siteName?: string };
  contactInfo?: {
    storeName?: string;
    storeAddress?: { street?: string; city?: string; state?: string; zip?: string } | null;
    storeHours?: string | null;
    email?: string | null;
    phone?: string | null;
  } | null;
  seller?: { sellerKey?: string } | null;
}

/**
 * Fetch store details from `GET {storeUrl}/api/site`.
 * Returns null when no storefront exists at that URL (404).
 * Stores that rename their storefront redirect the old subdomain to the new one;
 * the returned `url` is where the request ended up.
 */
export async function getSite(
  storeUrl: string,
  fetchFn: FetchFn = fetch,
): Promise<StoreSite | null> {
  const res = await fetchFn(`${storeUrl}/api/site`, { headers: { Accept: "application/json" } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`${storeUrl}/api/site returned HTTP ${res.status}`);
  const data = (await res.json()) as SiteResponse;
  const contact = data.contactInfo ?? {};
  const addr = contact.storeAddress;
  const url = res.url ? new URL(res.url).origin : storeUrl;
  return {
    url,
    name: contact.storeName || data.settings?.siteName || new URL(url).hostname,
    address: addr
      ? {
          street: addr.street ?? "",
          city: addr.city ?? "",
          state: addr.state ?? "",
          zip: addr.zip ?? "",
        }
      : undefined,
    phone: contact.phone ?? undefined,
    hours: contact.storeHours ?? undefined,
    email: contact.email ?? undefined,
    sellerKey: data.seller?.sellerKey,
  };
}

/** A product from a storefront's catalog search. */
export interface CatalogProduct {
  id: number;
  name: string;
  setName: string;
  productLineUrlName: string;
  setUrlName: string;
  productUrlName: string;
}

export interface Sku {
  conditionName: string;
  languageName: string;
  isFoil: boolean;
  price: number;
  quantity: number;
}

const MAGIC = "Magic: The Gathering";
const SKU_BATCH = 100;

/** In-stock Magic products matching `query` (fuzzy) at a storefront. */
export async function searchProducts(
  storeUrl: string,
  query: string,
  fetchFn: FetchFn = fetch,
): Promise<CatalogProduct[]> {
  const res = await fetchFn(`${storeUrl}/api/catalog/search`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      query,
      context: { productLineName: MAGIC },
      filters: {},
      from: 0,
      size: 48,
    }),
  });
  if (!res.ok)
    throw new Error(`Search failed at ${new URL(storeUrl).hostname} (HTTP ${res.status})`);
  const data = (await res.json()) as { products?: { items?: CatalogProduct[] } };
  return data.products?.items ?? [];
}

/** Per-condition price and stock for products, keyed by product ID. */
export async function getSkus(
  storeUrl: string,
  productIds: number[],
  fetchFn: FetchFn = fetch,
): Promise<Map<number, Sku[]>> {
  const skus = new Map<number, Sku[]>();
  for (let i = 0; i < productIds.length; i += SKU_BATCH) {
    const ids = productIds.slice(i, i + SKU_BATCH).join(",");
    const res = await fetchFn(`${storeUrl}/api/inventory/skus?productIds=${ids}`, {
      headers: { Accept: "application/json" },
    });
    if (!res.ok)
      throw new Error(
        `Inventory lookup failed at ${new URL(storeUrl).hostname} (HTTP ${res.status})`,
      );
    const data = (await res.json()) as { productId: number; skus: Sku[] }[];
    for (const product of data) skus.set(product.productId, product.skus ?? []);
  }
  return skus;
}

/** Link to a product's page on the storefront (route: /catalog/:line/:set/:product/:id). */
export function productUrl(storeUrl: string, product: CatalogProduct): string {
  return `${storeUrl}/catalog/${product.productLineUrlName}/${product.setUrlName}/${product.productUrlName}/${product.id}`;
}
