import type { MatchConfidence, StorefrontMatch } from "./storeFinder";
import type { FetchFn, GeoPoint, StoreAddress, WpnStore } from "./types";

/**
 * Published list of known TCGplayer Pro storefronts (`data/storefronts.json`),
 * built weekly by the crawler (src/crawler) and read by the extension.
 */
export interface Directory {
  generatedAt: string;
  storefronts: DirectoryStorefront[];
  /** WPN store IDs the crawler has already checked, with or without a storefront. */
  checkedWpnStoreIds: string[];
}

export interface DirectoryStorefront {
  /** Storefront origin, e.g. "https://dmcomics.tcgplayerpro.com". */
  url: string;
  name: string;
  /** TCGplayer seller key (lowercase); identifies the store across sources. */
  sellerKey?: string;
  address?: StoreAddress;
  phone?: string;
  /**
   * Has a shop you can visit: a WPN location or a street address. False for
   * online-only sellers (no address, or a PO box). Missing in older directories.
   */
  physical?: boolean;
  /** Physical locations (several when one storefront serves multiple branches). */
  locations: DirectoryLocation[];
  /** How the storefront was found: "guess", "homepage", "custom-domain", "commoncrawl", "manual". */
  sources: string[];
  firstSeen: string;
  lastSeen: string;
}

export interface DirectoryLocation {
  latitude: number;
  longitude: number;
  storeName: string;
  postalAddress: string;
  /** WPN store this location came from; absent when geocoded from the storefront's ZIP. */
  wpnStoreId?: string;
  confidence: MatchConfidence | "geocoded";
}

export const DIRECTORY_URL =
  "https://raw.githubusercontent.com/Kyle-Bolin/card-finder/main/data/storefronts.json";

export const METERS_PER_MILE = 1609.344;

const EARTH_RADIUS_METERS = 6_371_000;

/** Great-circle distance in meters. */
export function distanceMeters(a: GeoPoint, b: GeoPoint): number {
  const rad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = rad(b.latitude - a.latitude);
  const dLng = rad(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(h)));
}

export async function fetchDirectory(fetchFn: FetchFn = fetch): Promise<Directory | null> {
  try {
    const res = await fetchFn(DIRECTORY_URL, { cache: "no-cache" });
    if (!res.ok) return null;
    const data = (await res.json()) as Directory;
    return Array.isArray(data.storefronts) ? data : null;
  } catch {
    return null;
  }
}

/**
 * Storefront locations within `maxMeters` of a point, as finder matches nearest first.
 * A storefront with several branches in range appears once per branch.
 */
export function nearbyFromDirectory(
  directory: Directory,
  point: GeoPoint,
  maxMeters: number,
  { includeOnlineOnly = false }: { includeOnlineOnly?: boolean } = {},
): StorefrontMatch[] {
  const matches: StorefrontMatch[] = [];
  for (const sf of directory.storefronts) {
    if (sf.physical === false && !includeOnlineOnly) continue;
    for (const loc of sf.locations) {
      const distance = distanceMeters(point, loc);
      if (distance > maxMeters) continue;
      const store: WpnStore = {
        id: loc.wpnStoreId ?? sf.url,
        name: loc.storeName,
        postalAddress: loc.postalAddress,
        latitude: loc.latitude,
        longitude: loc.longitude,
        distance,
        phoneNumber: sf.phone ?? null,
        website: sf.url,
      };
      matches.push({
        store,
        site: { url: sf.url, name: sf.name, address: sf.address, phone: sf.phone },
        confidence: loc.confidence === "possible" ? "possible" : "confirmed",
      });
    }
  }
  return matches.sort((a, b) => a.store.distance - b.store.distance);
}
