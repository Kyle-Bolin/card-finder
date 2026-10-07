import type { FetchFn, GeoPoint } from "./types";

export const LOCATION_ORIGINS = ["https://ipapi.co/*", "https://get.geojs.io/*"];
export const LOCATION_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

const IPAPI_URL = "https://ipapi.co/json/";
const GEOJS_URL = "https://get.geojs.io/v1/ip/geo.json";

/** A city-level location looked up from the device's IP address. */
export interface ApproxLocation extends GeoPoint {
  fetchedAt: number;
}

function coordinates(latitude: unknown, longitude: unknown): [number, number] | null {
  const lat = Number(latitude);
  const lng = Number(longitude);
  if (latitude === "" || longitude === "" || latitude == null || longitude == null) return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return [lat, lng];
}

function label(city: unknown, region: unknown, postal: unknown): string {
  const place = [city, region].filter((p) => typeof p === "string" && p).join(", ");
  return [place, typeof postal === "string" ? postal : ""].filter(Boolean).join(" ");
}

/** Parse `https://ipapi.co/json/` (`latitude`, `longitude`, `city`, `region_code`, `postal`). */
export function parseIpapi(data: unknown): GeoPoint | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  if (d.error) return null;
  const point = coordinates(d.latitude, d.longitude);
  if (!point) return null;
  return {
    latitude: point[0],
    longitude: point[1],
    label: label(d.city, d.region_code, d.postal) || "your area",
  };
}

/** Parse `https://get.geojs.io/v1/ip/geo.json`, which sends coordinates as strings. */
export function parseGeojs(data: unknown): GeoPoint | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  const point = coordinates(d.latitude, d.longitude);
  if (!point) return null;
  // geojs gives the full region name and no postal code.
  return {
    latitude: point[0],
    longitude: point[1],
    label: label(d.city, d.region, undefined) || "your area",
  };
}

async function tryProvider(
  url: string,
  parse: (data: unknown) => GeoPoint | null,
  fetchFn: FetchFn,
): Promise<GeoPoint | null> {
  try {
    const res = await fetchFn(url, { headers: { Accept: "application/json" } });
    if (!res.ok) return null;
    return parse(await res.json());
  } catch {
    return null;
  }
}

/** City-level location from the device's IP: ipapi.co, then geojs.io. Null if both fail. */
export async function fetchApproxLocation(
  fetchFn: FetchFn = fetch,
  now: () => number = Date.now,
): Promise<ApproxLocation | null> {
  const point =
    (await tryProvider(IPAPI_URL, parseIpapi, fetchFn)) ??
    (await tryProvider(GEOJS_URL, parseGeojs, fetchFn));
  return point ? { ...point, fetchedAt: now() } : null;
}

/**
 * The cached approximate location, refreshed at most once a day (or on `force`).
 * A stale copy beats none when the lookup fails.
 */
export async function ensureApproxLocation(
  cached: ApproxLocation | undefined,
  {
    force = false,
    fetchFn = fetch,
    now = Date.now,
  }: {
    force?: boolean;
    fetchFn?: FetchFn;
    now?: () => number;
  } = {},
): Promise<ApproxLocation | undefined> {
  if (cached && !force && now() - cached.fetchedAt < LOCATION_CACHE_TTL_MS) return cached;
  return (await fetchApproxLocation(fetchFn, now)) ?? cached;
}
