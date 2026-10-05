import { describe, expect, it } from "vitest";
import {
  baseStoreName,
  findStorefronts,
  mapLimit,
  matchConfidence,
  nearbyWpnStores,
  phoneKey,
  stateCode,
  stripTrailingLocation,
  subdomainGuesses,
  zipFromAddress,
  zipToLocation,
} from "../src/lib/storeFinder";
import type { StoreSite, WpnStore } from "../src/lib/types";
import { fakeFetch, fixture } from "./helpers";

const WPN = "https://api.tabletop.wizards.com/silverbeak-griffin-service/graphql";

function wpnStore(overrides: Partial<WpnStore>): WpnStore {
  return {
    id: "1",
    name: "Some Store",
    postalAddress: "1 Main St, Town, NH, 03000, United States",
    latitude: 0,
    longitude: 0,
    distance: 1000,
    phoneNumber: null,
    website: null,
    ...overrides,
  };
}

const dmcSite: StoreSite = {
  url: "https://dmcomics.tcgplayerpro.com",
  name: "Double Midnight Comics",
  address: {
    street: "252 Willow St 149",
    city: "Manchester",
    state: "New Hampshire",
    zip: "03103",
  },
  phone: "(603) 669-9636",
};

describe("subdomainGuesses", () => {
  it("uses the website's first host label, then the store name", () => {
    expect(
      subdomainGuesses({
        name: "Double Midnight Comics - Manchester",
        website: "http://www.dmcomics.com/",
      }),
    ).toEqual(["dmcomics", "doublemidnightcomics"]);
  });

  it("handles websites without a scheme and names with & and accents", () => {
    expect(
      subdomainGuesses({ name: "Dragon's Lair Café & Games", website: "dragonslair.net" }),
    ).toEqual(["dragonslair", "dragonslaircafeandgames"]);
  });

  it("drops a leading 'The' as an extra guess", () => {
    expect(subdomainGuesses({ name: "The Shop By Mobros", website: null })).toEqual([
      "theshopbymobros",
      "shopbymobros",
    ]);
  });

  it("ignores generic hosts like wpn.wizards.com and facebook", () => {
    expect(
      subdomainGuesses({ name: "Let's Play - Hooksett", website: "http://wpn.wizards.com" }),
    ).toEqual(["letsplay"]);
    expect(
      subdomainGuesses({ name: "Card Shack", website: "https://www.facebook.com/cardshack" }),
    ).toEqual(["cardshack"]);
  });

  it("strips a trailing city that appears in the address (The Relentless Dragon Nashua)", () => {
    expect(
      subdomainGuesses({
        name: "The Relentless Dragon Nashua",
        website: "https://discord.gg/cDCZvS2",
        postalAddress: "483 Amherst St\nNashua, NH 03063\nUnited States",
        emailAddress: "info@relentlessdragon.com",
        showEmailInSEL: false,
      }),
    ).toEqual([
      "therelentlessdragonnashua",
      "relentlessdragonnashua",
      "therelentlessdragon",
      "relentlessdragon",
    ]);
  });

  it("uses a public email's domain, or its mailbox for free mail", () => {
    expect(
      subdomainGuesses({
        name: "Dragon Store",
        emailAddress: "info@relentlessdragon.com",
        showEmailInSEL: true,
      })[0],
    ).toBe("relentlessdragon");
    expect(
      subdomainGuesses({
        name: "Bazaar Game Trading",
        emailAddress: "bazaargametrading@gmail.com",
        showEmailInSEL: true,
      }),
    ).toEqual(["bazaargametrading"]);
    // Generic free-mail mailboxes say nothing about the store.
    expect(
      subdomainGuesses({
        name: "Card Shack",
        emailAddress: "info@gmail.com",
        showEmailInSEL: true,
      }),
    ).toEqual(["cardshack"]);
  });

  it("never uses an email the store hasn't made public", () => {
    expect(
      subdomainGuesses({
        name: "Card Shack",
        emailAddress: "info@cardshackgames.com",
        showEmailInSEL: false,
      }),
    ).toEqual(["cardshack"]);
  });

  it("drops company suffixes", () => {
    expect(subdomainGuesses({ name: "Gamers Haven LLC" })).toEqual(["gamershaven"]);
  });

  it("skips big chains", () => {
    expect(
      subdomainGuesses({
        name: "GameStop - 0774 - T.J. Maxx Plaza",
        website: "https://www.gamestop.com/",
      }),
    ).toEqual([]);
  });
});

