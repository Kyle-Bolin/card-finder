import { describe, expect, it } from "vitest";
import { crawl, EMPTY_STATE, type CrawlState } from "../src/crawler/crawl";
import {
  extractStorefrontLinks,
  robotsAllows,
  shopPageLinks,
  websiteOrigin,
} from "../src/crawler/homepage";
import { politeFetch, rateBucket } from "../src/crawler/http";
import { proSellersForProduct } from "../src/crawler/marketplace";
import { distanceMeters, nearbyFromDirectory, type Directory } from "../src/lib/directory";
import type { FetchFn, WpnStore } from "../src/lib/types";

/** Fake web: route by URL (exact, or a predicate) to a status and body. */
function fakeWeb(
  routes: Record<string, unknown | ((init?: RequestInit) => unknown)>,
  statusFor: Record<string, number> = {},
): { fetchFn: FetchFn; calls: string[] } {
  const calls: string[] = [];
  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push(url);
    if (url in statusFor) return new Response("", { status: statusFor[url] });
    if (!(url in routes)) return new Response("not found", { status: 404 });
    const route = routes[url];
    const body = typeof route === "function" ? route(init) : route;
    const isHtml = typeof body === "string";
    return new Response(isHtml ? body : JSON.stringify(body), {
      status: 200,
      headers: { "content-type": isHtml ? "text/html" : "application/json" },
    });
  }) as FetchFn;
  return { fetchFn, calls };
}

describe("homepage scanning", () => {
  it("extracts storefront links", () => {
    const html = `<a href="https://MobrosTCG.tcgplayerpro.com/">Shop singles</a>
      <script src="https://www.tcgplayerpro.com/x.js"></script> mobrostcg.tcgplayerpro.com again`;
    expect(extractStorefrontLinks(html)).toEqual(["https://mobrostcg.tcgplayerpro.com"]);
  });

  it("finds same-site shop pages", () => {
    const html = `<a href="/about">About</a><a href="/shop">Store</a>
      <a href="https://other.com/singles">Singles</a><a href="/events">Buy <b>cards</b></a>`;
    expect(shopPageLinks(html, "https://store.com")).toEqual([
      "https://store.com/shop",
      "https://store.com/events",
    ]);
  });

  it("honors robots.txt", () => {
    const robots = `User-agent: *\nDisallow: /private\n\nUser-agent: card-finder\nDisallow: /\nAllow: /shop`;
    expect(robotsAllows(robots, "/", "card-finder")).toBe(false);
    expect(robotsAllows(robots, "/shop/singles", "card-finder")).toBe(true);
    expect(robotsAllows(robots, "/", "someone-else")).toBe(true);
    expect(robotsAllows(robots, "/private/x", "someone-else")).toBe(false);
    expect(robotsAllows("", "/")).toBe(true);
  });

  it("only crawls stores' own websites", () => {
    expect(websiteOrigin("www.bazaargametrading.com/home")).toBe(
      "https://www.bazaargametrading.com",
    );
    expect(websiteOrigin("https://discord.gg/abc")).toBeNull();
    expect(websiteOrigin("https://www.facebook.com/store")).toBeNull();
    expect(websiteOrigin("https://x.tcgplayerpro.com")).toBeNull();
    expect(websiteOrigin(null)).toBeNull();
  });
});

describe("politeFetch", () => {
  it("groups all storefronts into one rate-limit bucket", () => {
    expect(rateBucket("https://a.tcgplayerpro.com/api/site")).toBe("tcgplayerpro.com");
    expect(rateBucket("https://example.com/")).toBe("example.com");
  });

  it("sends an identifying UA, spaces requests, and retries 5xx", async () => {
    const sleeps: number[] = [];
    let attempts = 0;
    const seenUa: (string | null)[] = [];
    const baseFetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
      seenUa.push(new Headers(init?.headers).get("User-Agent"));
      return new Response("", { status: ++attempts === 1 ? 503 : 200 });
    }) as FetchFn;
    const http = politeFetch({
      baseFetch,
      sleep: async (ms) => void sleeps.push(ms),
      intervalMs: () => 0,
    });
    const res = await http.fetch("https://a.tcgplayerpro.com/api/site");
    expect(res.status).toBe(200);
    expect(attempts).toBe(2);
    expect(sleeps).toContain(1000);
    expect(seenUa[0]).toMatch(/^Mozilla\/5\.0 \(compatible; card-finder\//);
    expect(seenUa[0]).not.toMatch(/crawler|bot/i);
  });
});

