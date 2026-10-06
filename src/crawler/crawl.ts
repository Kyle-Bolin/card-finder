import type { Directory, DirectoryLocation, DirectoryStorefront } from "../lib/directory";
import {
  mapLimit,
  matchConfidence,
  nearbyWpnStores,
  phoneKey,
  similarStoreNames,
  subdomainGuesses,
  zipFromAddress,
  zipToLocation,
  type MatchConfidence,
} from "../lib/storeFinder";
import { getSite } from "../lib/tcgplayerpro";
import type { FetchFn, GeoPoint, StoreAddress, StoreSite, WpnStore } from "../lib/types";
import { scanHomepage } from "./homepage";
import { collectProSellers, type ProSeller } from "./marketplace";

/** Crawler bookkeeping kept between runs (data/crawl-state.json). */
export interface CrawlState {
  version: 1;
  /** Per WPN store: when we last looked, and what we found. */
  wpn: Record<
    string,
    { checkedAt: string; storefront?: string; confidence?: MatchConfidence; source?: string }
  >;
  /** Per TCGplayer Pro marketplace seller (by seller key): when we last looked, and what we found. */
  sellers?: Record<string, { checkedAt: string; storefront?: string }>;
  /** Pro sellers from the last marketplace collection, reused for a few days (resumed runs). */
  proSellerCache?: { collectedAt: string; sellers: ProSeller[] };
  /** Consecutive runs a known storefront returned 404. */
  misses: Record<string, number>;
}

export const EMPTY_STATE: CrawlState = { version: 1, wpn: {}, sellers: {}, misses: {} };

/** A storefront known from elsewhere (Common Crawl, manual submissions). */
export interface SeedStorefront {
  url: string;
  source: string;
}

/** Circles that together cover the US and southern Canada. */
export const COVERAGE: { point: GeoPoint; miles: number }[] = [
  { point: { latitude: 39.8283, longitude: -98.5795, label: "contiguous US" }, miles: 3000 },
  { point: { latitude: 61.2181, longitude: -149.9003, label: "Alaska" }, miles: 1000 },
  { point: { latitude: 21.3069, longitude: -157.8583, label: "Hawaii" }, miles: 400 },
];

export interface CrawlOptions {
  fetchFn: FetchFn;
  now?: Date;
  /** Only crawl around this point (local testing). Entries elsewhere are kept as-is. */
  region?: { point: GeoPoint; miles: number };
  /** Re-check WPN stores without a storefront after this many days. */
  recheckDays?: number;
  /** Stop discovery after this many WPN stores / sellers (testing). */
  limit?: number;
  /** Find Pro sellers via the best sellers of these product lines. Omit to skip. */
  marketplace?: { productLines: string[]; productsPerLine: number };
  concurrency?: number;
  log?: (message: string) => void;
  /** Called with the in-progress state every 100 checks and after each phase, so an
   *  interrupted run can resume where it left off. */
  checkpoint?: (state: CrawlState) => void;
}

const SELLER_CACHE_DAYS = 3;
/** Sources whose WPN links come from the ZIP/phone fallback rather than discovery. */
const FALLBACK_SOURCES = new Set(["marketplace", "commoncrawl", "seed"]);

export interface CrawlStats {
  wpnStores: number;
  proSellers: number;
  checkedThisRun: number;
  verified: number;
  newStorefronts: string[];
  removedStorefronts: string[];
  total: number;
}

const DROP_AFTER_MISSES = 2;

function daysBetween(a: Date, b: Date): number {
  return Math.abs(a.getTime() - b.getTime()) / 86_400_000;
}

/** A real storefront (vs. some other site answering /api/site) has a seller key. */
function isStorefront(site: StoreSite | null): site is StoreSite {
  return !!site?.sellerKey;
}

/** Storefront for a Pro seller: guess from its name, accept only an exact seller-key match. */
export async function discoverSellerStorefront(
  seller: ProSeller,
  fetchFn: FetchFn,
): Promise<StoreSite | null> {
  for (const sub of subdomainGuesses({ name: seller.name })) {
    const site = await trySite(`https://${sub}.tcgplayerpro.com`, fetchFn);
    if (site?.sellerKey?.toLowerCase() === seller.sellerKey) return site;
  }
  return null;
}

