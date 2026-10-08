import { beforeEach, describe, expect, it, vi } from "vitest";
import { memoryStore } from "../src/lib/cache";
import type { Listing, Store } from "../src/lib/types";

vi.mock("webextension-polyfill", () => ({ default: {} }));
vi.mock("../src/lib/check", () => ({ findListings: vi.fn() }));
import { findListings } from "../src/lib/check";
import { PRICE_BASKET } from "../src/lib/priceBasket";
import {
  areaMedians,
  BASKET_TTL_MS,
  cheapestBasketPrice,
  describeRatio,
  loadBaskets,
  scoreStores,
  sortScores,
  type StoreBasket,
} from "../src/lib/priceRanking";

const store = (name: string, extra: Partial<Store> = {}): Store => ({
  url: `https://${name}.tcgplayerpro.com`,
  name,
  ...extra,
});
const names = ["A", "B", "C", "D", "E", "F"].map((n) => ({ name: n }));
const basket = (s: Store, prices: Record<string, number>): StoreBasket => ({
  store: s,
  at: 0,
  prices,
});
const listing = (over: Partial<Listing>): Listing => ({
  storeUrl: "https://x.tcgplayerpro.com",
  cardName: "Sol Ring",
  productName: "Sol Ring",
  setName: "Commander Masters",
  condition: "NM",
  language: "English",
  foil: false,
  price: 1,
  url: "",
  ...over,
});
const all = (price: number) => Object.fromEntries(names.map((n) => [n.name, price]));

describe("the basket", () => {
  it("has about 25 distinct cards, each with a reason", () => {
    expect(PRICE_BASKET.length).toBeGreaterThanOrEqual(20);
    expect(new Set(PRICE_BASKET.map((c) => c.name)).size).toBe(PRICE_BASKET.length);
    expect(PRICE_BASKET.every((c) => c.why.length > 0)).toBe(true);
  });
});

describe("cheapestBasketPrice", () => {
  it("takes the cheapest in-stock non-foil English NM or LP copy", () => {
    const listings = [
      listing({ price: 3 }),
      listing({ price: 2, condition: "LP" }),
      listing({ price: 0.5, foil: true }),
      listing({ price: 0.6, language: "Japanese" }),
      listing({ price: 0.7, condition: "MP" }),
      listing({ price: 0.1, cardName: "Other" }),
    ];
    expect(cheapestBasketPrice(listings, "Sol Ring")).toBe(2);
    expect(cheapestBasketPrice(listings, "Missing")).toBeNull();
  });
});

