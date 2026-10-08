import { describe, expect, it } from "vitest";
import type { Directory, DirectoryStorefront } from "../src/lib/directory";
import { computeStoreSet } from "../src/lib/storeSet";
import type { Store } from "../src/lib/types";

const home = { latitude: 42.8, longitude: -71.6 };

function sf(
  name: string,
  dLat: number,
  extra: Partial<DirectoryStorefront> = {},
  branches = [dLat],
): DirectoryStorefront {
  return {
    url: `https://${name}.tcgplayerpro.com`,
    name,
    physical: true,
    locations: branches.map((d) => ({
      latitude: home.latitude + d,
      longitude: home.longitude,
      storeName: name,
      postalAddress: "1 Main St",
      confidence: "confirmed" as const,
    })),
    sources: [],
    firstSeen: "",
    lastSeen: "",
    ...extra,
  };
}

// 1 degree of latitude ≈ 69 miles.
const directory: Directory = {
  generatedAt: "",
  checkedWpnStoreIds: [],
  storefronts: [
    sf("near", 0.05),
    sf("mid", 0.3),
    sf("far", 1.2),
    sf("online", 0.01, { physical: false }),
    sf("multi", 0.1, {}, [0.4, 0.1]),
  ],
};

const base = {
  home,
  rangeMiles: 25,
  includeOnline: false,
  excluded: [],
  alwaysInclude: [] as Store[],
  directory,
};
const names = (stores: Store[]) => stores.map((s) => s.name);

describe("computeStoreSet", () => {
  it("selects physical stores in range, nearest first", () => {
    expect(names(computeStoreSet(base).stores)).toEqual(["near", "multi", "mid"]);
  });
  it("lists a multi-branch storefront once", () => {
    const { inRange } = computeStoreSet(base);
    expect(inRange.filter((s) => s.name === "multi")).toHaveLength(1);
  });
  it("widens with the range", () => {
    expect(names(computeStoreSet({ ...base, rangeMiles: 100 }).stores)).toContain("far");
    expect(names(computeStoreSet({ ...base, rangeMiles: 10 }).stores)).toEqual(["near", "multi"]);
  });
  it("includes online-only sellers only when asked", () => {
    expect(names(computeStoreSet({ ...base, includeOnline: true }).stores)).toContain("online");
  });
  it("drops excluded stores from the check but not from the in-range list", () => {
    const set = computeStoreSet({ ...base, excluded: ["https://near.tcgplayerpro.com"] });
    expect(names(set.stores)).not.toContain("near");
    expect(names(set.inRange)).toContain("near");
  });
  it("always checks added stores, even out of range or excluded", () => {
    const far: Store = { url: "https://far.tcgplayerpro.com", name: "far" };
    const added: Store = { url: "https://elsewhere.tcgplayerpro.com", name: "elsewhere" };
    const set = computeStoreSet({
      ...base,
      alwaysInclude: [far, added],
      excluded: [far.url],
    });
    expect(names(set.stores)).toEqual(["far", "elsewhere", "near", "multi", "mid"]);
  });
  it("does not duplicate an added store that is also in range", () => {
    const near: Store = { url: "https://near.tcgplayerpro.com", name: "My near" };
    const set = computeStoreSet({ ...base, alwaysInclude: [near] });
    expect(set.stores.filter((s) => s.url === near.url)).toEqual([near]);
  });
  it("falls back to added stores without a location or directory", () => {
    const added: Store = { url: "https://a.tcgplayerpro.com", name: "a" };
    expect(computeStoreSet({ ...base, home: undefined, alwaysInclude: [added] }).stores).toEqual([
      added,
    ]);
    expect(computeStoreSet({ ...base, directory: null, alwaysInclude: [added] }).stores).toEqual([
      added,
    ]);
  });
});
