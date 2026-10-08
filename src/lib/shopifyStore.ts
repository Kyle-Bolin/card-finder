import type { FetchFn, Store } from "./types";

/** An `https://` origin from user input, or null. */
export function normalizeHttpsOrigin(input: string): string | null {
  const value = input.trim();
  if (!/^https:\/\//i.test(value)) return null;
  try {
    const url = new URL(value);
    return url.hostname.includes(".") ? url.origin : null;
  } catch {
    return null;
  }
}

async function getJson(
  url: string,
  fetchFn: FetchFn,
): Promise<{ data: unknown; url: string } | null> {
  const res = await fetchFn(url, { headers: { Accept: "application/json" } });
  if (!res.ok) return null;
  try {
    return { data: await res.json(), url: res.url || url };
  } catch {
    return null;
  }
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Whether the site is a Shopify storefront: `/products.json` answers JSON with
 * `products`, or `/search/suggest.json` answers `resources`. Returns the origin the
 * request ended up at (a bare domain may redirect to `www`), or null.
 */
export async function detectShopify(
  origin: string,
  fetchFn: FetchFn = fetch,
): Promise<string | null> {
  const products = await getJson(`${origin}/products.json?limit=1`, fetchFn);
  if (isObject(products?.data) && Array.isArray(products.data.products)) {
    return new URL(products.url).origin;
  }
  const suggest = await getJson(
    `${origin}/search/suggest.json?q=a&resources[type]=product`,
    fetchFn,
  );
  if (isObject(suggest?.data) && isObject(suggest.data.resources)) {
    return new URL(suggest.url).origin;
  }
  return null;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, body: string) => {
    if (body.startsWith("#")) {
      const code =
        body[1]?.toLowerCase() === "x" ? parseInt(body.slice(2), 16) : Number(body.slice(1));
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    return ENTITIES[body.toLowerCase()] ?? match;
  });
}

/** The store's name from its home page `<title>` (text before the first " | " or " – "), else the domain. */
export async function shopifyStoreName(origin: string, fetchFn: FetchFn = fetch): Promise<string> {
  const fallback = new URL(origin).hostname.replace(/^www\./, "");
  try {
    const res = await fetchFn(`${origin}/`, { headers: { Accept: "text/html" } });
    if (!res.ok) return fallback;
    const title = (await res.text()).match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
    const name = decodeEntities(title ?? "")
      .split(/\s+[|–—-]\s+/)[0]
      ?.replace(/\s+/g, " ")
      .trim();
    return name || fallback;
  } catch {
    return fallback;
  }
}

/** A Shopify store to save, or null when the site isn't Shopify. */
export async function detectShopifyStore(
  origin: string,
  fetchFn: FetchFn = fetch,
): Promise<Store | null> {
  const url = await detectShopify(origin, fetchFn);
  if (!url) return null;
  return { url, name: await shopifyStoreName(url, fetchFn), platform: "shopify" };
}