describe("scoring", () => {
  it("uses the median across stores that stock each card", () => {
    const medians = areaMedians([
      { prices: { A: 1, B: 10 } },
      { prices: { A: 3 } },
      { prices: { A: 2, B: 20 } },
    ]);
    expect(medians).toEqual({ A: 2, B: 15 });
  });

  it("scores by geometric mean of price / median", () => {
    const cheap = store("cheap");
    const mid = store("mid");
    const dear = store("dear");
    const scores = scoreStores(
      [basket(cheap, all(5)), basket(mid, all(10)), basket(dear, all(20))],
      undefined,
      names,
      5,
    );
    const ratio = (s: Store) => scores.find((x) => x.store === s)?.ratio;
    expect(ratio(cheap)).toBeCloseTo(0.5);
    expect(ratio(mid)).toBeCloseTo(1);
    expect(ratio(dear)).toBeCloseTo(2);
    // Geometric, not arithmetic: one card at 0.5x and one at 2x average out to 1.
    const mixed = scoreStores(
      [
        basket(cheap, { A: 5, B: 20 }),
        basket(mid, { A: 10, B: 10 }),
        basket(dear, { A: 20, B: 5 }),
      ],
      undefined,
      names.slice(0, 2),
      1,
    );
    expect(mixed.find((x) => x.store === cheap)?.ratio).toBeCloseTo(1);
  });

  it("lists a store below the coverage threshold as not enough data", () => {
    const full = store("full");
    const thin = store("thin");
    const empty = store("empty");
    const scores = scoreStores(
      [basket(full, all(10)), basket(thin, { A: 1, B: 1, C: 1, D: 1 }), basket(empty, {})],
      undefined,
      names,
      5,
    );
    const by = (s: Store) => scores.find((x) => x.store === s);
    expect(by(full)?.ratio).not.toBeNull();
    expect(by(thin)?.ratio).toBeNull();
    expect(by(thin)?.coverage).toBe(4);
    expect(by(empty)?.ratio).toBeNull();
    expect(by(empty)?.coverage).toBe(0);
  });

  it("only totals stores that have every basket card", () => {
    const full = store("full");
    const part = store("part");
    const scores = scoreStores(
      [basket(full, all(2)), basket(part, { A: 1, B: 1, C: 1, D: 1, E: 1 })],
      undefined,
      names,
      5,
    );
    expect(scores.find((s) => s.store === full)?.total).toBe(12);
    expect(scores.find((s) => s.store === part)?.total).toBeNull();
  });

  it("leaves failed stores out", () => {
    const ok = store("ok");
    const bad = store("bad");
    const scores = scoreStores(
      [basket(ok, all(1)), { ...basket(bad, {}), error: "down" }],
      undefined,
      names,
      5,
    );
    expect(scores.map((s) => s.store.name)).toEqual(["ok"]);
  });

  it("breaks ties by coverage, then distance, and puts not-enough-data last", () => {
    const home = { latitude: 42.8, longitude: -71.5 };
    const near = store("near", { latitude: 42.81, longitude: -71.5 });
    const far = store("far", { latitude: 43.5, longitude: -71.5 });
    const thin = store("thin", { latitude: 42.8, longitude: -71.5 });
    const scores = scoreStores(
      [basket(far, all(10)), basket(near, all(10)), basket(thin, { A: 1 })],
      home,
      names,
      5,
    );
    expect(sortScores(scores, "cheapest").map((s) => s.store.name)).toEqual([
      "near",
      "far",
      "thin",
    ]);
    expect(sortScores(scores, "closest").map((s) => s.store.name)).toEqual(["near", "far", "thin"]);
    expect(sortScores(scores, "coverage").map((s) => s.store.name)).toEqual([
      "near",
      "far",
      "thin",
    ]);
  });

  it("describes the ratio", () => {
    expect(describeRatio(0.88)).toBe("12% below area median");
    expect(describeRatio(1.08)).toBe("8% above area median");
    expect(describeRatio(1)).toBe("at area median");
  });
});

describe("loadBaskets caching", () => {
  const stores = [store("one"), store("two")];
  let clock = 1_000_000;
  beforeEach(() => {
    clock = 1_000_000;
    vi.mocked(findListings).mockReset();
    vi.mocked(findListings).mockResolvedValue([listing({ price: 4 })]);
  });
  const load = (cache = memoryStore(), extra = {}) =>
    loadBaskets(stores, { store: cache, now: () => clock, fetchFn: vi.fn(), ...extra });

  it("reuses results under 24 hours and refetches older ones", async () => {
    const cache = memoryStore();
    const first = await load(cache);
    expect(first[0]?.prices).toEqual({ "Sol Ring": 4 });
    expect(findListings).toHaveBeenCalledTimes(2);

    clock += BASKET_TTL_MS - 1;
    await load(cache);
    expect(findListings).toHaveBeenCalledTimes(2);

    clock += 2;
    await load(cache);
    expect(findListings).toHaveBeenCalledTimes(4);
  });

  it("only fetches stores not seen yet", async () => {
    const cache = memoryStore();
    await load(cache);
    await loadBaskets([...stores, store("three")], {
      store: cache,
      now: () => clock,
      fetchFn: vi.fn(),
    });
    expect(findListings).toHaveBeenCalledTimes(3);
  });

  it("refetches everything when forced", async () => {
    const cache = memoryStore();
    await load(cache);
    await load(cache, { force: true });
    expect(findListings).toHaveBeenCalledTimes(4);
  });

  it("reports a failing store without breaking the others, and doesn't cache it", async () => {
    vi.mocked(findListings).mockRejectedValueOnce(new Error("boom"));
    const cache = memoryStore();
    const results = await load(cache);
    expect(results.filter((r) => r.error)).toHaveLength(1);
    expect(results.filter((r) => !r.error)).toHaveLength(1);
    await load(cache);
    expect(findListings).toHaveBeenCalledTimes(3);
  });

  it("never fetches robots.txt-blocked hosts", async () => {
    const blocked = { url: "https://store.battlegroundgames.com", name: "Battleground" };
    const results = await load(memoryStore(), {});
    expect(results).toHaveLength(2);
    vi.mocked(findListings).mockClear();
    const out = await loadBaskets([blocked], { store: memoryStore(), fetchFn: vi.fn() });
    expect(out).toEqual([]);
    expect(findListings).not.toHaveBeenCalled();
  });
});
