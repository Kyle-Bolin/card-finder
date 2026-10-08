import { beforeEach, describe, expect, it, vi } from "vitest";

const permissions = { contains: vi.fn(), request: vi.fn() };
vi.mock("webextension-polyfill", () => ({ default: { permissions } }));

const { missingOrigins, originsForStores, requestOrigins } = await import("../src/lib/permissions");
const { describeFetchError } = await import("../src/lib/fetchError");

const a = "https://*.tcgplayerpro.com/*";
const b = "https://api.zippopotam.us/*";

beforeEach(() => vi.resetAllMocks());

describe("missingOrigins", () => {
  it("returns only the origins that aren't granted", async () => {
    permissions.contains.mockImplementation(
      async ({ origins }: { origins: string[] }) => origins[0] === a,
    );
    expect(await missingOrigins([a, b])).toEqual([b]);
  });

  it("returns nothing when everything is granted", async () => {
    permissions.contains.mockResolvedValue(true);
    expect(await missingOrigins([a, b])).toEqual([]);
  });
});

describe("requestOrigins", () => {
  it("passes the origins to permissions.request", async () => {
    permissions.request.mockResolvedValue(true);
    expect(await requestOrigins([a])).toBe(true);
    expect(permissions.request).toHaveBeenCalledWith({ origins: [a] });
  });

  it("treats a rejected request as denied", async () => {
    permissions.request.mockRejectedValue(new Error("no gesture"));
    expect(await requestOrigins([a])).toBe(false);
  });
});

describe("describeFetchError", () => {
  it("explains a network TypeError as missing site access", () => {
    expect(describeFetchError(new TypeError("Load failed"), "https://x.tcgplayerpro.com")).toBe(
      "Couldn't reach x.tcgplayerpro.com. Check Card Finder's site access in your browser's extension settings.",
    );
  });

  it("keeps other error messages", () => {
    expect(describeFetchError(new Error("HTTP 500"), "https://x.tcgplayerpro.com")).toBe(
      "HTTP 500",
    );
  });
});

describe("originsForStores", () => {
  it("adds each non-TCGplayer Pro store's own origin to the TCGplayer Pro hosts", () => {
    expect(
      originsForStores([
        { url: "https://dmcomics.tcgplayerpro.com", name: "DMC" },
        { url: "https://a.test", name: "A", platform: "shopify" },
        { url: "https://a.test", name: "A again", platform: "shopify" },
      ]),
    ).toEqual([a, "https://a.test/*"]);
  });
});