describe("helpers", () => {
  it("stateCode handles names and codes", () => {
    expect(stateCode("New Hampshire")).toBe("NH");
    expect(stateCode("nh")).toBe("NH");
    expect(stateCode("Atlantis")).toBeUndefined();
  });

  it("stripTrailingLocation keeps at least one word", () => {
    expect(stripTrailingLocation("Nashua", "Nashua, NH")).toBe("Nashua");
    expect(stripTrailingLocation("Game Underground", "349 Moody Street, Waltham, MA")).toBe(
      "Game Underground",
    );
  });

  it("baseStoreName strips branch suffixes", () => {
    expect(baseStoreName("Double Midnight Comics - Concord")).toBe("Double Midnight Comics");
    expect(baseStoreName("8-Bit Gaming")).toBe("8-Bit Gaming");
  });

  it("phoneKey keeps the last 10 digits", () => {
    expect(phoneKey("1603-669-9636")).toBe("6036699636");
    expect(phoneKey("(603) 669-9636")).toBe("6036699636");
    expect(phoneKey(null)).toBe("");
  });

  it("zipFromAddress finds the 5-digit ZIP", () => {
    expect(zipFromAddress("252 Willow St, Manchester, NH, 03103, United States")).toBe("03103");
    expect(zipFromAddress("38 Emerson St, Haverhill, MA, 01830-6104, US")).toBe("01830");
    expect(zipFromAddress("No zip here")).toBeUndefined();
  });
});

describe("matchConfidence", () => {
  it("confirms on matching ZIP", () => {
    const store = wpnStore({
      name: "Double Midnight Comics - Manchester",
      postalAddress: "252 Willow St, Manchester, NH, 03103, United States",
    });
    expect(matchConfidence(store, dmcSite)).toBe("confirmed");
  });

  it("confirms on matching phone when ZIPs differ", () => {
    const store = wpnStore({ phoneNumber: "1603-669-9636" });
    expect(matchConfidence(store, dmcSite)).toBe("confirmed");
  });

  it("marks another branch of the same chain as possible", () => {
    const store = wpnStore({
      name: "Double Midnight Comics - Concord",
      postalAddress: "341 Loudon Rd, Concord, NH, 03301, United States",
      phoneNumber: "1603-555-0100",
    });
    expect(matchConfidence(store, dmcSite)).toBe("possible");
  });

  it("rejects a same-name store in another state", () => {
    const store = wpnStore({
      name: "The Dragon's Lair",
      postalAddress: "1 Main St, Norway, ME, 04268, United States",
    });
    const florida: StoreSite = {
      url: "https://thedragonslair.tcgplayerpro.com",
      name: "The Dragon's Lair",
      address: {
        street: "10676 Colonial Blvd",
        city: "Fort Myers",
        state: "Florida",
        zip: "33913",
      },
    };
    expect(matchConfidence(store, florida)).toBeNull();
  });

  it("accepts a same-name branch in the same state", () => {
    const store = wpnStore({
      name: "Most Excellent Gaming - Enfield",
      postalAddress: "90 Elm St\nEnfield, CT 06082\nUnited States",
    });
    const site: StoreSite = {
      url: "https://mostexcellentgaming.tcgplayerpro.com",
      name: "Most Excellent Gaming",
      address: {
        street: "29 Pavilions Drive",
        city: "Manchester",
        state: "Connecticut",
        zip: "06042",
      },
    };
    expect(matchConfidence(store, site)).toBe("possible");
  });

  it("rejects an unrelated store that happens to share a subdomain", () => {
    expect(matchConfidence(wpnStore({ name: "Dragon Comics" }), dmcSite)).toBeNull();
  });
});

describe("zipToLocation", () => {
  it("returns coordinates and a label", async () => {
    const { fetchFn } = fakeFetch({
      "https://api.zippopotam.us/us/03103": {
        body: {
          places: [
            {
              "place name": "Manchester",
              "state abbreviation": "NH",
              latitude: "42.9656",
              longitude: "-71.4493",
            },
          ],
        },
      },
    });
    expect(await zipToLocation("03103-1234", fetchFn)).toEqual({
      latitude: 42.9656,
      longitude: -71.4493,
      label: "Manchester, NH 03103",
    });
  });

  it("rejects malformed ZIPs without a request", async () => {
    const { fetchFn, calls } = fakeFetch({});
    await expect(zipToLocation("abc", fetchFn)).rejects.toThrow("valid ZIP");
    expect(calls).toHaveLength(0);
  });
});

