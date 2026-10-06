import { describe, expect, it, vi } from "vitest";
import { TtlCache, memoryStore } from "../src/lib/cache";
import { checkStores, findListings, prioritizeStores, type StoreResult } from "../src/lib/check";
import type { CatalogProduct } from "../src/lib/tcgplayerpro";
import type { FetchFn, Store } from "../src/lib/types";

vi.mock("webextension-polyfill", () => ({ default: {} }));
const { loadDirectory, DIRECTORY_CACHE_TTL_MS } = await import("../src/lib/directoryCache");

const stores: Store[] = ["a", "b", "c", "d", "e"].map((s) => ({
  url: `https://${s}.tcgplayerpro.com`,
  name: s.toUpperCase(),
}));
const cards = ["Sol Ring", "Counterspell", "Cultivate", "Swords to Plowshares", "Brainstorm"].map(
  (name) => ({ name, quantity: 1, sources: [] }),
);

const product = (name: string): CatalogProduct => ({
  id: name.length * 1000 + name.charCodeAt(0),
  name,
  setName: "Commander Legends",
  productLineUrlName: "magic",
  setUrlName: "cmr",
  productUrlName: name.toLowerCase().replace(/ /g, "-"),
});

/** Fake storefront network that tracks peak concurrency, per host and overall. */
function slowNetwork() {
  const stats = {
    active: 0,
    peak: 0,
    perHost: new Map<string, { active: number; peak: number }>(),
  };
  const searches: string[] = [];
  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const host = new URL(url).host;
    const h = stats.perHost.get(host) ?? { active: 0, peak: 0 };
    stats.perHost.set(host, h);
    stats.active++;
    h.active++;
    stats.peak = Math.max(stats.peak, stats.active);
    h.peak = Math.max(h.peak, h.active);
    await new Promise((r) => setTimeout(r, 5));
    stats.active--;
    h.active--;
    if (url.endsWith("/api/catalog/search")) {
      const { query } = JSON.parse(String(init?.body)) as { query: string };
      searches.push(`${host}|${query}`);
      return new Response(JSON.stringify({ products: { items: [product(query)] } }));
    }
    const ids = new URL(url).searchParams.get("productIds")?.split(",").map(Number) ?? [];
    return new Response(
      JSON.stringify(
        ids.map((productId) => ({
          productId,
          skus: [
            {
              conditionName: "Near Mint",
              languageName: "English",
              isFoil: false,
              price: 1,
              quantity: 2,
            },
          ],
        })),
      ),
    );
  }) as FetchFn;
  return { fetchFn, stats, searches };
}

describe("parallel store checks", () => {
  it("bounds in-flight requests and matches the sequential results", async () => {
    const seq = slowNetwork();
    const sequential = await checkStores(stores, cards, () => {}, {
      fetchFn: seq.fetchFn,
      concurrency: 1,
      cardConcurrency: 1,
    });
    expect(seq.stats.peak).toBe(1);

    const par = slowNetwork();
    const parallel = await checkStores(stores, cards, () => {}, {
      fetchFn: par.fetchFn,
      concurrency: 3,
      cardConcurrency: 3,
      maxInFlight: 8,
    });
    expect(par.stats.peak).toBeGreaterThan(3);
    expect(par.stats.peak).toBeLessThanOrEqual(8);
    expect(parallel).toEqual(sequential);
  });

  it("limits requests per store to the card concurrency", async () => {
    const net = slowNetwork();
    await findListings(stores[0]!, cards, net.fetchFn, { cardConcurrency: 3 });
    const peak = net.stats.perHost.get("a.tcgplayerpro.com")!.peak;
    expect(peak).toBe(3);
  });

  it("puts stores with earlier finds first", () => {
    const previous = [
      { store: stores[3]!, listings: [], found: ["Sol Ring"] },
      { store: stores[1]!, listings: [], found: [] },
    ] as StoreResult[];
    expect(prioritizeStores(stores, previous).map((s) => s.name)).toEqual([
      "D",
      "A",
      "B",
      "C",
      "E",
    ]);
  });
});

describe("search cache", () => {
  it("hits, expires and reloads", async () => {
    let now = 0;
    const cache = new TtlCache<CatalogProduct[]>(memoryStore(), "s:", 10 * 60_000, () => now);
    const net = slowNetwork();
    const run = () =>
      findListings(stores[0]!, cards.slice(0, 2), net.fetchFn, { searchCache: cache });

    const first = await run();
    expect(net.searches).toHaveLength(2);
    now = 9 * 60_000;
    expect(await run()).toEqual(first);
    expect(net.searches).toHaveLength(2); // served from cache
    now = 10 * 60_000;
    await run();
    expect(net.searches).toHaveLength(4); // expired
  });

  it("keys by store and card", async () => {
    const cache = new TtlCache<number>(memoryStore(), "s:", 1000);
    await cache.set("a|x", 1);
    expect(await cache.get("a|x")).toBe(1);
    expect(await cache.get("b|x")).toBeUndefined();
  });
});

describe("directory cache", () => {
  const dir = { generatedAt: "t", storefronts: [], checkedWpnStoreIds: [] };
  function setup() {
    let calls = 0;
    const fetchFn = (async () => {
      calls++;
      return new Response(JSON.stringify({ ...dir, generatedAt: `v${calls}` }));
    }) as FetchFn;
    let now = 1_000;
    return {
      fetchFn,
      store: memoryStore(),
      now: () => now,
      tick: (ms: number) => (now += ms),
      calls: () => calls,
    };
  }

  it("serves from cache, expires after a day, and refreshes on demand", async () => {
    const s = setup();
    const opts = { fetchFn: s.fetchFn, store: s.store, now: s.now };
    expect((await loadDirectory(opts))?.generatedAt).toBe("v1");
    s.tick(DIRECTORY_CACHE_TTL_MS - 1);
    expect((await loadDirectory(opts))?.generatedAt).toBe("v1");
    expect(s.calls()).toBe(1);
    s.tick(1);
    expect((await loadDirectory(opts))?.generatedAt).toBe("v2");
    expect((await loadDirectory({ ...opts, refresh: true }))?.generatedAt).toBe("v3");
    expect(s.calls()).toBe(3);
  });

  it("falls back to a stale copy when the fetch fails", async () => {
    const s = setup();
    const opts = { fetchFn: s.fetchFn, store: s.store, now: s.now };
    await loadDirectory(opts);
    s.tick(DIRECTORY_CACHE_TTL_MS + 1);
    const failing = (async () => new Response("", { status: 500 })) as FetchFn;
    expect((await loadDirectory({ ...opts, fetchFn: failing }))?.generatedAt).toBe("v1");
  });
});