async function trySite(url: string, fetchFn: FetchFn): Promise<StoreSite | null> {
  try {
    const site = await getSite(url, fetchFn);
    return isStorefront(site) ? site : null;
  } catch {
    return null;
  }
}

/** Find a storefront for one WPN store: name guesses, then homepage links, then custom domains. */
export async function discoverStorefront(
  store: WpnStore,
  fetchFn: FetchFn,
): Promise<{ site: StoreSite; confidence: MatchConfidence; source: string } | null> {
  for (const sub of subdomainGuesses(store)) {
    const site = await trySite(`https://${sub}.tcgplayerpro.com`, fetchFn);
    const confidence = site && matchConfidence(store, site);
    if (site && confidence) return { site, confidence, source: "guess" };
  }
  const scan = await scanHomepage(store.website, fetchFn);
  for (const url of scan.storefronts) {
    const site = await trySite(url, fetchFn);
    // The store's own site linking to a storefront is strong evidence even if details differ.
    if (site)
      return { site, confidence: matchConfidence(store, site) ?? "possible", source: "homepage" };
  }
  for (const url of scan.customDomainCandidates) {
    const site = await trySite(url, fetchFn);
    if (site)
      return {
        site,
        confidence: matchConfidence(store, site) ?? "possible",
        source: "custom-domain",
      };
  }
  return null;
}

