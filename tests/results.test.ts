import { describe, expect, it, vi } from "vitest";
import type { StoreResult } from "../src/lib/check";
import { todaysHours } from "../src/lib/hours";
import { distanceMiles, withCoordinates } from "../src/lib/storeFinder";
import { cheapestTotal, sortStores, storeDistance } from "../src/ui/results";
import { fakeFetch } from "./helpers";

// ui/results pulls in history.ts, which imports the extension polyfill.
vi.mock("webextension-polyfill", () => ({ default: {} }));

const home = { latitude: 40.0, longitude: -75.0 };

function result(name: string, found: number, coords?: [number, number]): StoreResult {
  return {
    store: {
      url: `https://${name}.tcgplayerpro.com`,
      name,
      latitude: coords?.[0],
      longitude: coords?.[1],
    },
    listings: [],
    found: Array.from({ length: found }, (_, i) => `card ${i}`),
  };
}

const near = result("near", 1, [40.1, -75.0]);
const far = result("far", 5, [41.0, -75.0]);
const unknown = result("unknown", 3);
const empty = result("empty", 0, [40.0, -75.0]);

describe("distance", () => {
  it("computes great-circle miles", () => {
    expect(distanceMiles(home, { latitude: 41, longitude: -75 })).toBeCloseTo(69.1, 0);
    expect(distanceMiles(home, home)).toBe(0);
  });

  it("is null without a home or store coordinates (old saved stores)", () => {
    expect(storeDistance(near, home)).toBeCloseTo(6.9, 0);
    expect(storeDistance(near, undefined)).toBeNull();
    expect(storeDistance(unknown, home)).toBeNull();
  });
});

describe("sortStores", () => {
  const all = [far, unknown, empty, near];

  it("sorts closest first, unknown distances last, dropping stores without stock", () => {
    expect(sortStores(all, "closest", home).map((r) => r.store.name)).toEqual([
      "near",
      "far",
      "unknown",
    ]);
  });

  it("sorts by most cards, then name", () => {
    expect(sortStores(all, "cards", home).map((r) => r.store.name)).toEqual([
      "far",
      "unknown",
      "near",
    ]);
  });

  it("falls back to card counts for stores without coordinates", () => {
    expect(sortStores([near, far], "closest", undefined).map((r) => r.store.name)).toEqual([
      "far",
      "near",
    ]);
  });
});

describe("todaysHours", () => {
  const monday = new Date(2026, 9, 5);
  const sunday = new Date(2026, 9, 4);
  const thursday = new Date(2026, 9, 8);

  it("handles abbreviated days on separate lines", () => {
    const hours = "Sun 11am - 6pm\nMon 10am - 7pm";
    expect(todaysHours(hours, monday)).toBe("10am - 7pm");
    expect(todaysHours(hours, sunday)).toBe("11am - 6pm");
  });

  it("handles full day names with tabs", () => {
    expect(
      todaysHours("Sunday\t12:00 p.m. – 5:00 p.m.\nMonday\t11:00 a.m. – 9:30 p.m.", monday),
    ).toBe("11:00 a.m. – 9:30 p.m.");
  });

  it("handles colons, CRLF and Thurs", () => {
    expect(todaysHours("Mon: Closed\r\nThurs: 10-8", monday)).toBe("Closed");
    expect(todaysHours("Mon: Closed\r\nThurs: 10-8", thursday)).toBe("10-8");
  });

  it("omits when nothing matches", () => {
    expect(todaysHours("Tue 10-6", monday)).toBeNull();
    expect(todaysHours("Monday-Friday 10-6", monday)).toBeNull();
    expect(todaysHours("Mondays are great", monday)).toBeNull();
    expect(todaysHours(undefined, monday)).toBeNull();
  });
});

describe("withCoordinates", () => {
  const store = {
    url: "https://a.tcgplayerpro.com",
    name: "A",
    address: { street: "1 Main", city: "Town", state: "PA", zip: "19103" },
  };
  const zip = {
    "https://api.zippopotam.us/us/19103": {
      body: {
        places: [
          {
            "place name": "Philadelphia",
            "state abbreviation": "PA",
            latitude: "39.95",
            longitude: "-75.17",
          },
        ],
      },
    },
  };

  it("geocodes the ZIP when coordinates are missing", async () => {
    const { fetchFn } = fakeFetch(zip);
    expect(await withCoordinates(store, fetchFn)).toMatchObject({
      latitude: 39.95,
      longitude: -75.17,
    });
  });

  it("leaves located stores alone and tolerates lookup failures", async () => {
    const { fetchFn, calls } = fakeFetch({});
    const located = { ...store, latitude: 1, longitude: 2 };
    expect(await withCoordinates(located, fetchFn)).toBe(located);
    expect(await withCoordinates(store, fetchFn)).toBe(store);
    expect(calls).toHaveLength(1);
  });
});

describe("cheapestTotal", () => {
  const listing = (cardName: string, price: number, quantity?: number) => ({
    storeUrl: "https://s.test",
    cardName,
    productName: cardName,
    setName: "Set",
    condition: "NM",
    language: "English",
    foil: false,
    price,
    quantity,
    url: "https://s.test/p",
  });
  const want = (name: string, quantity = 1) => ({ name, quantity, sources: [] });
  const at = (...listings: ReturnType<typeof listing>[]): StoreResult => ({
    store: { url: "https://s.test", name: "S" },
    listings,
    found: [...new Set(listings.map((l) => l.cardName))],
  });

  it("adds the cheapest copy of each card found", () => {
    const result = at(
      listing("Cloudshift", 0.45, 4),
      listing("Cloudshift", 0.35, 2),
      listing("Pearl Medallion", 1.25, 1),
    );
    expect(
      cheapestTotal(result, [want("Cloudshift"), want("Pearl Medallion"), want("Sol Ring")]),
    ).toBe(1.6);
  });

  it("buys more expensive copies once the cheapest run out", () => {
    const result = at(listing("Plains", 0.1, 2), listing("Plains", 0.25, 10));
    expect(cheapestTotal(result, [want("Plains", 5)])).toBe(0.95);
  });

  it("counts a listing without a quantity as one copy, and stops when stock runs out", () => {
    const result = at(listing("Cloudshift", 2.1), listing("Cloudshift", 1.8));
    expect(cheapestTotal(result, [want("Cloudshift", 3)])).toBe(3.9);
  });
});
