import { describe, expect, it } from "vitest";
import {
  ensureApproxLocation,
  fetchApproxLocation,
  LOCATION_CACHE_TTL_MS,
  parseGeojs,
  parseIpapi,
} from "../src/lib/location";
import { fakeFetch } from "./helpers";

const ipapi = {
  latitude: 42.835,
  longitude: -71.648,
  city: "Milford",
  region_code: "NH",
  postal: "03055",
};
const geojs = {
  latitude: "42.8354",
  longitude: "-71.6490",
  city: "Milford",
  region: "New Hampshire",
};

describe("IP location parsing", () => {
  it("parses ipapi.co", () => {
    expect(parseIpapi(ipapi)).toEqual({
      latitude: 42.835,
      longitude: -71.648,
      label: "Milford, NH 03055",
    });
  });
  it("rejects ipapi errors and missing coordinates", () => {
    expect(parseIpapi({ error: true, reason: "RateLimited" })).toBeNull();
    expect(parseIpapi({ city: "X" })).toBeNull();
    expect(parseIpapi({ latitude: null, longitude: null })).toBeNull();
    expect(parseIpapi(null)).toBeNull();
  });
  it("parses geojs.io string coordinates", () => {
    expect(parseGeojs(geojs)).toEqual({
      latitude: 42.8354,
      longitude: -71.649,
      label: "Milford, New Hampshire",
    });
  });
  it("rejects bad geojs data", () => {
    expect(parseGeojs({ latitude: "abc", longitude: "1" })).toBeNull();
    expect(parseGeojs({ latitude: "", longitude: "" })).toBeNull();
    expect(parseGeojs({ latitude: "95", longitude: "0" })).toBeNull();
  });

  it("rejects country-level answers with no city", () => {
    // What geojs.io returns when it can't place an IP: the US centroid, no city.
    expect(
      parseGeojs({ latitude: "37.751", longitude: "-97.822", country_code: "US", city: "" }),
    ).toBeNull();
    expect(parseGeojs({ latitude: "37.751", longitude: "-97.822", country_code: "US" })).toBeNull();
    expect(
      parseIpapi({ latitude: 37.751, longitude: -97.822, country_code: "US", city: null }),
    ).toBeNull();
  });
});

describe("fetchApproxLocation", () => {
  it("uses ipapi first", async () => {
    const { fetchFn, calls } = fakeFetch({ "https://ipapi.co/json/": { body: ipapi } });
    const loc = await fetchApproxLocation(fetchFn, () => 5);
    expect(loc?.label).toBe("Milford, NH 03055");
    expect(loc?.fetchedAt).toBe(5);
    expect(calls).toHaveLength(1);
  });
  it("falls back to geojs when ipapi fails", async () => {
    const { fetchFn } = fakeFetch({
      "https://ipapi.co/json/": { status: 429 },
      "https://get.geojs.io/v1/ip/geo.json": { body: geojs },
    });
    expect((await fetchApproxLocation(fetchFn))?.label).toBe("Milford, New Hampshire");
  });
  it("returns null when both fail", async () => {
    const { fetchFn } = fakeFetch({});
    expect(await fetchApproxLocation(fetchFn)).toBeNull();
  });
});

describe("ensureApproxLocation", () => {
  const cached = { latitude: 1, longitude: 2, label: "Old", fetchedAt: 1000 };
  it("reuses a fresh cached location", async () => {
    const { fetchFn, calls } = fakeFetch({});
    const got = await ensureApproxLocation(cached, { fetchFn, now: () => 1000 + 5 });
    expect(got).toBe(cached);
    expect(calls).toHaveLength(0);
  });
  it("refreshes after a day, or when forced", async () => {
    const { fetchFn } = fakeFetch({ "https://ipapi.co/json/": { body: ipapi } });
    const later = 1000 + LOCATION_CACHE_TTL_MS;
    expect((await ensureApproxLocation(cached, { fetchFn, now: () => later }))?.label).toBe(
      "Milford, NH 03055",
    );
    expect((await ensureApproxLocation(cached, { fetchFn, force: true }))?.label).toBe(
      "Milford, NH 03055",
    );
  });
  it("keeps the stale copy when the refresh fails", async () => {
    const { fetchFn } = fakeFetch({});
    expect(await ensureApproxLocation(cached, { fetchFn, force: true })).toBe(cached);
  });
  it("is undefined with no cache and no network", async () => {
    const { fetchFn } = fakeFetch({});
    expect(await ensureApproxLocation(undefined, { fetchFn })).toBeUndefined();
  });
});
