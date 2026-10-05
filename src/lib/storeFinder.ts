import { getSite } from "./tcgplayerpro";
import type { FetchFn, GeoPoint, StoreSite, WpnStore } from "./types";

const WPN_GRAPHQL = "https://api.tabletop.wizards.com/silverbeak-griffin-service/graphql";
const METERS_PER_MILE = 1609.344;
const WPN_PAGE_SIZE = 100;
const MAX_WPN_PAGES = 20;

const STORES_BY_LOCATION = `query getStoresByLocation($latitude: Float!, $longitude: Float!, $maxMeters: Int!, $pageSize: Int, $page: Int) {
  storesByLocation(input: {latitude: $latitude, longitude: $longitude, maxMeters: $maxMeters, pageSize: $pageSize, page: $page}) {
    stores { id name postalAddress latitude longitude distance phoneNumber website emailAddress showEmailInSEL }
    pageInfo { page pageSize totalResults }
  }
}`;

interface StoresByLocationResponse {
  data?: {
    storesByLocation: {
      stores: WpnStore[];
      pageInfo: { page: number; pageSize: number; totalResults: number };
    };
  };
  errors?: { message: string }[];
}

/** Look up a US ZIP code's coordinates (zippopotam.us, free, no key). */
export async function zipToLocation(zip: string, fetchFn: FetchFn = fetch): Promise<GeoPoint> {
  const zip5 = zip.trim().slice(0, 5);
  if (!/^\d{5}$/.test(zip5)) throw new Error(`"${zip}" isn't a valid ZIP code`);
  const res = await fetchFn(`https://api.zippopotam.us/us/${zip5}`);
  if (res.status === 404) throw new Error(`ZIP code ${zip5} not found`);
  if (!res.ok) throw new Error(`ZIP lookup failed (HTTP ${res.status})`);
  const data = (await res.json()) as {
    places: {
      "place name": string;
      "state abbreviation": string;
      latitude: string;
      longitude: string;
    }[];
  };
  const place = data.places[0];
  if (!place) throw new Error(`ZIP code ${zip5} not found`);
  return {
    latitude: Number(place.latitude),
    longitude: Number(place.longitude),
    label: `${place["place name"]}, ${place["state abbreviation"]} ${zip5}`,
  };
}

/** All WPN stores within `miles` of a point, nearest first. */
export async function nearbyWpnStores(
  point: GeoPoint,
  miles: number,
  fetchFn: FetchFn = fetch,
): Promise<WpnStore[]> {
  const stores = new Map<string, WpnStore>();
  for (let page = 0; page < MAX_WPN_PAGES; page++) {
    const res = await fetchFn(WPN_GRAPHQL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        operationName: "getStoresByLocation",
        query: STORES_BY_LOCATION,
        variables: {
          latitude: point.latitude,
          longitude: point.longitude,
          maxMeters: Math.round(miles * METERS_PER_MILE),
          pageSize: WPN_PAGE_SIZE,
          page,
        },
      }),
    });
    if (!res.ok) throw new Error(`Store locator returned HTTP ${res.status}`);
    const body = (await res.json()) as StoresByLocationResponse;
    if (body.errors?.length) throw new Error(`Store locator error: ${body.errors[0]?.message}`);
    const result = body.data?.storesByLocation;
    if (!result) throw new Error("Store locator returned no data");
    const before = stores.size;
    for (const store of result.stores) stores.set(store.id, store);
    // Stop at the end, or if a page added nothing new (guards against the API ignoring `page`).
    if (stores.size === before || stores.size >= result.pageInfo.totalResults) break;
  }
  return [...stores.values()].sort((a, b) => a.distance - b.distance);
}

export function metersToMiles(meters: number): number {
  return meters / METERS_PER_MILE;
}

/** Big chains and generic hosts that never have their own TCGplayer Pro storefront. */
const SKIP_NAMES = /^(gamestop|barnes & noble|target|walmart)\b/i;
const GENERIC_HOSTS =
  /(^|\.)(wizards\.com|facebook\.com|instagram\.com|linktr\.ee|google\.com|square\.site|gamestop\.com|discord\.gg|discord\.com|tiktok\.com|x\.com|twitter\.com)$/;

function slug(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]/g, "");
}

/** Store name without a branch suffix: "Double Midnight Comics - Concord" → "Double Midnight Comics". */
export function baseStoreName(name: string): string {
  return name.replace(/\s+-\s+.*$/, "").trim();
}

const FREE_MAIL =
  /^(gmail|googlemail|yahoo|ymail|aol|outlook|hotmail|live|msn|icloud|me|mac|comcast|verizon|att|sbcglobal|charter|cox|protonmail|proton)\./;
const GENERIC_MAILBOXES =
  /^(info|contact|store|shop|sales|admin|hello|support|orders|owner|manager|events|games?|mail|office)$/;
/** Trailing words that are often dropped from a storefront subdomain. */
const COMPANY_SUFFIX = /\s+(llc|inc|co|ltd)\.?$/i;
const MAX_GUESSES = 8;

