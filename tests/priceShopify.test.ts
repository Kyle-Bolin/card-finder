import { describe, expect, it, vi } from "vitest";
vi.mock("webextension-polyfill", () => ({ default: {} }));
import { memoryStore } from "../src/lib/cache";
import { loadBaskets, scoreStores, type StoreBasket } from "../src/lib/priceRanking";
import type { FetchFn, Store } from "../src/lib/types";
import { fixture } from "./helpers";

const basket = [
  { name: "Sol Ring", why: "" },
  { name: "Cloudshift", why: "" },
];
const shopify = (host: string): Store => ({
  url: `https://${host}`,
  name: host,
  platform: "shopify",
});

/** A fake Shopify storefront answering from recorded fixtures. */
function shop(suggest: Record<string, string>, products: Record<string, string>): FetchFn {
  return (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    if (url.pathname === "/search/suggest.json") {
      const q = (url.searchParams.get("q") ?? "").replace(/^"|"$/g, "").toLowerCase();
      return new Response(
        JSON.stringify(fixture(suggest[q] ?? "shopify/webway_suggest_sol_ring_empty.json")),
      );
    }
    const handle = url.pathname.match(/^\/products\/(.+)\.js$/)?.[1];
    const file = handle && products[handle];
    if (file) return new Response(JSON.stringify(fixture(file)));
    return new Response("", { status: 404 });
  }) as FetchFn;
}

describe("price ranking with Shopify stores", () => {
  it("prices Shopify stores from recorded fixtures and ranks them beside a TCGplayer Pro store", async () => {
    const pandemonium = shopify("pandemonium.test");
    const tabletop = shopify("tabletop.test");
    const fetches: Record<string, FetchFn> = {
      "pandemonium.test": shop(
        { "sol ring": "shopify/pandemonium_suggest_sol_ring.json" },
        { "sol-ring-revised-edition-1571": "shopify/pandemonium_product_sol_ring_3ed.json" },
      ),
      "tabletop.test": shop(
        { cloudshift: "shopify/tabletop_suggest_cloudshift.json" },
        { "cloudshift-avacyn-restored": "shopify/tabletop_product_cloudshift_avr.json" },
      ),
    };
    const fetchFn = ((input: RequestInfo | URL, init?: RequestInit) =>
      fetches[new URL(String(input)).hostname]!(input, init)) as FetchFn;

    const loaded = await loadBaskets([pandemonium, tabletop], {
      store: memoryStore(),
      fetchFn,
      basket,
    });
    const byStore = (s: Store) => loaded.find((b) => b.store === s);
    // Cheapest NM/LP English non-foil copy: Pandemonium's LP (MP is skipped), Tabletop's LP.
    expect(byStore(pandemonium)?.prices).toEqual({ "Sol Ring": 33.46 });
    expect(byStore(tabletop)?.prices).toEqual({ Cloudshift: 1.8 });

    const tcg: StoreBasket = {
      store: { url: "https://x.tcgplayerpro.com", name: "x" },
      at: 0,
      prices: { "Sol Ring": 30, Cloudshift: 2 },
    };
    const scores = scoreStores([...loaded, tcg], undefined, basket, 1);
    const ratio = (s: Store) => scores.find((x) => x.store === s)?.ratio;
    // Two stores stock each card, so the median is their mean and the cheaper one is below it.
    expect(ratio(pandemonium)).toBeCloseTo(33.46 / ((33.46 + 30) / 2));
    expect(ratio(tabletop)).toBeCloseTo(1.8 / 1.9);
    expect(ratio(tcg.store)).toBeCloseTo(Math.sqrt((30 / 31.73) * (2 / 1.9)));
  });
});
