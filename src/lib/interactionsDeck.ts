/** Where the content script leaves a deck's card names for the interactions page, keyed by deck ID. */
export const INTERACTIONS_KEY_PREFIX = "interactions:deck:";

export interface InteractionsDeck {
  name: string;
  /** Names of the played cards (commanders, companions, mainboard). */
  cards: string[];
}
