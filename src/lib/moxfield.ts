import type { WantedCard } from "./types";

/** Public deck ID from a Moxfield deck URL or path ("/decks/6bUjMtA1NUiqQYvr8uqXBg" → "6bUjMtA1NUiqQYvr8uqXBg"). */
export function parseDeckId(urlOrPath: string): string | null {
  const match = urlOrPath.match(/\/decks\/([A-Za-z0-9_-]{8,})(?:[/?#]|$)/);
  if (!match?.[1] || match[1] === "public" || match[1] === "personal") return null;
  return match[1];
}

export function deckApiUrl(deckId: string): string {
  return `https://api2.moxfield.com/v3/decks/all/${deckId}`;
}

type Json = unknown;
const isObject = (v: Json): v is Record<string, Json> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

interface RawDeckCard {
  name: string;
  board: string;
  quantity: number;
  set?: string;
  cn?: string;
}

/** Every card in the deck with its board and quantity, across the v3 (`boards`) and v2 layouts. */
function deckCards(deck: Record<string, Json>): RawDeckCard[] {
  const cards: RawDeckCard[] = [];
  const add = (board: string, entries: Json) => {
    if (!isObject(entries)) return;
    for (const [key, entry] of Object.entries(entries)) {
      if (!isObject(entry)) continue;
      const card = entry.card;
      const name = isObject(card) && typeof card.name === "string" ? card.name : key;
      cards.push({
        name,
        board,
        quantity: typeof entry.quantity === "number" ? entry.quantity : 1,
        ...(isObject(card) && typeof card.set === "string" && card.set ? { set: card.set } : {}),
        ...(isObject(card) && card.cn !== undefined && card.cn !== null && card.cn !== ""
          ? { cn: String(card.cn) }
          : {}),
      });
    }
  };
  if (isObject(deck.boards)) {
    for (const [board, value] of Object.entries(deck.boards)) {
      if (isObject(value)) add(board, value.cards);
    }
  } else {
    for (const board of [
      "commanders",
      "companions",
      "mainboard",
      "sideboard",
      "maybeboard",
      "attractions",
      "stickers",
    ]) {
      add(board, deck[board]);
    }
  }
  return cards;
}

const BOARD_LABELS: Record<string, string> = { maybeboard: "considering" };

/**
 * Cards carrying `tag` (case-insensitive) in any board of a Moxfield deck,
 * from the deck's `authorTags` ({ "Card Name": ["tag", …] }).
 */
function taggedNames(deck: Record<string, Json>, tag: string): Set<string> {
  const wantedTag = tag.trim().toLowerCase();
  const tags = isObject(deck.authorTags) ? deck.authorTags : {};
  return new Set(
    Object.entries(tags)
      .filter(
        ([, list]) =>
          Array.isArray(list) &&
          list.some((t) => typeof t === "string" && t.toLowerCase() === wantedTag),
      )
      .map(([name]) => name),
  );
}

export function extractWanted(deck: Json, tag: string): WantedCard[] {
  if (!isObject(deck)) return [];
  const tagged = taggedNames(deck, tag);
  const deckName = typeof deck.name === "string" ? deck.name : "Deck";
  const wanted = new Map<string, WantedCard>();
  for (const { name, board, quantity } of deckCards(deck)) {
    if (!tagged.has(name)) continue;
    const source = `${deckName} (${BOARD_LABELS[board] ?? board})`;
    const existing = wanted.get(name);
    if (existing) {
      existing.quantity = Math.max(existing.quantity, quantity);
      if (!existing.sources.includes(source)) existing.sources.push(source);
    } else {
      wanted.set(name, { name, quantity, sources: [source] });
    }
  }
  return [...wanted.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** Boards that make up the deck you play; the maybeboard, sideboard and tokens don't count. */
const PLAYED_BOARDS = ["commanders", "companions", "mainboard"];

/** The played deck as "1 Card Name" lines, commanders first. */
export function deckList(deck: Json): string[] {
  if (!isObject(deck)) return [];
  const counts = new Map<string, number>();
  const cards = deckCards(deck).filter((c) => PLAYED_BOARDS.includes(c.board));
  cards.sort((a, b) => PLAYED_BOARDS.indexOf(a.board) - PLAYED_BOARDS.indexOf(b.board));
  for (const { name, quantity } of cards) counts.set(name, (counts.get(name) ?? 0) + quantity);
  return [...counts].map(([name, quantity]) => `${quantity} ${name}`);
}

/** A card of the played deck, with the printing Moxfield lists for it. */
export interface PlayedCard {
  name: string;
  quantity: number;
  /** Set code and collector number of the deck's printing, when Moxfield has them. */
  set?: string;
  cn?: string;
  /** Carries the signed tag, so it is left out of the artists page. */
  signed: boolean;
}

/** The played deck, one entry per card name and printing, commanders first. */
export function playedCards(deck: Json, signedTag = "signed"): PlayedCard[] {
  if (!isObject(deck)) return [];
  const signed = taggedNames(deck, signedTag);
  const cards = deckCards(deck).filter((c) => PLAYED_BOARDS.includes(c.board));
  cards.sort((a, b) => PLAYED_BOARDS.indexOf(a.board) - PLAYED_BOARDS.indexOf(b.board));
  const merged = new Map<string, PlayedCard>();
  for (const { name, quantity, set, cn } of cards) {
    const key = `${name}\u0000${set ?? ""}\u0000${cn ?? ""}`;
    const existing = merged.get(key);
    if (existing) existing.quantity += quantity;
    else {
      merged.set(key, {
        name,
        quantity,
        ...(set ? { set } : {}),
        ...(cn ? { cn } : {}),
        signed: signed.has(name),
      });
    }
  }
  return [...merged.values()];
}
