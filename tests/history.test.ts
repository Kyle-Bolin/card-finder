import { describe, expect, it, vi } from "vitest";
import type { StoreResult } from "../src/lib/check";
import type { Listing, Store, WantedCard } from "../src/lib/types";

vi.mock("webextension-polyfill", () => ({ default: {} }));

const { diffCheck, formatAgo, listingKey, listKey, parseDeckHistory, pruneHistory } =
  await import("../src/lib/history");

const store: Store = { url: "https://a.tcgplayerpro.com", name: "A" };
const other: Store = { url: "https://b.tcgplayerpro.com", name: "B" };
const wanted: WantedCard[] = [
  { name: "Sol Ring", quantity: 1, sources: [] },
  { name: "Rhystic Study", quantity: 1, sources: [] },
];

function listing(over: Partial<Listing> = {}): Listing {
  return {
    storeUrl: store.url,
    cardName: "Sol Ring",
    productName: "Sol Ring",
    setName: "CMR",
    condition: "NM",
    language: "English",
    foil: false,
    price: 2,
    quantity: 3,
    url: "https://a.tcgplayerpro.com/x",
    ...over,
  };
}

function result(listings: Listing[], s: Store = store, error?: string): StoreResult {
  return { store: s, listings, found: [...new Set(listings.map((l) => l.cardName))], error };
}

const T1 = "2026-01-01T00:00:00.000Z";
const T2 = "2026-01-03T00:00:00.000Z";

describe("diffCheck", () => {
  it("gives no badges on a first check", () => {
    const { changes, history } = diffCheck(null, [result([listing()])], wanted, T1);
    expect(changes).toEqual({ previousAt: null, badges: {}, soldOut: [] });
    expect(Object.values(history.entries)).toMatchObject([
      { card: "Sol Ring", price: 2, qty: 3, firstSeen: T1, lastSeen: T1 },
    ]);
  });

  it("flags new listings, price drops and sold-out listings, and keeps firstSeen", () => {
    const first = diffCheck(
      null,
      [result([listing(), listing({ cardName: "Rhystic Study", price: 30 })])],
      wanted,
      T1,
    ).history;
    const { changes, history } = diffCheck(
      first,
      [result([listing({ price: 1.5 }), listing({ setName: "C21", price: 4 })])],
      wanted,
      T2,
    );
    expect(changes.previousAt).toBe(T1);
    expect(changes.badges[listingKey(listing())]).toEqual({ kind: "drop", oldPrice: 2 });
    expect(changes.badges[listingKey(listing({ setName: "C21" }))]).toEqual({ kind: "new" });
    expect(changes.soldOut.map((e) => e.card)).toEqual(["Rhystic Study"]);
    expect(history.entries[listingKey(listing())]).toMatchObject({
      price: 1.5,
      firstSeen: T1,
      lastSeen: T2,
    });
  });

  it("leaves unchanged and price-increased listings unbadged", () => {
    const first = diffCheck(null, [result([listing()])], wanted, T1).history;
    const same = diffCheck(first, [result([listing()])], wanted, T2);
    const up = diffCheck(first, [result([listing({ price: 5 })])], wanted, T2);
    expect(same.changes.badges).toEqual({});
    expect(up.changes.badges).toEqual({});
  });

  it("does not call a failed store's listings sold out, and carries them over", () => {
    const first = diffCheck(null, [result([listing()])], wanted, T1).history;
    const { changes, history } = diffCheck(first, [result([], store, "boom")], wanted, T2);
    expect(changes.soldOut).toEqual([]);
    expect(history.entries[listingKey(listing())]?.lastSeen).toBe(T1);
  });

  it("ignores cards no longer wanted and stores no longer checked", () => {
    const first = diffCheck(
      null,
      [result([listing()]), result([listing({ storeUrl: other.url })], other)],
      wanted,
      T1,
    ).history;
    const { changes } = diffCheck(first, [result([])], [wanted[1]!], T2);
    expect(changes.soldOut).toEqual([]);
  });

  it("merges listings that share a key", () => {
    const { history } = diffCheck(
      null,
      [result([listing({ price: 3, quantity: 1 }), listing({ price: 2, quantity: 2 })])],
      wanted,
      T1,
    );
    expect(Object.values(history.entries)).toMatchObject([{ price: 2, qty: 3 }]);
  });
});

describe("listingKey", () => {
  it("normalizes names, sets and condition", () => {
    expect(listingKey(listing({ cardName: " SOL ring " }))).toBe(listingKey(listing()));
    expect(listingKey(listing({ foil: true }))).not.toBe(listingKey(listing()));
  });
});

describe("parseDeckHistory", () => {
  it("treats missing or corrupt data as no history", () => {
    for (const bad of [
      undefined,
      null,
      5,
      "x",
      [],
      {},
      { checkedAt: "nope", entries: {} },
      { checkedAt: T1 },
    ]) {
      expect(parseDeckHistory(bad)).toBeNull();
    }
  });

  it("drops malformed entries but keeps valid ones", () => {
    const good = diffCheck(null, [result([listing()])], wanted, T1).history;
    const parsed = parseDeckHistory({
      ...good,
      entries: { ...good.entries, bad: { price: "free" }, worse: 3 },
    });
    expect(parsed).toEqual(good);
  });
});

describe("pruneHistory", () => {
  it("drops decks not checked in 90 days", () => {
    const entries = {};
    const all = {
      old: { checkedAt: "2026-01-01T00:00:00.000Z", entries },
      recent: { checkedAt: "2026-03-01T00:00:00.000Z", entries },
    };
    expect(Object.keys(pruneHistory(all, "2026-04-15T00:00:00.000Z"))).toEqual(["recent"]);
  });
});

describe("formatAgo", () => {
  const now = new Date("2026-01-10T12:00:00.000Z");
  it("describes elapsed time", () => {
    expect(formatAgo("2026-01-10T11:59:50.000Z", now)).toBe("just now");
    expect(formatAgo("2026-01-10T11:55:00.000Z", now)).toBe("5 minutes ago");
    expect(formatAgo("2026-01-10T11:00:00.000Z", now)).toBe("1 hour ago");
    expect(formatAgo("2026-01-08T12:00:00.000Z", now)).toBe("2 days ago");
    expect(formatAgo("garbage", now)).toBe("");
  });
});

describe("listKey", () => {
  it("is stable across order and case", () => {
    const a = listKey(wanted);
    expect(listKey([...wanted].reverse().map((w) => ({ ...w, name: w.name.toUpperCase() })))).toBe(
      a,
    );
    expect(listKey([wanted[0]!])).not.toBe(a);
  });
});
