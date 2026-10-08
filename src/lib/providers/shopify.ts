import { isSingleCard, matchesCard, parseCondition } from "../matching";
import { mapLimit } from "../storeFinder";
import type { FetchFn, Listing, WantedCard } from "../types";
import { cachedSearch, type StoreProvider } from "./types";

const MAGIC_TYPE = /magic|mtg/i;
const DEFAULT_VENDOR = "Magic: The Gathering";

export interface ShopifySuggestion {
  title: string;
  handle: string;
  type: string;
  vendor: string;
}

interface ShopifyVariant {
  title: string;
  price: number;
  available: boolean;
  option1?: string | null;
  option2?: string | null;
  option3?: string | null;
}

interface ShopifyProduct {
  title: string;
  vendor: string;
  handle: string;
  variants: ShopifyVariant[];
  options?: { name: string }[];
}

function hostname(origin: string): string {
  return new URL(origin).hostname;
}

/** Magic products from the storefront's predictive search for a quoted card name. */
export async function searchSuggestions(
  origin: string,
  name: string,
  fetchFn: FetchFn,
): Promise<ShopifySuggestion[]> {
  const q = encodeURIComponent(`"${name}"`);
  const res = await fetchFn(
    `${origin}/search/suggest.json?q=${q}&resources[type]=product&resources[limit]=10`,
    { headers: { Accept: "application/json" } },
  );
  if (!res.ok) throw new Error(`Search failed at ${hostname(origin)} (HTTP ${res.status})`);
  const data = (await res.json()) as {
    resources?: { results?: { products?: Partial<ShopifySuggestion>[] } };
  };
  return (data.resources?.results?.products ?? [])
    .filter((p) => p.handle && p.title && MAGIC_TYPE.test(p.type ?? ""))
    .map((p) => ({
      title: p.title ?? "",
      handle: p.handle ?? "",
      type: p.type ?? "",
      vendor: p.vendor ?? "",
    }));
}

async function getProduct(
  origin: string,
  handle: string,
  fetchFn: FetchFn,
): Promise<ShopifyProduct | null> {
  const res = await fetchFn(`${origin}/products/${encodeURIComponent(handle)}.js`, {
    headers: { Accept: "application/json" },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Product lookup failed at ${hostname(origin)} (HTTP ${res.status})`);
  return (await res.json()) as ShopifyProduct;
}

/** The set from the last `[...]` in the title, else the vendor when it names one. */
export function shopifySetName(title: string, vendor: string): string {
  const brackets = [...title.matchAll(/\[([^\]]+)\]/g)];
  const last = brackets[brackets.length - 1]?.[1];
  if (last) return last.trim();
  return vendor && vendor !== DEFAULT_VENDOR ? vendor : "";
}

function optionValue(
  product: ShopifyProduct,
  variant: ShopifyVariant,
  name: RegExp,
): string | null {
  const index = product.options?.findIndex((o) => name.test(o.name)) ?? -1;
  if (index < 0) return null;
  return [variant.option1, variant.option2, variant.option3][index] ?? null;
}

function variantListing(
  origin: string,
  card: string,
  product: ShopifyProduct,
  variant: ShopifyVariant,
): Listing {
  const conditionText = optionValue(product, variant, /condition/i) ?? variant.title;
  const printing = optionValue(product, variant, /printing|finish/i) ?? "";
  const language = optionValue(product, variant, /language/i);
  return {
    storeUrl: origin,
    cardName: card,
    productName: product.title,
    setName: shopifySetName(product.title, product.vendor),
    condition: parseCondition(conditionText),
    language: language ?? "English",
    foil: /foil/i.test(`${variant.title} ${printing}`),
    price: variant.price / 100,
    url: `${origin}/products/${product.handle}`,
  };
}

/** Shopify (BinderPOS) stores: predictive search, then each matching product's variants. */
export const shopifyProvider: StoreProvider = {
  platform: "shopify",
  async findListings(store, wanted: WantedCard[], fetchFn, { cardConcurrency, searchCache }) {
    const perCard = await mapLimit(wanted, cardConcurrency, async (card) => {
      const found = await cachedSearch(searchCache, `${store.url}|${card.name.toLowerCase()}`, () =>
        searchSuggestions(store.url, card.name, fetchFn),
      );
      const matches = found.filter(
        (p) =>
          matchesCard(p.title, card.name) &&
          isSingleCard(shopifySetName(p.title, p.vendor), p.title),
      );
      const products = await Promise.all(
        matches.map((m) => getProduct(store.url, m.handle, fetchFn)),
      );
      return products.flatMap((product) =>
        product
          ? product.variants
              .filter((v) => v.available)
              .map((v) => variantListing(store.url, card.name, product, v))
          : [],
      );
    });
    return perCard.flat();
  },
};
