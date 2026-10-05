import { describe, expect, it } from "vitest";
import { getSite, normalizeStoreUrl } from "../src/lib/tcgplayerpro";
import { fakeFetch, fixture } from "./helpers";

describe("normalizeStoreUrl", () => {
  it.each([
    ["dmcomics", "https://dmcomics.tcgplayerpro.com"],
    ["dmcomics.tcgplayerpro.com", "https://dmcomics.tcgplayerpro.com"],
    [
      "  https://DMComics.tcgplayerpro.com/search/products?q=sol ",
      "https://dmcomics.tcgplayerpro.com",
    ],
    ["http://dmcomics.tcgplayerpro.com", "https://dmcomics.tcgplayerpro.com"],
  ])("%s → %s", (input, expected) => {
    expect(normalizeStoreUrl(input)).toBe(expected);
  });

  it.each([
    "",
    "https://dmcomics.com",
    "https://tcgplayerpro.com",
    "https://evil.com/?x=.tcgplayerpro.com",
    "not a url at all",
  ])("rejects %j", (input) => {
    expect(normalizeStoreUrl(input)).toBeNull();
  });
});

describe("getSite", () => {
  it("parses store details", async () => {
    const { fetchFn } = fakeFetch({
      "https://dmcomics.tcgplayerpro.com/api/site": { body: fixture("tcgplayerpro/site.json") },
    });
    const site = await getSite("https://dmcomics.tcgplayerpro.com", fetchFn);
    expect(site).toMatchObject({
      url: "https://dmcomics.tcgplayerpro.com",
      name: "Double Midnight Comics",
      address: {
        street: "252 Willow St 149",
        city: "Manchester",
        state: "New Hampshire",
        zip: "03103",
      },
      phone: "(603) 669-9636",
      sellerKey: "91271f92",
    });
    expect(site?.hours).toContain("Sun 11am - 6pm");
  });

  it("returns null when there is no storefront", async () => {
    const { fetchFn } = fakeFetch({});
    expect(await getSite("https://nope.tcgplayerpro.com", fetchFn)).toBeNull();
  });

  it("throws on server errors", async () => {
    const { fetchFn } = fakeFetch({ "https://x.tcgplayerpro.com/api/site": { status: 503 } });
    await expect(getSite("https://x.tcgplayerpro.com", fetchFn)).rejects.toThrow("HTTP 503");
  });
});
