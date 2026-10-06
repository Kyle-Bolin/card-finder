import { describe, expect, it } from "vitest";
import { checkStores, findListings, parseCardList } from "../src/lib/check";
import {
  baseProductName,
  isSingleCard,
  matchesCard,
  normalizeName,
  parseCondition,
} from "../src/lib/matching";
import { extractWanted } from "../src/lib/moxfield";
import { productUrl } from "../src/lib/tcgplayerpro";
import type { FetchFn, Store } from "../src/lib/types";
import { fixture } from "./helpers";

const DMC: Store = { url: "https://dmcomics.tcgplayerpro.com", name: "Double Midnight Comics" };

/** Fake storefront: search answers from `searches` by query; SKUs from the fixture. */
function storefront(searches: Record<string, unknown>, failSearch = false): FetchFn {
  const skus = fixture<{ productId: number }[]>("tcgplayerpro/skus_lightning_bolt.json");
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/api/catalog/search")) {
      if (failSearch) return new Response("", { status: 503 });
      const { query } = JSON.parse(String(init?.body));
      return new Response(
        JSON.stringify(searches[query] ?? fixture("tcgplayerpro/search_no_results.json")),
      );
    }
    if (url.includes("/api/inventory/skus")) {
      const ids = new URL(url).searchParams.get("productIds")?.split(",").map(Number) ?? [];
      return new Response(JSON.stringify(skus.filter((p) => ids.includes(p.productId))));
    }
    return new Response("", { status: 404 });
  }) as FetchFn;
}

describe("matching", () => {
  it("normalizes names", () => {
    expect(normalizeName("Lim-Dûl’s Vault")).toBe("lim-dul's vault");
    expect(normalizeName("Æther Vial")).toBe("aether vial");
    expect(normalizeName("  Sol   Ring ")).toBe("sol ring");
  });

  it("strips variant decorations from product names", () => {
    expect(baseProductName("Lightning Bolt (Borderless)")).toBe("Lightning Bolt");
    expect(baseProductName("Sol Ring (1604)")).toBe("Sol Ring");
    expect(baseProductName("Sol Ring [Foil Etched]")).toBe("Sol Ring");
    expect(baseProductName("Sword of Hearth and Home (Showcase) - Foil")).toBe(
      "Sword of Hearth and Home",
    );
  });

  it.each([
    ["Lightning Bolt (084)", "Lightning Bolt", true],
    ["Lightning Bolt (Borderless)", "lightning bolt", true],
    ["Thrum of the Vestige - Lightning Bolt (Showcase)", "Lightning Bolt", false],
    ["Delver of Secrets", "Delver of Secrets // Insectile Aberration", true],
    ["Delver of Secrets // Insectile Aberration", "Delver of Secrets", true],
    ["Aether Vial", "Æther Vial", true],
    ["Sol Ring Token", "Sol Ring", false],
  ])("%s vs %s → %s", (product, wanted, expected) => {
    expect(matchesCard(product, wanted)).toBe(expected);
  });

  it("excludes non-singles", () => {
    expect(isSingleCard("Outlaws of Thunder Junction", "Arid Archway")).toBe(true);
    expect(isSingleCard("Outlaws of Thunder Junction Art Series", "Arid Archway")).toBe(false);
    expect(isSingleCard("Modern Horizons 3 Tokens", "Eldrazi Spawn")).toBe(false);
  });

  it("parses condition strings", () => {
    expect(parseCondition("Lightly Played Foil")).toBe("LP");
    expect(parseCondition("Lightly Played - Japanese")).toBe("LP");
    expect(parseCondition("Near Mint")).toBe("NM");
    expect(parseCondition("Damaged")).toBe("DMG");
  });
});

describe("findListings", () => {
  it("returns in-stock exact matches with links, cheapest first", async () => {
    const fetchFn = storefront({
      "Lightning Bolt": fixture("tcgplayerpro/search_lightning_bolt.json"),
    });
    const listings = await findListings(
      DMC,
      [{ name: "Lightning Bolt", quantity: 1, sources: [] }],
      fetchFn,
    );
    expect(listings.length).toBeGreaterThan(5);
    expect(listings.every((l) => l.cardName === "Lightning Bolt")).toBe(true);
    // "Thrum of the Vestige - Lightning Bolt" is in the search results but isn't the card.
    expect(listings.some((l) => l.productName.startsWith("Thrum"))).toBe(false);
    expect(listings.map((l) => l.price)).toEqual(
      [...listings.map((l) => l.price)].sort((a, b) => a - b),
    );
    expect(listings[0]).toMatchObject({
      storeUrl: DMC.url,
      condition: expect.stringMatching(/^(NM|LP|MP|HP|DMG)$/),
    });
    expect(listings.find((l) => l.productName === "Lightning Bolt (084)")?.url).toBe(
      "https://dmcomics.tcgplayerpro.com/catalog/magic/secret-lair-drop-series/lightning-bolt-084/214901",
    );
  });

  it("returns nothing without an inventory lookup when no product matches", async () => {
    let skuCalls = 0;
    const base = storefront({});
    const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes("/skus")) skuCalls++;
      return base(input, init);
    }) as FetchFn;
    expect(
      await findListings(
        DMC,
        [{ name: "Ranger-Captain of Eos", quantity: 1, sources: [] }],
        fetchFn,
      ),
    ).toEqual([]);
    expect(skuCalls).toBe(0);
  });
});

