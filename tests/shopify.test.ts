import { describe, expect, it } from "vitest";
import { checkStores, findListings } from "../src/lib/check";
import { shopifySetName } from "../src/lib/providers/shopify";
import { detectShopifyStore, normalizeHttpsOrigin } from "../src/lib/shopifyStore";
import type { FetchFn, Store, WantedCard } from "../src/lib/types";
import { fixture } from "./helpers";

const want = (name: string): WantedCard => ({ name, quantity: 1, sources: [] });
const store = (host: string): Store => ({
  url: `https://${host}`,
  name: host,
  platform: "shopify",
});

interface Site {
  /** Suggest fixture by (lowercase) card name; anything else finds nothing. */
  suggest: Record<string, string>;
  /** Product fixture by handle. */
  products: Record<string, string>;
}

/** A fake Shopify storefront answering from fixtures; records every URL. */
function shop(site: Site): { fetchFn: FetchFn; urls: string[] } {
  const urls: string[] = [];
  const fetchFn = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    urls.push(url.href);
    if (url.pathname === "/search/suggest.json") {
      const q = (url.searchParams.get("q") ?? "").replace(/^"|"$/g, "").toLowerCase();
      const file = site.suggest[q] ?? "shopify/webway_suggest_sol_ring_empty.json";
      return new Response(JSON.stringify(fixture(file)));
    }
    const handle = url.pathname.match(/^\/products\/(.+)\.js$/)?.[1];
    const file = handle && site.products[handle];
    if (file) return new Response(JSON.stringify(fixture(file)));
    return new Response("", { status: 404 });
  }) as FetchFn;
  return { fetchFn, urls };
}

const tabletop: Site = {
  suggest: {
    cloudshift: "shopify/tabletop_suggest_cloudshift.json",
    "sol ring": "shopify/tabletop_suggest_sol_ring.json",
  },
  products: {
    "cloudshift-avacyn-restored": "shopify/tabletop_product_cloudshift_avr.json",
    "sol-ring-0912-rainbow-foil-secret-lair-drop-series":
      "shopify/tabletop_product_sol_ring_foil.json",
  },
};

describe("Shopify provider", () => {
  it("lists in-stock variants with price from cents, condition and a quoted search", async () => {
    const { fetchFn, urls } = shop(tabletop);
    const listings = await findListings(store("tabletop.test"), [want("Cloudshift")], fetchFn);
    expect(listings.map((l) => [l.condition, l.price, l.foil, l.setName, l.language])).toEqual([
      ["LP", 1.8, false, "Avacyn Restored", "English"],
      ["NM", 2.1, false, "Avacyn Restored", "English"],
    ]);
    expect(listings[0]?.quantity).toBeUndefined();
    expect(listings[0]?.url).toBe("https://tabletop.test/products/cloudshift-avacyn-restored");
    const search = new URL(urls[0] ?? "");
    expect(search.searchParams.get("q")).toBe('"Cloudshift"');
    expect(search.searchParams.get("resources[type]")).toBe("product");
    // The Jumpstart printing isn't in the product fixtures, so its 404 counts as no listing.
    expect(urls.some((u) => u.includes("cloudshift-jumpstart.js"))).toBe(true);
  });

  it("reads foil, set and extra (...) tags from a single-option title", async () => {
    const { fetchFn } = shop(tabletop);
    const listings = await findListings(store("tabletop.test"), [want("Sol Ring")], fetchFn);
    expect(listings).toHaveLength(1);
    expect(listings[0]).toMatchObject({
      cardName: "Sol Ring",
      productName: "Sol Ring (0912) (Rainbow Foil) [Secret Lair Drop Series]",
      setName: "Secret Lair Drop Series",
      condition: "NM",
      foil: true,
      price: 14.4,
    });
  });

  it("reads a 3-axis variant title: Condition / Language / Printing", async () => {
    const { fetchFn } = shop({
      suggest: { "sol ring": "shopify/pandemonium_suggest_sol_ring.json" },
      products: {
        "sol-ring-revised-edition-1571": "shopify/pandemonium_product_sol_ring_3ed.json",
      },
    });
    const listings = await findListings(store("pandemonium.test"), [want("Sol Ring")], fetchFn);
    expect(listings.map((l) => [l.condition, l.price, l.language, l.foil, l.setName])).toEqual([
      ["MP", 29.74, "English", false, "3ED - N/A"],
      ["LP", 33.46, "English", false, "3ED - N/A"],
    ]);
  });

  it("finds a single in-stock NM at Dynamic", async () => {
    const { fetchFn } = shop({
      suggest: { "sol ring": "shopify/tabletop_suggest_sol_ring.json" },
      products: {
        "sol-ring-0912-rainbow-foil-secret-lair-drop-series":
          "shopify/dynamic_product_sol_ring.json",
      },
    });
    const listings = await findListings(store("dynamic.test"), [want("Sol Ring")], fetchFn);
    expect(listings.map((l) => [l.condition, l.price])).toEqual([["NM", 2]]);
  });

  it("treats an empty search as not found", async () => {
    const { fetchFn, urls } = shop({ suggest: {}, products: {} });
    expect(await findListings(store("webway.test"), [want("Sol Ring")], fetchFn)).toEqual([]);
    expect(urls).toHaveLength(1);
  });

  it("ignores other games in a noisy search", async () => {
    const { fetchFn } = shop({
      suggest: { "sol ring": "shopify/webway_suggest_sol_ring_unquoted_noise.json" },
      products: {},
    });
    const listings = await findListings(store("webway.test"), [want("Sol Ring")], fetchFn);
    expect(listings).toEqual([]);
  });

  it("raises HTTP errors from the search", async () => {
    const fetchFn = (async () => new Response("", { status: 503 })) as FetchFn;
    await expect(findListings(store("x.test"), [want("Sol Ring")], fetchFn)).rejects.toThrow(
      "HTTP 503",
    );
  });

  it("takes the set from the last [...] or a non-default vendor", () => {
    expect(shopifySetName("Sol Ring (1) [A] [B]", "Magic: The Gathering")).toBe("B");
    expect(shopifySetName("Sol Ring", "Revised Edition")).toBe("Revised Edition");
    expect(shopifySetName("Sol Ring", "Magic: The Gathering")).toBe("");
  });
});