describe("nearbyWpnStores", () => {
  it("queries the locator and returns stores nearest first", async () => {
    const { fetchFn, calls } = fakeFetch({
      [WPN]: { body: fixture("wpn/stores_by_location.json") },
    });
    const stores = await nearbyWpnStores({ latitude: 42.9956, longitude: -71.4548 }, 50, fetchFn);
    expect(stores).toHaveLength(12);
    expect(stores[0]?.name).toBe("Collectible Tags");
    expect(stores.map((s) => s.distance)).toEqual(
      [...stores.map((s) => s.distance)].sort((a, b) => a - b),
    );

    expect(calls).toHaveLength(1);
    const body = JSON.parse(String(calls[0]?.init?.body));
    expect(body.variables).toMatchObject({
      latitude: 42.9956,
      longitude: -71.4548,
      maxMeters: 80467,
      page: 0,
    });
  });

  it("pages through results and de-duplicates", async () => {
    const all = fixture<{ data: { storesByLocation: { stores: WpnStore[] } } }>(
      "wpn/stores_by_location.json",
    ).data.storesByLocation.stores;
    const pages = [all.slice(0, 8), all.slice(6)]; // overlapping pages
    const requested: number[] = [];
    const fetchFn = (async (_url: RequestInfo | URL, init?: RequestInit) => {
      const { page } = JSON.parse(String(init?.body)).variables;
      requested.push(page);
      const stores = pages[page] ?? [];
      return new Response(
        JSON.stringify({
          data: { storesByLocation: { stores, pageInfo: { page, pageSize: 8, totalResults: 12 } } },
        }),
      );
    }) as typeof fetch;
    const stores = await nearbyWpnStores({ latitude: 0, longitude: 0 }, 50, fetchFn);
    expect(requested).toEqual([0, 1]);
    expect(stores).toHaveLength(12);
    expect(new Set(stores.map((s) => s.id)).size).toBe(12);
  });

  it("stops if the API keeps returning the same page", async () => {
    const { fetchFn, calls } = fakeFetch({
      [WPN]: {
        body: {
          data: {
            storesByLocation: {
              stores: [wpnStore({ id: "a" })],
              pageInfo: { page: 0, pageSize: 1, totalResults: 500 },
            },
          },
        },
      },
    });
    const stores = await nearbyWpnStores({ latitude: 0, longitude: 0 }, 50, fetchFn);
    expect(stores).toHaveLength(1);
    expect(calls).toHaveLength(2);
  });

  it("surfaces GraphQL errors", async () => {
    const { fetchFn } = fakeFetch({ [WPN]: { body: { errors: [{ message: "boom" }] } } });
    await expect(nearbyWpnStores({ latitude: 0, longitude: 0 }, 10, fetchFn)).rejects.toThrow(
      "boom",
    );
  });
});

describe("findStorefronts", () => {
  it("finds confirmed storefronts and skips stores without one", async () => {
    const stores = fixture<{ data: { storesByLocation: { stores: WpnStore[] } } }>(
      "wpn/stores_by_location.json",
    ).data.storesByLocation.stores;
    const { fetchFn, calls } = fakeFetch({
      "https://dmcomics.tcgplayerpro.com/api/site": { body: fixture("tcgplayerpro/site.json") },
    });
    const progress: number[] = [];
    const matches = await findStorefronts(stores, {
      fetchFn,
      onProgress: (done) => progress.push(done),
    });

    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({
      store: { name: "Double Midnight Comics - Manchester" },
      site: { url: "https://dmcomics.tcgplayerpro.com" },
      confidence: "confirmed",
    });
    expect(progress).toHaveLength(stores.length);
    // GameStop is never probed.
    expect(calls.some((c) => c.url.includes("gamestop"))).toBe(false);
  });
});

describe("mapLimit", () => {
  it("keeps order and respects the concurrency limit", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const out = await mapLimit([1, 2, 3, 4, 5], 2, async (n) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return n * 10;
    });
    expect(out).toEqual([10, 20, 30, 40, 50]);
    expect(maxInFlight).toBe(2);
  });
});
