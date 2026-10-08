/** The e-commerce platform behind a store; missing means "tcgplayerpro". */
export type StorePlatform = "tcgplayerpro" | "shopify";

/** A storefront the user has chosen to check. */
export interface Store {
  /** Origin of the storefront, e.g. "https://dmcomics.tcgplayerpro.com". */
  url: string;
  name: string;
  /** Missing in stores saved before other platforms were supported: TCGplayer Pro. */
  platform?: StorePlatform;
  address?: StoreAddress;
  phone?: string;
  hours?: string;
  latitude?: number;
  longitude?: number;
}

export interface StoreAddress {
  street: string;
  city: string;
  state: string;
  zip: string;
}

/** Store details from a storefront's `GET /api/site`. */
export interface StoreSite {
  url: string;
  name: string;
  platform?: StorePlatform;
  address?: StoreAddress;
  phone?: string;
  hours?: string;
  email?: string;
  sellerKey?: string;
}

/** A store from the Wizards Store & Event Locator (WPN). */
export interface WpnStore {
  id: string;
  name: string;
  postalAddress: string;
  latitude: number;
  longitude: number;
  /** Distance from the search point, in meters. */
  distance: number;
  phoneNumber: string | null;
  website: string | null;
  emailAddress?: string | null;
  /** Whether the store chose to show its email publicly in the locator. */
  showEmailInSEL?: boolean | null;
}

export interface GeoPoint {
  latitude: number;
  longitude: number;
  label?: string;
}

export type FetchFn = typeof fetch;

/** A card the user wants, from a Moxfield deck or a pasted list. */
export interface WantedCard {
  name: string;
  quantity: number;
  /** Where it came from, e.g. "Atraxa (maybeboard)"; empty for pasted lists. */
  sources: string[];
}

export type Condition = "NM" | "LP" | "MP" | "HP" | "DMG";

/** One in-stock SKU of a card at a store. */
export interface Listing {
  storeUrl: string;
  /** The wanted card this listing matches. */
  cardName: string;
  /** The store's product name, e.g. "Lightning Bolt (Borderless)". */
  productName: string;
  setName: string;
  condition: Condition | string;
  language: string;
  foil: boolean;
  price: number;
  /** Copies in stock; missing when the store only says "in stock" (Shopify). */
  quantity?: number;
  url: string;
}
