import { describe, expect, it, vi } from "vitest";

vi.mock("webextension-polyfill", () => ({ default: {} }));

const { removeStore, upsertStore } = await import("../src/lib/settings");

const a = { url: "https://a.tcgplayerpro.com", name: "A" };
const b = { url: "https://b.tcgplayerpro.com", name: "B" };

describe("store list helpers", () => {
  it("adds new stores and replaces existing ones by URL", () => {
    expect(upsertStore([], a)).toEqual([a]);
    expect(upsertStore([a, b], { ...a, name: "A renamed" })).toEqual([
      { ...a, name: "A renamed" },
      b,
    ]);
  });

  it("removes by URL", () => {
    expect(removeStore([a, b], a.url)).toEqual([b]);
  });
});
