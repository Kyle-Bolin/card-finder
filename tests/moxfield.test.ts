import { describe, expect, it } from "vitest";
import { deckApiUrl, extractWanted, parseDeckId } from "../src/lib/moxfield";
import { summarizeDeck } from "../src/lib/moxfieldDiagnostic";
import { fixture } from "./helpers";

describe("parseDeckId", () => {
  it.each([
    ["https://moxfield.com/decks/6bUjMtA1NUiqQYvr8uqXBg", "6bUjMtA1NUiqQYvr8uqXBg"],
    ["/decks/6bUjMtA1NUiqQYvr8uqXBg/primer", "6bUjMtA1NUiqQYvr8uqXBg"],
    ["/decks/abc-DEF_123456?tab=stats", "abc-DEF_123456"],
  ])("%s → %s", (input, expected) => {
    expect(parseDeckId(input)).toBe(expected);
  });

  it.each(["/decks/public", "/decks/personal", "/", "/users/someone"])("no deck in %s", (input) => {
    expect(parseDeckId(input)).toBeNull();
  });

  it("builds the API URL", () => {
    expect(deckApiUrl("abc12345")).toBe("https://api2.moxfield.com/v3/decks/all/abc12345");
  });
});

describe("summarizeDeck", () => {
  // Shape assumed from Moxfield's v3 deck JSON; the #2 spike confirms it in Safari.
  const deck = {
    name: "Test Deck",
    boards: {
      mainboard: {
        count: 2,
        cards: {
          a: { quantity: 1, card: { name: "Sol Ring" } },
          b: { quantity: 1, card: { name: "Rhystic Study" } },
        },
      },
      maybeboard: { count: 1, cards: { c: { quantity: 1, card: { name: "Smothering Tithe" } } } },
    },
    authorTags: {
      "Rhystic Study": ["Draw", "Unowned"],
      "Smothering Tithe": ["unowned"],
      "Sol Ring": ["ramp"],
    },
  };

  it("finds tagged cards in any board, case-insensitively", () => {
    const summary = summarizeDeck(deck, "unowned");
    expect(summary.deckName).toBe("Test Deck");
    expect(summary.boards).toEqual([
      { name: "mainboard", cards: 2 },
      { name: "maybeboard", cards: 1 },
    ]);
    expect(summary.tagLocations).toContain("authorTags");
    expect(summary.taggedCards).toEqual([
      { name: "Rhystic Study", board: "mainboard", tags: ["Draw", "Unowned"] },
      { name: "Smothering Tithe", board: "maybeboard", tags: ["unowned"] },
    ]);
  });

  it("tolerates unexpected shapes", () => {
    expect(summarizeDeck(null, "unowned")).toMatchObject({ boards: [], taggedCards: [] });
    expect(summarizeDeck({ boards: "nope", authorTags: [] }, "unowned").taggedCards).toEqual([]);
  });
});

// A real v3 response for the test deck (saved from Safari), trimmed to the fields we read.
describe("real deck snapshot", () => {
  const deck = fixture("moxfield/deck_with_tags.json");

  it("finds every card tagged unowned, all in Considering", () => {
    const wanted = extractWanted(deck, "unowned");
    expect(wanted.map((w) => w.name)).toEqual([
      "Abdel Adrian, Gorion's Ward",
      "Arid Archway",
      "Cloudshift",
      "Eiganjo, Seat of the Empire",
      "Exalted Sunborn",
      "Justiciar's Portal",
      "Lazotep Quarry",
      "Pearl Medallion",
      "Phelia, Exuberant Shepherd",
      "Ranger-Captain of Eos",
      "Sword of Hearth and Home",
      "The Mind Stone",
      "White Plume Adventurer",
    ]);
    for (const w of wanted) {
      expect(w.quantity).toBe(1);
      expect(w.sources).toEqual(["White Value[Bracket 3] (considering)"]);
    }
  });

  it("ignores the deck's other tags", () => {
    expect(extractWanted(deck, "Add").length).toBeGreaterThan(0);
    expect(extractWanted(deck, "nonexistent")).toEqual([]);
  });
});