describe("marketplace", () => {
  it("keeps only Pro sellers and lowercases seller keys", async () => {
    const { fetchFn } = fakeWeb({
      "https://mp-search-api.tcgplayer.com/v1/product/1/listings": {
        results: [
          {
            totalResults: 2,
            results: [
              {
                sellerKey: "ABC123",
                sellerName: "Dice City Games",
                sellerPrograms: ["Pro", "VIP"],
                sellerAddress: { city: "Silver Spring", territory: "MD" },
              },
              { sellerKey: "zzz", sellerName: "Not Pro", sellerPrograms: [] },
            ],
          },
        ],
      },
    });
    expect(await proSellersForProduct(1, fetchFn)).toEqual([
      { sellerKey: "abc123", name: "Dice City Games", city: "Silver Spring", state: "MD" },
    ]);
  });
});

describe("directory", () => {
  it("computes distances", () => {
    const milford = { latitude: 42.8353, longitude: -71.6487 };
    const nashua = { latitude: 42.7654, longitude: -71.4676 };
    expect(distanceMeters(milford, nashua) / 1609.344).toBeCloseTo(10.4, 0);
    expect(distanceMeters(milford, milford)).toBe(0);
  });

  it("lists storefront locations in range, nearest first", () => {
    const directory: Directory = {
      generatedAt: "",
      checkedWpnStoreIds: [],
      storefronts: [
        {
          url: "https://far.tcgplayerpro.com",
          name: "Far",
          sources: [],
          firstSeen: "",
          lastSeen: "",
          locations: [
            {
              latitude: 44,
              longitude: -71,
              storeName: "Far",
              postalAddress: "",
              confidence: "confirmed",
            },
          ],
        },
        {
          url: "https://dmcomics.tcgplayerpro.com",
          name: "Double Midnight Comics",
          sources: [],
          firstSeen: "",
          lastSeen: "",
          locations: [
            {
              latitude: 43.2,
              longitude: -71.5,
              storeName: "DMC Concord",
              postalAddress: "",
              confidence: "possible",
            },
            {
              latitude: 42.98,
              longitude: -71.46,
              storeName: "DMC Manchester",
              postalAddress: "",
              confidence: "confirmed",
              wpnStoreId: "8657",
            },
          ],
        },
      ],
    };
    const near = nearbyFromDirectory(
      directory,
      { latitude: 42.8353, longitude: -71.6487 },
      50 * 1609.344,
    );
    expect(near.map((m) => [m.store.name, m.confidence])).toEqual([
      ["DMC Manchester", "confirmed"],
      ["DMC Concord", "possible"],
    ]);
    expect(near[0]?.store.id).toBe("8657");
  });
});

