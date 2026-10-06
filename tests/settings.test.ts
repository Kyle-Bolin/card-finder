import { describe, expect, it, vi } from "vitest";

vi.mock("webextension-polyfill", () => ({ default: {} }));

const store: Record<string, unknown> = {};
vi.doMock("webextension-polyfill", () => ({
  default: {
    storage: {
      local: {
        get: async (key: string) => (key in store ? { [key]: store[key] } : {}),
        set: async (items: Record<string, unknown>) => void Object.assign(store, items),
      },
    },
  },
}));

const { DEFAULT_SETTINGS, loadSettings, removeStore, saveSettings, upsertStore } =
  await import("../src/lib/settings");

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

describe("settings storage", () => {
  it("defaults filters for older settings without them", async () => {
    store.settings = { tag: "wanted", stores: [a] };
    expect(await loadSettings()).toEqual({
      tag: "wanted",
      stores: [a],
      filters: DEFAULT_SETTINGS.filters,
    });
  });

  it("round-trips filters", async () => {
    const filters = {
      maxPrice: 20,
      conditions: ["NM", "LP"] as ("NM" | "LP")[],
      foil: "nonfoil" as const,
      englishOnly: true,
    };
    await saveSettings({ ...DEFAULT_SETTINGS, filters });
    expect((await loadSettings()).filters).toEqual(filters);
  });
});