/** Coordinates for a US city ("Nashua", "NH"), via zippopotam.us. */
async function cityToLocation(
  city: string,
  state: string,
  fetchFn: FetchFn,
): Promise<GeoPoint | null> {
  try {
    const res = await fetchFn(
      `https://api.zippopotam.us/us/${encodeURIComponent(state.toLowerCase())}/${encodeURIComponent(city.toLowerCase())}`,
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { places?: { latitude: string; longitude: string }[] };
    const place = data.places?.[0];
    return place ? { latitude: Number(place.latitude), longitude: Number(place.longitude) } : null;
  } catch {
    return null;
  }
}

/** Evidence that a storefront is this WPN store: same phone, or same ZIP and a similar name. */
export function isSameStore(store: WpnStore, site: StoreSite): boolean {
  const phone = phoneKey(store.phoneNumber);
  if (phone.length === 10 && phone === phoneKey(site.phone)) return true;
  const zip = site.address?.zip?.slice(0, 5);
  return (
    !!zip && zip === zipFromAddress(store.postalAddress) && similarStoreNames(store.name, site.name)
  );
}

/** A street address a customer could visit (not missing, not a PO box). */
export function hasStreetAddress(address: StoreAddress | undefined): boolean {
  const street = address?.street?.trim() ?? "";
  return /^\d+\s+\S/.test(street) && !/\bp\.?\s*o\.?\s*box\b/i.test(street);
}

function locationFor(store: WpnStore, confidence: MatchConfidence): DirectoryLocation {
  return {
    latitude: store.latitude,
    longitude: store.longitude,
    storeName: store.name,
    postalAddress: store.postalAddress.replace(/\s*\n\s*/g, ", "),
    wpnStoreId: store.id,
    confidence,
  };
}

export async function crawl(
  previous: Directory | null,
  previousState: CrawlState,
  seeds: SeedStorefront[],
  options: CrawlOptions,
): Promise<{ directory: Directory; state: CrawlState; stats: CrawlStats }> {
  const {
    fetchFn,
    region,
    recheckDays = 30,
    limit,
    concurrency = 4,
    log = () => {},
    checkpoint = () => {},
  } = options;
  const now = options.now ?? new Date();
  const nowIso = now.toISOString();
  const state: CrawlState = structuredClone(previousState);
  const prevByUrl = new Map((previous?.storefronts ?? []).map((s) => [s.url, s]));

  // 1. Every WPN store in scope.
  const wpn = new Map<string, WpnStore>();
  for (const circle of region ? [region] : COVERAGE) {
    log(`Fetching WPN stores within ${circle.miles} mi of ${circle.point.label ?? "point"}…`);
    for (const store of await nearbyWpnStores(circle.point, circle.miles, fetchFn, {
      pageSize: 1000,
      maxPages: 50,
    })) {
      wpn.set(store.id, store);
    }
  }
  log(`${wpn.size} WPN stores`);

  // 2. Discover storefronts for WPN stores not checked recently.
  const due = [...wpn.values()].filter((store) => {
    const entry = state.wpn[store.id];
    if (!entry) return true;
    if (entry.storefront) return false; // re-verified below instead
    return daysBetween(new Date(entry.checkedAt), now) >= recheckDays;
  });
  const toCheck = limit === undefined ? due : due.slice(0, limit);
  log(`Checking ${toCheck.length} stores for storefronts (${due.length} due)…`);
  let done = 0;
  await mapLimit(toCheck, concurrency, async (store) => {
    const found = await discoverStorefront(store, fetchFn);
    state.wpn[store.id] = found
      ? {
          checkedAt: nowIso,
          storefront: found.site.url,
          confidence: found.confidence,
          source: found.source,
        }
      : { checkedAt: nowIso };
    if (++done % 100 === 0) {
      log(`  ${done}/${toCheck.length}`);
      checkpoint(state);
    }
  });
  checkpoint(state);

  // 2b. Discover storefronts for TCGplayer Pro marketplace sellers (not limited to WPN stores).
  state.sellers ??= {};
  const sellerState = state.sellers;
  const sellerByUrl = new Map<string, ProSeller>();
  let proSellers = new Map<string, ProSeller>();
  if (options.marketplace) {
    const { productLines, productsPerLine } = options.marketplace;
    log(
      `Collecting Pro sellers from ${productsPerLine} best sellers of ${productLines.join(", ")}…`,
    );
    const cache = state.proSellerCache;
    if (cache && daysBetween(new Date(cache.collectedAt), now) < SELLER_CACHE_DAYS) {
      log(`  reusing ${cache.sellers.length} sellers collected ${cache.collectedAt}`);
      proSellers = new Map(cache.sellers.map((seller) => [seller.sellerKey, seller]));
    } else {
      proSellers = await collectProSellers(productLines, productsPerLine, fetchFn, log);
      state.proSellerCache = { collectedAt: nowIso, sellers: [...proSellers.values()] };
      checkpoint(state);
    }
    const knownKeys = new Set(
      (previous?.storefronts ?? []).flatMap((s) => (s.sellerKey ? [s.sellerKey] : [])),
    );
    const dueSellers = [...proSellers.values()].filter((seller) => {
      if (knownKeys.has(seller.sellerKey)) return false;
      const entry = sellerState[seller.sellerKey];
      if (!entry) return true;
      if (entry.storefront) return false;
      return daysBetween(new Date(entry.checkedAt), now) >= recheckDays;
    });
    const sellersToCheck = limit === undefined ? dueSellers : dueSellers.slice(0, limit);
    log(`${proSellers.size} Pro sellers; checking ${sellersToCheck.length} for storefronts…`);
    let sellersDone = 0;
    await mapLimit(sellersToCheck, concurrency, async (seller) => {
      const site = await discoverSellerStorefront(seller, fetchFn);
      sellerState[seller.sellerKey] = site
        ? { checkedAt: nowIso, storefront: site.url }
        : { checkedAt: nowIso };
      if (++sellersDone % 100 === 0) {
        log(`  ${sellersDone}/${sellersToCheck.length}`);
        checkpoint(state);
      }
    });
    checkpoint(state);
  }
  for (const [key, entry] of Object.entries(sellerState)) {
    const seller = proSellers.get(key);
    if (entry.storefront && seller) sellerByUrl.set(entry.storefront, seller);
  }

  // 3. Verify every storefront we know about.
  const urls = new Set<string>([
    ...prevByUrl.keys(),
    ...seeds.map((s) => s.url),
    ...Object.values(state.wpn).flatMap((e) => (e.storefront ? [e.storefront] : [])),
    ...Object.values(sellerState).flatMap((e) => (e.storefront ? [e.storefront] : [])),
  ]);
  log(`Verifying ${urls.size} storefronts…`);
  const sites = new Map<string, StoreSite>();
  const removed: string[] = [];
  /** Old storefront URL → new one, for stores that renamed their subdomain (it redirects). */
  const renamed = new Map<string, string>();
  await mapLimit([...urls], concurrency, async (url) => {
    let site: StoreSite | null = null;
    let gone = false;
    try {
      const result = await getSite(url, fetchFn);
      gone = result === null;
      site = isStorefront(result) ? result : null;
    } catch {
      // Network trouble: keep the previous entry, don't count as a miss.
    }
    if (site) {
      sites.set(site.url, site);
      if (site.url !== url) renamed.set(url, site.url);
      delete state.misses[url];
    } else if (gone) {
      state.misses[url] = (state.misses[url] ?? 0) + 1;
      if (state.misses[url] >= DROP_AFTER_MISSES) removed.push(url);
    }
  });
  for (const [from, to] of renamed) {
    urls.delete(from);
    urls.add(to);
    for (const entry of [...Object.values(state.wpn), ...Object.values(sellerState)]) {
      if (entry.storefront === from) entry.storefront = to;
    }
  }
  if (renamed.size) log(`${renamed.size} storefronts were renamed`);
  const canonical = (url: string) => renamed.get(url) ?? url;
  // Previous entries keyed by their current URL (renamed ones carry their history over).
  const prevByCanonical = new Map<string, DirectoryStorefront>();
  for (const [url, prev] of prevByUrl) {
    if (!prevByCanonical.has(canonical(url))) prevByCanonical.set(canonical(url), prev);
  }

  for (const url of removed) {
    delete state.misses[url];
    for (const entry of Object.values(sellerState)) {
      if (entry.storefront === url) delete entry.storefront;
    }
    for (const entry of Object.values(state.wpn)) {
      if (entry.storefront === url) {
        delete entry.storefront;
        delete entry.confidence;
        delete entry.source;
      }
    }
  }

  // 4. Locations: WPN stores linked to each storefront.
  const locations = new Map<string, DirectoryLocation[]>();
  const sources = new Map<string, Set<string>>();
  const addSource = (url: string, source: string) =>
    sources.set(url, (sources.get(url) ?? new Set()).add(source));
  for (const [id, entry] of Object.entries(state.wpn)) {
    const store = wpn.get(id);
    if (!entry.storefront || !store || removed.includes(entry.storefront)) continue;
    // Links made by the ZIP/phone fallback (not by discovering the storefront from
    // this store's own name or website) must still hold up; older runs accepted a
    // shared ZIP alone.
    const site = sites.get(entry.storefront);
    if (site && FALLBACK_SOURCES.has(entry.source ?? "") && !isSameStore(store, site)) {
      delete entry.storefront;
      delete entry.confidence;
      delete entry.source;
      continue;
    }
    const list = locations.get(entry.storefront) ?? [];
    list.push(locationFor(store, entry.confidence ?? "possible"));
    locations.set(entry.storefront, list);
    addSource(entry.storefront, entry.source ?? "guess");
  }
  for (const seed of seeds) addSource(canonical(seed.url), seed.source);
  for (const entry of Object.values(sellerState)) {
    if (entry.storefront) addSource(entry.storefront, "marketplace");
  }

  // Region runs only see part of the WPN list: keep earlier locations from outside it.
  if (region) {
    for (const [url, prev] of prevByCanonical) {
      const kept = prev.locations.filter((l) => !l.wpnStoreId || !wpn.has(l.wpnStoreId));
      if (kept.length) locations.set(url, [...(locations.get(url) ?? []), ...kept]);
      prev.sources.forEach((s) => addSource(url, s));
    }
  }

  // Storefronts with no WPN location: match by ZIP/phone, else geocode their ZIP.
  const byZip = new Map<string, WpnStore[]>();
  const byPhone = new Map<string, WpnStore[]>();
  for (const store of wpn.values()) {
    const zip = zipFromAddress(store.postalAddress);
    if (zip) byZip.set(zip, [...(byZip.get(zip) ?? []), store]);
    const phone = phoneKey(store.phoneNumber);
    if (phone.length === 10) byPhone.set(phone, [...(byPhone.get(phone) ?? []), store]);
  }
  const zipCache = new Map<string, GeoPoint | null>();
  for (const [url, site] of sites) {
    if (locations.get(url)?.length) continue;
    const zip = site.address?.zip?.slice(0, 5);
    const candidates = [
      ...(byPhone.get(phoneKey(site.phone)) ?? []),
      ...(zip ? (byZip.get(zip) ?? []) : []),
    ];
    // Only claim a WPN store's location with real evidence: a matching phone, or the
    // same ZIP and a similar name. A shared ZIP alone (e.g. an online seller near a
    // GameStop) is not enough.
    const match = candidates.find((store) => isSameStore(store, site));
    if (match) {
      locations.set(url, [locationFor(match, "confirmed")]);
      state.wpn[match.id] = {
        checkedAt: nowIso,
        storefront: url,
        confidence: "confirmed",
        source: [...(sources.get(url) ?? ["seed"])][0],
      };
      continue;
    }
    const prev = prevByCanonical.get(url);
    if (prev?.locations.length && prev.address?.zip === site.address?.zip) {
      locations.set(url, prev.locations); // already geocoded on an earlier run
      continue;
    }
    let point: GeoPoint | null = null;
    if (zip && /^\d{5}$/.test(zip)) {
      if (!zipCache.has(zip))
        zipCache.set(zip, await zipToLocation(zip, fetchFn).catch(() => null));
      point = zipCache.get(zip) ?? null;
    }
    const seller = sellerByUrl.get(url);
    if (!point && seller?.city && seller.state) {
      point = await cityToLocation(seller.city, seller.state, fetchFn);
    }
    if (point) {
      const a = site.address;
      locations.set(url, [
        {
          latitude: point.latitude,
          longitude: point.longitude,
          storeName: site.name,
          postalAddress: a
            ? [a.street, a.city, `${a.state} ${a.zip}`].filter(Boolean).join(", ")
            : [seller?.city, seller?.state].filter(Boolean).join(", "),
          confidence: "geocoded",
        },
      ]);
    }
  }

  // 5. Assemble the directory.
  const storefronts: DirectoryStorefront[] = [];
  const newStorefronts: string[] = [];
  for (const url of [...urls].sort()) {
    if (removed.includes(url)) continue;
    const prev = prevByCanonical.get(url);
    const site = sites.get(url);
    const locs = locations.get(url) ?? prev?.locations ?? [];
    const address = site?.address ?? prev?.address;
    if (!site && !prev) continue; // never verified
    if (!locs.length) continue; // nowhere to place it on a map
    if (!prev) newStorefronts.push(url);
    storefronts.push({
      url,
      name: site?.name ?? prev?.name ?? url,
      sellerKey: site?.sellerKey?.toLowerCase() ?? prev?.sellerKey,
      address,
      phone: site?.phone ?? prev?.phone,
      physical: locs.some((l) => l.wpnStoreId) || hasStreetAddress(address),
      locations: locs.sort((a, b) => a.storeName.localeCompare(b.storeName)),
      sources: [...(sources.get(url) ?? new Set(prev?.sources ?? []))].sort(),
      firstSeen: prev?.firstSeen ?? nowIso,
      lastSeen: site ? nowIso : (prev?.lastSeen ?? nowIso),
    });
  }

  const directory: Directory = {
    generatedAt: nowIso,
    storefronts,
    checkedWpnStoreIds: Object.keys(state.wpn).sort(),
  };
  const stats: CrawlStats = {
    wpnStores: wpn.size,
    proSellers: proSellers.size,
    checkedThisRun: toCheck.length,
    verified: sites.size,
    newStorefronts,
    removedStorefronts: removed.sort(),
    total: storefronts.length,
  };
  return { directory, state, stats };
}
