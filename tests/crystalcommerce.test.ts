import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { findListings } from "../src/lib/check";
import { detectCrystalCommerceStore } from "../src/lib/crystalCommerceStore";
import { parseSearchPage, splitProductName } from "../src/lib/providers/crystalcommerce";
import { TtlCache, memoryStore } from "../src/lib/cache";
import type { FetchFn, Store, WantedCard } from "../src/lib/types";

vi.mock("webextension-polyfill", () => ({ default: {} }));

const ORIGIN = "https://store.battlegroundgames.com";
const page = (name: string) =>
  readFileSync(
    fileURLToPath(new URL(`./fixtures/crystalcommerce/${name}.html`, import.meta.url)),
    "utf8",
  );
const want = (name: string): WantedCard => ({ name, quantity: 1, sources: [] });
const store: Store = { url: ORIGIN, name: "Battleground Games", platform: "crystalcommerce" };

function site(pages: Record<string, string>): { fetchFn: FetchFn; urls: string[] } {
  const urls: string[] = [];
  const fetchFn = (async (input: RequestInfo | URL) => {
    urls.push(String(input));
    const body = pages[String(input)];
    return body === undefined ? new Response("", { status: 404 }) : new Response(body);
  }) as FetchFn;
  return { fetchFn, urls };
}

describe("Crystal Commerce provider", () => {
  it("lists the in-stock Goblin Bushwhacker rows once each", async () => {
    const { fetchFn, urls } = site({
      [`${ORIGIN}/products/search?q=Goblin%20Bushwhacker`]: page("search_goblin_bushwack"),
    });
    const listings = await findListings(store, [want("Goblin Bushwhacker")], fetchFn);
    expect(listings).toEqual([
      {
        storeUrl: ORIGIN,
        cardName: "Goblin Bushwhacker",
        productName: "Goblin Bushwhacker - Showcase",
        setName: "Special Guests",
        condition: "NM",
        language: "English",
        foil: false,
        price: 2.92,
        quantity: 1,
        url: `${ORIGIN}/catalog/magic_singles-special_guests/goblin_bushwhacker__showcase/643344`,
      },
    ]);
    expect(urls).toHaveLength(1);
  });

  it("parses every in-stock variant on the page, deduplicated, with quantities", () => {
    const variants = parseSearchPage(page("search_goblin_bushwack"), ORIGIN);
    expect(variants.map((v) => [v.name, v.condition, v.price, v.quantity])).toEqual([
      ["Goblin Bushwhacker - Showcase", "NM", 2.92, 1],
      ["Reckless Bushwhacker", "LP", 0.48, 2],
      ["Goblin Caves", "LP", 1.05, 8],
      ["Goblin Commando", "MP", 0.86, 2],
      ["Goblin Token", "NM", 0.5, 1],
      ["Frenzied Goblin", "NM", 0.5, 5],
    ]);
  });

  it("finds nothing, without throwing, when every product is out of stock", async () => {
    expect(parseSearchPage(page("search_path_to_exile"), ORIGIN)).toEqual([]);
    const { fetchFn } = site({
      [`${ORIGIN}/products/search?q=Path%20to%20Exile`]: page("search_path_to_exile"),
    });
    expect(await findListings(store, [want("Path to Exile")], fetchFn)).toEqual([]);
  });

  it("skips garbage and unreadable listings", () => {
    expect(parseSearchPage("", ORIGIN)).toEqual([]);
    expect(
      parseSearchPage('<li class="product"><form class="add-to-cart-form" data-vid="1">', ORIGIN),
    ).toEqual([]);
  });

  it("reads foil and other suffixes from the product name", () => {
    expect(splitProductName("Sol Ring - Foil")).toEqual({ base: "Sol Ring", foil: true });
    expect(splitProductName("Sol Ring - Foil - Borderless")).toEqual({
      base: "Sol Ring",
      foil: true,
    });
    expect(splitProductName("Sol Ring - Showcase")).toEqual({ base: "Sol Ring", foil: false });
    expect(splitProductName("Thrum of the Vestige - Lightning Bolt")).toEqual({
      base: "Thrum of the Vestige - Lightning Bolt",
      foil: false,
    });
  });

  it("marks foil products and maps conditions", async () => {
    const html = `<li class="product"><a href="/catalog/x/sol_ring/1" itemprop="url"></a>
      <h4 class="name">Sol Ring - Foil</h4>
      <form class="add-to-cart-form" data-vid="9" data-name="Sol Ring - Foil" data-price="$1,010.50" data-category="Set" data-variant="Heavy Play, Japanese">
      <select class="qty" name="qty" max="3"></select></form></li>`;
    const { fetchFn } = site({ [`${ORIGIN}/products/search?q=Sol%20Ring`]: html });
    const [listing] = await findListings(store, [want("Sol Ring")], fetchFn);
    expect(listing).toMatchObject({
      foil: true,
      condition: "HP",
      language: "Japanese",
      price: 1010.5,
      quantity: 3,
    });
  });

  it("uses the search cache and reports HTTP errors", async () => {
    const url = `${ORIGIN}/products/search?q=Goblin%20Bushwhacker`;
    const { fetchFn, urls } = site({ [url]: page("search_goblin_bushwack") });
    const searchCache = new TtlCache<unknown>(memoryStore(), "s:", 60_000);
    await findListings(store, [want("Goblin Bushwhacker")], fetchFn, { searchCache });
    await findListings(store, [want("Goblin Bushwhacker")], fetchFn, { searchCache });
    expect(urls).toHaveLength(1);
    await expect(findListings(store, [want("Sol Ring")], site({}).fetchFn)).rejects.toThrow(
      /HTTP 404/,
    );
  });
});

describe("adding a Crystal Commerce store by URL", () => {
  it("detects the platform from the page", async () => {
    const { fetchFn } = site({ [`${ORIGIN}/`]: page("search_goblin_bushwack") });
    expect(await detectCrystalCommerceStore(ORIGIN, fetchFn)).toMatchObject({
      url: ORIGIN,
      platform: "crystalcommerce",
    });
  });

  it("rejects other sites", async () => {
    const { fetchFn } = site({ [`${ORIGIN}/`]: "<html><title>Blog</title></html>" });
    expect(await detectCrystalCommerceStore(ORIGIN, fetchFn)).toBeNull();
    expect(await detectCrystalCommerceStore(ORIGIN, site({}).fetchFn)).toBeNull();
  });
});
