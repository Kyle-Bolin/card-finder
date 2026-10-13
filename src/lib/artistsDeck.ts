import type { ArtDeckCard } from "./scryfall";

/** Where the content script leaves a deck's cards for the artists page, keyed by deck ID. */
export const ARTISTS_KEY_PREFIX = "artists:deck:";

export interface ArtistsDeck {
  name: string;
  cards: ArtDeckCard[];
}
