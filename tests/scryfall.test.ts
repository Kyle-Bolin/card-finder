import { describe, expect, it, vi } from "vitest";
import { memoryStore, TtlCache } from "../src/lib/cache";
import { playedCards } from "../src/lib/moxfield";
import {
  artistCounts,
  artistSearchUrl,
  batches,
  groupByIllustration,
  isBasicLand,
  loadDeckArt,
  Pacer,
  ScryfallClient,
  searchUrl,
  type Art,
  type ScryfallCard,
} from "../src/lib/scryfall";
import { fakeFetch, fixture } from "./helpers";

vi.mock("webextension-polyfill", () => ({ default: {} }));

const SEARCH_SOL = searchUrl("Sol Ring");
const PAGE2 = "https://api.scryfall.com/cards/search?q=page2";

function setup(routes: Parameters<typeof fakeFetch>[0]) {
  const { fetchFn, calls } = fakeFetch(routes);
  const sleeps: number[] = [];
  let t = 1000;
  const pacer = new Pacer(
    100,
    async (ms) => {
      sleeps.push(ms);
      t += ms;
    },
    () => t,
  );
  const mk = () => ({
    printings: new TtlCache<Art>(memoryStore(), "p:", 1e9),
    arts: new TtlCache<Art[]>(memoryStore(), "a:", 1e9),
  });
  return { client: new ScryfallClient(fetchFn, pacer), calls, sleeps, caches: mk() };
}

const collectionRoute = {
  "https://api.scryfall.com/cards/collection": { body: fixture("scryfall/collection.json") },
};
const searchRoutes = {
  [SEARCH_SOL]: { body: fixture("scryfall/search_sol_ring_page1.json") },
  [PAGE2]: { body: fixture("scryfall/search_sol_ring_page2.json") },
  [searchUrl("Forest")]: { body: fixture("scryfall/search_forest.json") },
};

describe("playedCards", () => {
  const deck = fixture("moxfield/deck_with_signed.json");
  const cards = playedCards(deck);

  it("keeps the played boards with set and collector number, commanders first", () => {
    expect(cards.map((c) => c.name)).toEqual([
      "Sol Ring",
      "Arcane Signet",
      "Forest",
      "Delver of Secrets // Insectile Aberration",
      "Counterspell",
      "Lightning Bolt",
    ]);
    expect(cards[0]).toMatchObject({ set: "khm", cn: "276", quantity: 1, signed: false });
    expect(cards.find((c) => c.name === "Counterspell")?.set).toBeUndefined();
  });

  it("marks signed cards case-insensitively", () => {
    expect(cards.filter((c) => c.signed).map((c) => c.name)).toEqual([
      "Arcane Signet",
      "Lightning Bolt",
    ]);
  });
});

describe("parsing and grouping", () => {
  it("folds reprints with the same illustration into one entry", () => {
    const pages = [1, 2].flatMap(
      (n) => fixture<{ data: ScryfallCard[] }>(`scryfall/search_sol_ring_page${n}.json`).data,
    );
    const arts = groupByIllustration(pages);
    expect(arts.map((a) => a.illustrationId)).toEqual(["ill-1", "ill-finnigan", "ill-3"]);
    expect(arts[0]).toMatchObject({
      set: "c21",
      collectorNumber: "263",
      faces: [{ artist: "Mark Tedin" }],
    });
  });

  it("reads each face of a double-faced card", () => {
    const [, delver] = fixture<{ data: ScryfallCard[] }>("scryfall/collection.json").data;
    const [art] = groupByIllustration([delver as ScryfallCard]);
    expect(art?.faces.map((f) => f.artist)).toEqual(["Nils Hamm", "Nils Hamm & Friend"]);
    expect(art?.faces[1]?.image).toContain("d2.jpg");
  });

  it("recognises basic lands and builds links", () => {
    expect(isBasicLand("Snow-Covered Forest")).toBe(true);
    expect(isBasicLand("Sol Ring")).toBe(false);
    expect(isBasicLand("Forest", "Basic Land — Forest")).toBe(true);
    expect(artistSearchUrl("Sarah Finnigan")).toBe(
      "https://scryfall.com/search?q=a%3A%22Sarah%20Finnigan%22",
    );
    expect(batches([1, 2, 3], 2)).toEqual([[1, 2], [3]]);
  });
});

