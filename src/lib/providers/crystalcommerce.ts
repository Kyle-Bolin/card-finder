import { decodeEntities } from "../shopifyStore";
import { isSingleCard, matchesCard } from "../matching";
import { mapLimit } from "../storeFinder";
import type { Condition, FetchFn, Listing, WantedCard } from "../types";
import { cachedSearch, type StoreProvider } from "./types";

const CONDITIONS: [RegExp, Condition][] = [
  [/^(nm|near mint)/i, "NM"],
  [/^(lp|light(ly)? play)/i, "LP"],
  [/^(mp|moderate(ly)? play)/i, "MP"],
  [/^(hp|heav(y|ily) play)/i, "HP"],
  [/^(dmg|damaged)/i, "DMG"],
];

const NAME_SUFFIXES = /^(foil|showcase|borderless|extended art|full art|etched|foil etched)$/i;

/** The product name without " - Foil", " - Showcase" and similar suffixes, and whether it was foil. */
export function splitProductName(name: string): { base: string; foil: boolean } {
  let base = name.trim();
  let foil = false;
  for (;;) {
    const match = base.match(/^(.*\S)\s+-\s+([^-]+)$/);
    if (!match || !NAME_SUFFIXES.test(match[2]?.trim() ?? "")) break;
    if (/foil/i.test(match[2] ?? "")) foil = true;
    base = match[1] ?? base;
  }
  return { base, foil };
}

function attributes(tag: string): Map<string, string> {
  const attrs = new Map<string, string>();
  for (const m of tag.matchAll(/([\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
    const key = (m[1] ?? "").toLowerCase();
    if (!attrs.has(key)) attrs.set(key, decodeEntities(m[2] ?? m[3] ?? ""));
  }
  return attrs;
}

const text = (html: string) =>
  decodeEntities(html.replace(/<[^>]*>/g, ""))
    .replace(/\s+/g, " ")
    .trim();

export interface CrystalCommerceVariant {
  name: string;
  setName: string;
  condition: Condition | string;
  language: string;
  price: number;
  quantity?: number;
  url: string;
}

/**
 * In-stock variants from a search results page. Each is anchored on its
 * `add-to-cart-form` (out-of-stock rows have an empty `data-vid`) and appears up to three
 * times per product (grid, list, mobile), so they are deduplicated by `data-vid`.
 * Anything unrecognized is skipped.
 */
export function parseSearchPage(html: string, origin: string): CrystalCommerceVariant[] {
  const variants: CrystalCommerceVariant[] = [];
  const seen = new Set<string>();
  for (const product of html.split(/<li\b[^>]*\bclass=["']product["']/i).slice(1)) {
    try {
      const name = text(
        product.match(/<h4\b[^>]*\bclass=["'][^"']*\bname\b[^>]*>([\s\S]*?)<\/h4>/i)?.[1] ?? "",
      );
      const href = product.match(/<a\b[^>]*\bitemprop=["']url["'][^>]*>/i)?.[0];
      const path = href ? attributes(href).get("href") : undefined;
      if (!name || !path) continue;
      const url = new URL(path, origin).href;
      for (const form of product.matchAll(/<form\b[^>]*\badd-to-cart-form[^>]*>/gi)) {
        const attrs = attributes(form[0]);
        const vid = attrs.get("data-vid");
        if (!vid || seen.has(vid)) continue;
        const price = Number((attrs.get("data-price") ?? "").replace(/[^0-9.]/g, ""));
        const [conditionText = "", language = "English"] = (attrs.get("data-variant") ?? "")
          .split(",")
          .map((part) => part.trim());
        if (!Number.isFinite(price) || price <= 0 || !conditionText) continue;
        const after = product.slice(
          (form.index ?? 0) + form[0].length,
          (form.index ?? 0) + form[0].length + 1500,
        );
        const max = Number(
          after.match(/<select\b[^>]*\bclass=["']qty["'][^>]*\bmax=["'](\d+)["']/i)?.[1],
        );
        seen.add(vid);
        variants.push({
          name: attrs.get("data-name") || name,
          setName: attrs.get("data-category") ?? "",
          condition:
            CONDITIONS.find(([pattern]) => pattern.test(conditionText))?.[1] ?? conditionText,
          language: language || "English",
          price,
          quantity: max > 0 ? max : undefined,
          url,
        });
      }
    } catch {
      // Skip a listing we can't read.
    }
  }
  return variants;
}

async function search(
  origin: string,
  name: string,
  fetchFn: FetchFn,
): Promise<CrystalCommerceVariant[]> {
  const res = await fetchFn(`${origin}/products/search?q=${encodeURIComponent(name)}`, {
    headers: { Accept: "text/html" },
  });
  if (!res.ok) {
    throw new Error(`Search failed at ${new URL(origin).hostname} (HTTP ${res.status})`);
  }
  return parseSearchPage(await res.text(), origin);
}

/**
 * Crystal Commerce stores: one search per wanted card, first page only, read from the
 * rows' own stock. The stores' robots.txt disallows crawlers, so this only runs from the
 * user's browser when they press Check.
 */
export const crystalCommerceProvider: StoreProvider = {
  platform: "crystalcommerce",
  async findListings(store, wanted: WantedCard[], fetchFn, { cardConcurrency, searchCache }) {
    const perCard = await mapLimit(wanted, cardConcurrency, async (card) => {
      const found = await cachedSearch(searchCache, `${store.url}|${card.name.toLowerCase()}`, () =>
        search(store.url, card.name, fetchFn),
      );
      return found.flatMap((v): Listing[] => {
        const { base, foil } = splitProductName(v.name);
        if (!matchesCard(base, card.name) || !isSingleCard(v.setName, v.name)) return [];
        return [
          {
            storeUrl: store.url,
            cardName: card.name,
            productName: v.name,
            setName: v.setName,
            condition: v.condition,
            language: v.language,
            foil,
            price: v.price,
            quantity: v.quantity,
            url: v.url,
          },
        ];
      });
    });
    return perCard.flat();
  },
};