describe("crawl", () => {
  const WPN = "https://api.tabletop.wizards.com/silverbeak-griffin-service/graphql";
  const wpnStore = (o: Partial<WpnStore>): WpnStore => ({
    id: "1",
    name: "x",
    postalAddress: "",
    latitude: 42.9,
    longitude: -71.5,
    distance: 0,
    phoneNumber: null,
    website: null,
    ...o,
  });
  const site = (name: string, zip: string, sellerKey: string) => ({
    contactInfo: {
      storeName: name,
      storeAddress: { street: "1 Main", city: "Town", state: "NH", zip },
      phone: null,
    },
    seller: { sellerKey },
  });
  const stores = [
    wpnStore({
      id: "10",
      name: "Bazaar Game Trading",
      postalAddress: "650 Amherst St, Nashua, NH, 03063",
      website: "http://www.bazaargametrading.com",
    }),
    wpnStore({
      id: "11",
      name: "The Shop By Mobros",
      postalAddress: "880 Second St, Manchester, NH, 03102",
      website: "https://mobrostc.com/",
    }),
    wpnStore({
      id: "12",
      name: "No Storefront Games",
      postalAddress: "1 Elm St, Keene, NH, 03431",
    }),
  ];
  const region = { point: { latitude: 42.8, longitude: -71.6, label: "Milford" }, miles: 30 };

  function web(extra: Record<string, unknown> = {}, status: Record<string, number> = {}) {
    return fakeWeb(
      {
        [WPN]: {
          data: {
            storesByLocation: { stores, pageInfo: { page: 0, pageSize: 1000, totalResults: 3 } },
          },
        },
        "https://bazaargametrading.tcgplayerpro.com/api/site": site(
          "Bazaar Game Trading",
          "03063",
          "aaa",
        ),
        "https://mobrostc.com": `<a href="https://mobrostcg.tcgplayerpro.com">Shop singles</a>`,
        "https://mobrostcg.tcgplayerpro.com/api/site": site("The Shop By Mobros", "03102", "bbb"),
        "https://seedstore.tcgplayerpro.com/api/site": site("Seed Store", "03055", "ccc"),
        "https://api.zippopotam.us/us/03055": {
          places: [
            {
              "place name": "Milford",
              "state abbreviation": "NH",
              latitude: "42.83",
              longitude: "-71.65",
            },
          ],
        },
        ...extra,
      },
      status,
    );
  }

  it("discovers via guesses, homepage links and seeds", async () => {
    const { fetchFn } = web();
    const { directory, state, stats } = await crawl(
      null,
      EMPTY_STATE,
      [{ url: "https://seedstore.tcgplayerpro.com", source: "commoncrawl" }],
      { fetchFn, region, now: new Date("2026-10-05T00:00:00Z") },
    );
    const byUrl = Object.fromEntries(directory.storefronts.map((s) => [s.url, s]));
    expect(Object.keys(byUrl).sort()).toEqual([
      "https://bazaargametrading.tcgplayerpro.com",
      "https://mobrostcg.tcgplayerpro.com",
      "https://seedstore.tcgplayerpro.com",
    ]);
    expect(byUrl["https://bazaargametrading.tcgplayerpro.com"]).toMatchObject({
      sellerKey: "aaa",
      sources: ["guess"],
      locations: [{ wpnStoreId: "10", confidence: "confirmed" }],
    });
    expect(byUrl["https://mobrostcg.tcgplayerpro.com"]?.sources).toEqual(["homepage"]);
    expect(byUrl["https://seedstore.tcgplayerpro.com"]).toMatchObject({
      sources: ["commoncrawl"],
      locations: [{ confidence: "geocoded", latitude: 42.83 }],
    });
    expect(directory.checkedWpnStoreIds).toEqual(["10", "11", "12"]);
    expect(state.wpn["12"]).toEqual({ checkedAt: "2026-10-05T00:00:00.000Z" });
    expect(stats.newStorefronts).toHaveLength(3);
  });

  it("skips recently checked stores and drops storefronts after two 404s", async () => {
    const first = await crawl(null, EMPTY_STATE, [], {
      fetchFn: web().fetchFn,
      region,
      now: new Date("2026-10-05T00:00:00Z"),
    });

    // Bazaar's storefront disappears.
    const gone = { "https://bazaargametrading.tcgplayerpro.com/api/site": 404 };
    const second = web({}, gone);
    const run2 = await crawl(first.directory, first.state, [], {
      fetchFn: second.fetchFn,
      region,
      now: new Date("2026-10-12T00:00:00Z"),
    });
    // Store 12 was checked a week ago: not re-checked (default 30 days).
    expect(second.calls.some((u) => u.includes("nostorefrontgames"))).toBe(false);
    // One miss: kept.
    expect(run2.directory.storefronts.map((s) => s.url)).toContain(
      "https://bazaargametrading.tcgplayerpro.com",
    );

    const run3 = await crawl(run2.directory, run2.state, [], {
      fetchFn: web({}, gone).fetchFn,
      region,
      now: new Date("2026-10-19T00:00:00Z"),
    });
    expect(run3.stats.removedStorefronts).toEqual(["https://bazaargametrading.tcgplayerpro.com"]);
    expect(run3.directory.storefronts.map((s) => s.url)).not.toContain(
      "https://bazaargametrading.tcgplayerpro.com",
    );
    expect((run3.state as CrawlState).wpn["10"]?.storefront).toBeUndefined();
  });

  it("checkpoints progress so an interrupted run can resume", async () => {
    const checkpoints: CrawlState[] = [];
    const first = await crawl(null, EMPTY_STATE, [], {
      fetchFn: web().fetchFn,
      region,
      now: new Date("2026-10-05T00:00:00Z"),
      checkpoint: (s) => checkpoints.push(structuredClone(s)),
    });
    expect(checkpoints.length).toBeGreaterThan(0);
    expect(Object.keys(checkpoints.at(-1)?.wpn ?? {}).sort()).toEqual(["10", "11", "12"]);

    // Resuming from the checkpoint doesn't re-check any WPN store.
    const resumed = web();
    await crawl(null, checkpoints.at(-1) ?? EMPTY_STATE, [], {
      fetchFn: resumed.fetchFn,
      region,
      now: new Date("2026-10-05T01:00:00Z"),
    });
    expect(resumed.calls.some((u) => u.includes("mobrostc.com"))).toBe(false);
    expect(first.directory.storefronts).toHaveLength(2);
  });

  it("verifies marketplace sellers by seller key", async () => {
    const listings = {
      results: [
        {
          totalResults: 2,
          results: [
            {
              sellerKey: "DDD",
              sellerName: "Dice City Games",
              sellerPrograms: ["Pro"],
              sellerAddress: { city: "Milford", territory: "NH" },
            },
            { sellerKey: "EEE", sellerName: "Impostor Games", sellerPrograms: ["Pro"] },
          ],
        },
      ],
    };
    const { fetchFn } = web({
      "https://mp-search-api.tcgplayer.com/v1/search/request?q=&isList=false": {
        results: [{ totalResults: 1, results: [{ productId: 1 }] }],
      },
      "https://mp-search-api.tcgplayer.com/v1/product/1/listings": listings,
      "https://dicecitygames.tcgplayerpro.com/api/site": site("Dice City Games", "03055", "ddd"),
      // Guessable subdomain exists but belongs to a different seller: must be rejected.
      "https://impostorgames.tcgplayerpro.com/api/site": site("Impostor Games", "03055", "not-eee"),
    });
    const { directory, stats } = await crawl(null, EMPTY_STATE, [], {
      fetchFn,
      region,
      marketplace: { productLines: ["magic"], productsPerLine: 1 },
    });
    expect(stats.proSellers).toBe(2);
    const urls = directory.storefronts.map((s) => s.url);
    expect(urls).toContain("https://dicecitygames.tcgplayerpro.com");
    expect(urls).not.toContain("https://impostorgames.tcgplayerpro.com");
    expect(directory.storefronts.find((s) => s.url.includes("dicecity"))?.sources).toEqual([
      "marketplace",
    ]);
  });

  it("reuses the collected seller list for a few days", async () => {
    const state: CrawlState = {
      ...EMPTY_STATE,
      proSellerCache: {
        collectedAt: "2026-10-04T00:00:00.000Z",
        sellers: [{ sellerKey: "ddd", name: "Dice City Games", city: "Milford", state: "NH" }],
      },
    };
    const { fetchFn, calls } = web({
      "https://dicecitygames.tcgplayerpro.com/api/site": site("Dice City Games", "03055", "ddd"),
    });
    const { directory } = await crawl(null, state, [], {
      fetchFn,
      region,
      now: new Date("2026-10-05T00:00:00Z"),
      marketplace: { productLines: ["magic"], productsPerLine: 1 },
    });
    expect(calls.some((u) => u.includes("mp-search-api"))).toBe(false);
    expect(directory.storefronts.map((s) => s.url)).toContain(
      "https://dicecitygames.tcgplayerpro.com",
    );
  });
});