describe("ScryfallClient", () => {
  it("spaces requests at least 100 ms apart", async () => {
    const { client, sleeps } = setup(searchRoutes);
    await client.searchArts("Sol Ring"); // two pages
    await client.searchArts("Forest");
    expect(sleeps).toEqual([100, 100]);
  });

  it("reports a 429 as a rate limit", async () => {
    const { client } = setup({ [SEARCH_SOL]: { status: 429 } });
    await expect(client.searchArts("Sol Ring")).rejects.toMatchObject({ status: 429 });
  });
});

describe("loadDeckArt", () => {
  const deck = playedCards(fixture("moxfield/deck_with_signed.json"));

  it("skips signed cards, with no lookups for them", async () => {
    const t = setup({ ...collectionRoute, ...searchRoutes });
    const result = await loadDeckArt(deck, {
      client: t.client,
      caches: t.caches,
      includeBasics: false,
    });
    expect(result.signedSkipped).toBe(2);
    expect(result.rows.map((r) => r.name)).not.toContain("Arcane Signet");
    expect(result.rows.map((r) => r.name)).not.toContain("Lightning Bolt");
    const body = JSON.parse(String(t.calls[0]?.init?.body)) as { identifiers: unknown[] };
    expect(body.identifiers).toEqual([
      { set: "khm", collector_number: "276" },
      { set: "khm", collector_number: "280" },
      { set: "isd", collector_number: "51" },
      { name: "Counterspell" },
    ]);
    expect(t.calls.map((c) => c.url).join()).not.toContain("Arcane");
  });

  it("excludes the deck's own art, hides basics by default and counts artists", async () => {
    const t = setup({ ...collectionRoute, ...searchRoutes });
    const result = await loadDeckArt(deck, {
      client: t.client,
      caches: t.caches,
      includeBasics: false,
    });
    const sol = result.rows.find((r) => r.name === "Sol Ring");
    expect(sol?.printing?.faces[0]?.artist).toBe("Sarah Finnigan");
    expect(sol?.alternatives?.map((a) => a.illustrationId)).toEqual(["ill-1", "ill-3"]);
    const forest = result.rows.find((r) => r.name === "Forest");
    expect(forest?.isBasic).toBe(true);
    expect(forest?.alternatives).toBeUndefined();
    expect(t.calls.some((c) => c.url.includes("Forest"))).toBe(false);
    expect(artistCounts(result.rows)).toContainEqual({ artist: "Nils Hamm & Friend", count: 1 });
    expect(artistCounts(result.rows).find((a) => a.artist === "Nils Hamm")?.count).toBe(1);
  });

  it("shows basic land alternatives when asked", async () => {
    const t = setup({ ...collectionRoute, ...searchRoutes });
    const result = await loadDeckArt(deck, {
      client: t.client,
      caches: t.caches,
      includeBasics: true,
    });
    expect(result.rows.find((r) => r.name === "Forest")?.alternatives).toHaveLength(1);
  });

  it("reuses cached results without calling Scryfall", async () => {
    const t = setup({ ...collectionRoute, ...searchRoutes });
    const opts = { client: t.client, caches: t.caches, includeBasics: false };
    await loadDeckArt(deck, opts);
    const before = t.calls.length;
    await loadDeckArt(deck, opts);
    expect(t.calls.length).toBe(before);
  });

  it("keeps loaded results and reports a rate limit", async () => {
    const t = setup({ ...collectionRoute, [SEARCH_SOL]: { status: 429 } });
    const result = await loadDeckArt(deck, {
      client: t.client,
      caches: t.caches,
      includeBasics: false,
    });
    expect(result.error).toMatch(/rate limiting/);
    expect(result.rows.find((r) => r.name === "Sol Ring")?.printing).toBeDefined();
    expect(result.rows.find((r) => r.name === "Sol Ring")?.alternatives).toBeUndefined();
  });
});
