/** A TCGplayer Pro storefront the user has chosen to check. */
export interface Store {
  /** Origin of the storefront, e.g. "https://dmcomics.tcgplayerpro.com". */
  url: string;
  name: string;
  address?: StoreAddress;
  phone?: string;
  hours?: string;
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
}

export interface GeoPoint {
  latitude: number;
  longitude: number;
  label?: string;
}

export type FetchFn = typeof fetch;
