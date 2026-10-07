import { describe, expect, it } from "vitest";
import { deckList } from "../src/lib/moxfield";
import { edhPowerLevelUrl } from "../src/lib/powerLevel";
import { fixture } from "./helpers";

describe("edhPowerLevelUrl", () => {
  it("encodes lines the way the site's button does", () => {
    expect(edhPowerLevelUrl(["1 Sol Ring", "1 Swords to Plowshares"])).toBe(
      "https://edhpowerlevel.com?d=1+Sol+Ring~1+Swords+to+Plowshares~Z~",
    );
  });

  it("drops set codes, bracketed notes and blank lines", () => {
    expect(
      edhPowerLevelUrl(["1 Sol Ring (CMR) 472 *F*", "1 Cloudshift [Blink]", "  ", "1 Plains <x>"]),
    ).toBe("https://edhpowerlevel.com?d=1+Sol+Ring~1+Cloudshift~1+Plains~Z~");
  });

  it("escapes punctuation in card names", () => {
    expect(edhPowerLevelUrl(["1 Justiciar's Portal", "1 Eiganjo, Seat of the Empire"])).toBe(
      "https://edhpowerlevel.com?d=1+Justiciar's+Portal~1+Eiganjo%2C+Seat+of+the+Empire~Z~",
    );
  });
});

describe("deckList", () => {
  const deck = fixture("moxfield/deck_with_tags.json");

  it("lists the played deck, commanders first, without the Considering board", () => {
    const lines = deckList(deck);
    const total = lines.reduce((n, line) => n + Number(line.split(" ")[0]), 0);
    expect(total).toBe(100);
    const commander = Object.values(
      (deck as { boards: { commanders: { cards: Record<string, { card: { name: string } }> } } })
        .boards.commanders.cards,
    )[0]!.card.name;
    expect(lines[0]).toBe(`1 ${commander}`);
    // Cards only in Considering are not part of the deck.
    expect(lines.some((line) => line.endsWith(" Ranger-Captain of Eos"))).toBe(false);
  });

  it("returns nothing for non-decks", () => {
    expect(deckList(null)).toEqual([]);
  });
});