/** First host label of a store's website, unless it's a generic host (Facebook, Discord, …). */
function websiteLabel(website: string | null | undefined): string | undefined {
  const value = website?.trim();
  if (!value) return undefined;
  try {
    const host = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`).hostname
      .toLowerCase()
      .replace(/^www\./, "");
    if (GENERIC_HOSTS.test(host) || host.split(".").length < 2) return undefined;
    return host.split(".")[0];
  } catch {
    return undefined;
  }
}

/**
 * Name hint from a public store email: the domain for custom domains
 * (info@relentlessdragon.com → "relentlessdragon"), or the mailbox for free mail
 * (bazaargametrading@gmail.com → "bazaargametrading").
 */
function emailLabel(email: string | null | undefined): string | undefined {
  const match = email
    ?.trim()
    .toLowerCase()
    .match(/^([^@\s]+)@([^@\s]+\.[a-z]{2,})$/);
  if (!match) return undefined;
  const [, mailbox = "", domain = ""] = match;
  if (FREE_MAIL.test(domain)) {
    const local = mailbox.replace(/\+.*$/, "").replace(/[._-]/g, "");
    return local.length >= 4 && !GENERIC_MAILBOXES.test(local) ? local : undefined;
  }
  return websiteLabel(domain);
}

/**
 * The store name minus a trailing location that also appears in its address:
 * "The Relentless Dragon Nashua" (483 Amherst St, Nashua, NH) → "The Relentless Dragon".
 */
export function stripTrailingLocation(name: string, postalAddress: string | undefined): string {
  if (!postalAddress) return name;
  const addressWords = new Set(postalAddress.toLowerCase().match(/[a-z]+/g) ?? []);
  const words = name.split(/\s+/);
  while (words.length > 1 && addressWords.has((words.at(-1) ?? "").toLowerCase())) words.pop();
  return words.join(" ");
}

type GuessInput = Pick<WpnStore, "name"> &
  Partial<Pick<WpnStore, "website" | "postalAddress" | "emailAddress" | "showEmailInSEL">>;

/**
 * Candidate `{sub}.tcgplayerpro.com` subdomains for a WPN store, most likely first:
 * the website's host, the store's public email, then variations of the store name.
 * Emails are only used when the store has chosen to show them publicly.
 */
export function subdomainGuesses(store: GuessInput): string[] {
  if (SKIP_NAMES.test(store.name)) return [];
  const guesses: (string | undefined)[] = [websiteLabel(store.website)];
  if (store.showEmailInSEL) guesses.push(emailLabel(store.emailAddress));

  const base = baseStoreName(store.name).replace(COMPANY_SUFFIX, "");
  const core = stripTrailingLocation(base, store.postalAddress);
  for (const name of [base, core]) {
    guesses.push(slug(name));
    if (/^the\s/i.test(name)) guesses.push(slug(name.replace(/^the\s+/i, "")));
  }
  const valid = guesses.filter((g): g is string => !!g && /^[a-z0-9-]{2,63}$/.test(g));
  return [...new Set(valid)].slice(0, MAX_GUESSES);
}

function digits(value: string | null | undefined): string {
  return (value ?? "").replace(/\D/g, "");
}

/** Last 10 digits of a US phone number ("1603-669-9636" and "(603) 669-9636" both → "6036699636"). */
export function phoneKey(phone: string | null | undefined): string {
  return digits(phone).slice(-10);
}

/** First 5-digit ZIP found in a postal address string. */
export function zipFromAddress(address: string): string | undefined {
  return address
    .match(/\b(\d{5})(?:-\d{4})?\b/g)
    ?.pop()
    ?.slice(0, 5);
}

export type MatchConfidence = "confirmed" | "possible";

/**
 * How sure we are that a storefront belongs to a WPN store.
 * "confirmed": ZIP or phone matches. "possible": only the name matches
 * (e.g. another branch of the same chain sharing one storefront).
 */
export function matchConfidence(store: WpnStore, site: StoreSite): MatchConfidence | null {
  const wpnZip = zipFromAddress(store.postalAddress);
  const siteZip = site.address?.zip?.slice(0, 5);
  if (wpnZip && siteZip && wpnZip === siteZip) return "confirmed";
  const wpnPhone = phoneKey(store.phoneNumber);
  if (wpnPhone.length === 10 && wpnPhone === phoneKey(site.phone)) return "confirmed";
  const a = slug(baseStoreName(store.name));
  const b = slug(baseStoreName(site.name));
  if (a && b && (a === b || a.includes(b) || b.includes(a))) return "possible";
  return null;
}

export interface StorefrontMatch {
  store: WpnStore;
  site: StoreSite;
  confidence: MatchConfidence;
}

/** Run `fn` over `items` with at most `limit` in flight. */
export async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i] as T, i);
    }
  });
  await Promise.all(workers);
  return results;
}

/** Find a TCGplayer Pro storefront for one WPN store by probing subdomain guesses. */
export async function findStorefront(
  store: WpnStore,
  fetchFn: FetchFn = fetch,
): Promise<StorefrontMatch | null> {
  for (const sub of subdomainGuesses(store)) {
    let site: StoreSite | null;
    try {
      site = await getSite(`https://${sub}.tcgplayerpro.com`, fetchFn);
    } catch {
      continue;
    }
    if (!site) continue;
    const confidence = matchConfidence(store, site);
    if (confidence) return { store, site, confidence };
  }
  return null;
}

export interface FindStorefrontsOptions {
  concurrency?: number;
  fetchFn?: FetchFn;
  onProgress?: (done: number, total: number, match: StorefrontMatch | null) => void;
}

/** Probe every WPN store for a storefront; returns matches nearest first. */
export async function findStorefronts(
  stores: WpnStore[],
  { concurrency = 6, fetchFn = fetch, onProgress }: FindStorefrontsOptions = {},
): Promise<StorefrontMatch[]> {
  let done = 0;
  const results = await mapLimit(stores, concurrency, async (store) => {
    const match = await findStorefront(store, fetchFn);
    onProgress?.(++done, stores.length, match);
    return match;
  });
  return results
    .filter((m): m is StorefrontMatch => m !== null)
    .sort((a, b) => a.store.distance - b.store.distance);
}