describe("checkStores", () => {
  it("reports each store, isolating failures", async () => {
    const good = storefront({
      "Lightning Bolt": fixture("tcgplayerpro/search_lightning_bolt.json"),
    });
    const bad = storefront({}, true);
    const fetchFn = ((input: RequestInfo | URL, init?: RequestInit) =>
      String(input).startsWith("https://broken.")
        ? bad(input, init)
        : good(input, init)) as FetchFn;
    const reported: string[] = [];
    const results = await checkStores(
      [DMC, { url: "https://broken.tcgplayerpro.com", name: "Broken" }],
      [{ name: "Lightning Bolt", quantity: 1, sources: [] }],
      (r) => reported.push(r.store.name),
      { fetchFn },
    );
    expect(reported.sort()).toEqual(["Broken", "Double Midnight Comics"]);
    expect(results[0]?.found).toEqual(["Lightning Bolt"]);
    expect(results[1]).toMatchObject({
      listings: [],
      found: [],
      error: expect.stringContaining("HTTP 503"),
    });
  });
});

describe("parseCardList", () => {
  it("handles quantities, set codes, tags and headers", () => {
    const text = `1 Arid Archway
2x Cloudshift
Sol Ring (CMR) 472 *F*
Phelia, Exuberant Shepherd #unowned
// comment
SIDEBOARD:
1 cloudshift

The Mind Stone`;
    expect(parseCardList(text)).toEqual([
      { name: "Arid Archway", quantity: 1, sources: [] },
      { name: "Cloudshift", quantity: 2, sources: [] },
      { name: "Sol Ring", quantity: 1, sources: [] },
      { name: "Phelia, Exuberant Shepherd", quantity: 1, sources: [] },
      { name: "The Mind Stone", quantity: 1, sources: [] },
    ]);
  });
});

describe("extractWanted", () => {
  it("reads tagged cards from every board of a v3 deck", () => {
    const deck = {
      name: "Rocco",
      boards: {
        mainboard: {
          cards: {
            a: { quantity: 1, card: { name: "Sol Ring" } },
            b: { quantity: 1, card: { name: "Cloudshift" } },
          },
        },
        maybeboard: { cards: { c: { quantity: 2, card: { name: "Pearl Medallion" } } } },
      },
      authorTags: {
        Cloudshift: ["Blink", "Unowned"],
        "Pearl Medallion": ["unowned"],
        "Sol Ring": ["ramp"],
      },
    };
    expect(extractWanted(deck, "unowned")).toEqual([
      { name: "Cloudshift", quantity: 1, sources: ["Rocco (mainboard)"] },
      { name: "Pearl Medallion", quantity: 2, sources: ["Rocco (considering)"] },
    ]);
  });

  it("supports the older v2 layout", () => {
    const deck = {
      name: "Old",
      mainboard: { "Arid Archway": { quantity: 1, card: { name: "Arid Archway" } } },
      maybeboard: { Cloudshift: { quantity: 1 } },
      authorTags: { "Arid Archway": ["unowned"], Cloudshift: ["unowned"] },
    };
    expect(extractWanted(deck, "UNOWNED").map((w) => w.name)).toEqual([
      "Arid Archway",
      "Cloudshift",
    ]);
  });

  it("returns nothing for unexpected input", () => {
    expect(extractWanted(null, "unowned")).toEqual([]);
    expect(extractWanted({ boards: {} }, "unowned")).toEqual([]);
  });
});

describe("productUrl", () => {
  it("builds the storefront route", () => {
    expect(
      productUrl(DMC.url, {
        id: 555447,
        name: "Sol Ring (1604)",
        setName: "Secret Lair Drop Series",
        productLineUrlName: "magic",
        setUrlName: "secret-lair-drop-series",
        productUrlName: "sol-ring-1604",
      }),
    ).toBe(
      "https://dmcomics.tcgplayerpro.com/catalog/magic/secret-lair-drop-series/sol-ring-1604/555447",
    );
  });
});