describe("a check across platforms", () => {
  it("covers a TCGplayer Pro store without `platform` and a Shopify store together", async () => {
    const { fetchFn: shopFetch } = shop(tabletop);
    const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith("https://dmcomics.tcgplayerpro.com/api/catalog/search")) {
        return new Response(JSON.stringify(fixture("tcgplayerpro/search_no_results.json")));
      }
      return shopFetch(input, init);
    }) as FetchFn;
    const stores: Store[] = [
      { url: "https://dmcomics.tcgplayerpro.com", name: "DMC" },
      store("tabletop.test"),
    ];
    const results = await checkStores(stores, [want("Cloudshift")], () => {}, { fetchFn });
    const byUrl = Object.fromEntries(results.map((r) => [r.store.url, r]));
    expect(byUrl["https://dmcomics.tcgplayerpro.com"]?.found).toEqual([]);
    expect(byUrl["https://dmcomics.tcgplayerpro.com"]?.error).toBeUndefined();
    expect(byUrl["https://tabletop.test"]?.found).toEqual(["Cloudshift"]);
  });
});

describe("adding a Shopify store by URL", () => {
  const html = "<html><head><title>Tabletop Gaming Center &amp; Cafe | Home</title></head></html>";
  const site = (routes: Record<string, unknown>): FetchFn =>
    (async (input: RequestInfo | URL) => {
      const body = routes[String(input)];
      if (body === undefined) return new Response("", { status: 404 });
      return new Response(typeof body === "string" ? body : JSON.stringify(body));
    }) as FetchFn;

  it("accepts only https origins", () => {
    expect(normalizeHttpsOrigin(" https://www.tabletopgamingcenter.com/pages/x ")).toBe(
      "https://www.tabletopgamingcenter.com",
    );
    expect(normalizeHttpsOrigin("http://example.com")).toBeNull();
    expect(normalizeHttpsOrigin("example.com")).toBeNull();
  });

  it("detects Shopify from /products.json and names it from the page title", async () => {
    const origin = "https://www.tabletopgamingcenter.com";
    const found = await detectShopifyStore(
      origin,
      site({ [`${origin}/products.json?limit=1`]: { products: [] }, [`${origin}/`]: html }),
    );
    expect(found).toEqual({
      url: origin,
      name: "Tabletop Gaming Center & Cafe",
      platform: "shopify",
    });
  });

  it("falls back to /search/suggest.json, and to the domain without a title", async () => {
    const origin = "https://shop.test";
    const found = await detectShopifyStore(
      origin,
      site({ [`${origin}/search/suggest.json?q=a&resources[type]=product`]: { resources: {} } }),
    );
    expect(found?.name).toBe("shop.test");
  });

  it("rejects other sites", async () => {
    expect(await detectShopifyStore("https://blog.test", site({}))).toBeNull();
    expect(
      await detectShopifyStore(
        "https://blog.test",
        site({ "https://blog.test/products.json?limit=1": "<html>" }),
      ),
    ).toBeNull();
  });
});
