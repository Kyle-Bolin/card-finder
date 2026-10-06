import { describe, expect, it } from "vitest";
import { checkStores } from "../src/lib/check";
import {
  applyFilters,
  DEFAULT_FILTERS,
  describeFilters,
  normalizeFilters,
} from "../src/lib/filters";
import type { FetchFn, Listing, Store } from "../src/lib/types";
import { fixture } from "./helpers";

function listing(over: Partial<Listing> = {}): Listing {
  return {
    storeUrl: "https://a.tcgplayerpro.com",
    cardName: "Lightning Bolt",
    productName: "Lightning Bolt",
    setName: "Set",
    condition: "NM",
    language: "English",
    foil: false,
    price: 5,
    quantity: 1,
    url: "https://a.tcgplayerpro.com/x",
    ...over,
  };
}

const f = (over: Partial<typeof DEFAULT_FILTERS>) => ({ ...DEFAULT_FILTERS, ...over });

describe("applyFilters", () => {
  const all = [
    listing({ price: 5 }),
    listing({ price: 25, condition: "LP" }),
    listing({ condition: "HP", foil: true }),
    listing({ language: "Japanese" }),
    listing({ condition: "Weird" }),
  ];

  it("passes everything with default filters", () => {
    expect(applyFilters(all, DEFAULT_FILTERS)).toEqual(all);
  });

  it("filters by max price (inclusive)", () => {
    expect(applyFilters(all, f({ maxPrice: 5 }))).toHaveLength(4);
    expect(applyFilters(all, f({ maxPrice: 4.99 }))).toHaveLength(0);
  });

  it("filters by condition", () => {
    const out = applyFilters(all, f({ conditions: ["NM", "LP"] }));
    expect(out.map((l) => l.condition)).toEqual(["NM", "LP", "NM"]);
  });

  it("filters by foil", () => {
    expect(applyFilters(all, f({ foil: "foil" }))).toHaveLength(1);
    expect(applyFilters(all, f({ foil: "nonfoil" }))).toHaveLength(4);
  });

  it("filters by language", () => {
    const out = applyFilters(all, f({ englishOnly: true }));
    expect(out.some((l) => l.language === "Japanese")).toBe(false);
    expect(out).toHaveLength(4);
  });

  it("combines filters", () => {
    const out = applyFilters(
      all,
      f({ maxPrice: 10, conditions: ["NM"], foil: "nonfoil", englishOnly: true }),
    );
    expect(out).toEqual([all[0]]);
  });

  it("describes only active filters", () => {
    expect(describeFilters(DEFAULT_FILTERS)).toEqual([]);
    expect(describeFilters(f({ conditions: ["NM", "LP"], maxPrice: 20, foil: "nonfoil" }))).toEqual(
      ["NM/LP", "≤ $20", "non-foil"],
    );
  });
});

describe("normalizeFilters", () => {
  it("falls back to defaults", () => {
    expect(normalizeFilters(undefined)).toEqual(DEFAULT_FILTERS);
    expect(
      normalizeFilters({ maxPrice: -1, foil: "x" as never, conditions: "NM" as never }),
    ).toEqual(DEFAULT_FILTERS);
  });
});

describe("checkStores with filters", () => {
  const store: Store = { url: "https://dmcomics.tcgplayerpro.com", name: "DMC" };
  const skus = fixture<{ productId: number }[]>("tcgplayerpro/skus_lightning_bolt.json");
  const fetchFn = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("/api/catalog/search")) {
      return new Response(JSON.stringify(fixture("tcgplayerpro/search_lightning_bolt.json")));
    }
    if (url.includes("/api/inventory/skus")) return new Response(JSON.stringify(skus));
    return new Response("", { status: 404 });
  }) as FetchFn;
  const wanted = [{ name: "Lightning Bolt", quantity: 1, sources: [] }];

  it("drops a card from found when every listing is filtered out", async () => {
    const [plain] = await checkStores([store], wanted, () => {}, { fetchFn });
    expect(plain?.found).toEqual(["Lightning Bolt"]);
    const [filtered] = await checkStores([store], wanted, () => {}, {
      fetchFn,
      filters: f({ maxPrice: 0 }),
    });
    expect(filtered?.listings).toEqual([]);
    expect(filtered?.found).toEqual([]);
  });
});
