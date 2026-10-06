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
