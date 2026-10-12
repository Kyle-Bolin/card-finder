import { nameFromTitle } from "./shopifyStore";
import type { FetchFn, Store } from "./types";

/** Whether page HTML declares itself a Crystal Commerce storefront. */
export function isCrystalCommerceHtml(html: string): boolean {
  return /<meta\b[^>]*\bcontent=["']CrystalCommerce["'][^>]*>/i.test(html);
}

/** A Crystal Commerce store to save, or null when the site's home page isn't one. */
export async function detectCrystalCommerceStore(
  origin: string,
  fetchFn: FetchFn = fetch,
): Promise<Store | null> {
  const res = await fetchFn(`${origin}/`, { headers: { Accept: "text/html" } });
  if (!res.ok) return null;
  const html = await res.text();
  if (!isCrystalCommerceHtml(html)) return null;
  const fallback = new URL(origin).hostname.replace(/^www\./, "");
  return {
    url: new URL(res.url || origin).origin,
    name: nameFromTitle(html, fallback),
    platform: "crystalcommerce",
  };
}
