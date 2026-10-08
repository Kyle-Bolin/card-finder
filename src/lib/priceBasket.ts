/**
 * The fixed list of commonly played Commander singles that every store is priced on, so
 * stores that carry different cards can still be compared. Tune the list here: cached
 * prices are keyed by card name, so a changed card is simply fetched again.
 *
 * The tiers are rough (late-2020s retail, non-foil, NM) and only need to be a mix: cheap
 * staples show how a store prices bulk, pricier cards show how it prices the rest.
 */
export interface BasketCard {
  name: string;
  /** Why it's in the basket. */
  why: string;
}

export const PRICE_BASKET: readonly BasketCard[] = [
  // Cheap staples (under ~$5): in almost every store's stock, many printings.
  { name: "Sol Ring", why: "In nearly every Commander deck; a printing is always in stock" },
  { name: "Arcane Signet", why: "Universal mana rock with many printings" },
  { name: "Command Tower", why: "Staple land in every multicolor deck" },
  { name: "Swords to Plowshares", why: "Most-played white removal" },
  { name: "Counterspell", why: "Staple blue interaction" },
  { name: "Cultivate", why: "Common green ramp in countless decks" },
  { name: "Lightning Greaves", why: "Staple equipment" },
  { name: "Path to Exile", why: "Staple white removal" },
  { name: "Rampant Growth", why: "Basic green ramp, cheap and common" },
  { name: "Mind Stone", why: "Colorless mana rock" },
  { name: "Fellwar Stone", why: "Colorless mana rock" },
  { name: "Heroic Intervention", why: "Staple protection spell" },
  // Mid-range (~$5-20).
  { name: "Cyclonic Rift", why: "Top blue staple; mid-priced across printings" },
  { name: "Smothering Tithe", why: "Popular white enchantment; mid-priced" },
  { name: "Rhystic Study", why: "Popular blue enchantment; mid-priced" },
  { name: "Demonic Tutor", why: "Black tutor; mid-priced" },
  { name: "Swiftfoot Boots", why: "Staple equipment" },
  { name: "Nature's Lore", why: "Green ramp with tiered printings" },
  { name: "Farseek", why: "Green ramp, tiered printings" },
  { name: "Blasphemous Act", why: "Staple red sweeper" },
  { name: "Vampiric Tutor", why: "Black tutor; mid-priced" },
  // Pricier (~$30+): a store's markup shows most here.
  { name: "Mana Crypt", why: "Highest-priced staple; shows how a store prices the top end" },
  { name: "Gaea's Cradle", why: "Expensive land; $30+ in any printing" },
  { name: "Grim Monolith", why: "Expensive artifact; usually $30+" },
  { name: "Mana Vault", why: "Expensive artifact; usually $30+" },
] as const;

/** Stores with fewer basket cards than this are listed as "not enough data". */
export const MIN_BASKET_CARDS = 5;
