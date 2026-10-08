import { loadDirectory } from "./directoryCache";
import type { Directory } from "./directory";
import { ensureApproxLocation } from "./location";
import { loadSettings, saveSettings, type Settings } from "./settings";
import { computeStoreSet, type StoreSet } from "./storeSet";
import type { GeoPoint } from "./types";

/** The location to search from: the user's ZIP if set, else the approximate IP location. */
export function resolveHome(
  settings: Pick<Settings, "manualLocation" | "approxLocation">,
): GeoPoint | undefined {
  return settings.manualLocation ?? settings.approxLocation;
}

export interface ResolvedStores extends StoreSet {
  settings: Settings;
  home: GeoPoint | undefined;
  directory: Directory | null;
}

/**
 * Loads settings, refreshes the approximate location when due (at most daily; skipped when a
 * ZIP overrides it), and computes the stores to check. Persists a changed location.
 */
export async function resolveStores({
  refreshLocation = false,
}: { refreshLocation?: boolean } = {}): Promise<ResolvedStores> {
  let settings = await loadSettings();
  if (!settings.manualLocation) {
    const approx = await ensureApproxLocation(settings.approxLocation, { force: refreshLocation });
    if (approx !== settings.approxLocation) {
      settings = { ...(await loadSettings()), approxLocation: approx };
    }
  }
  const home = resolveHome(settings);
  if (home?.latitude !== settings.home?.latitude || home?.longitude !== settings.home?.longitude) {
    settings = { ...settings, home };
  }
  await saveSettings(settings);
  const directory = await loadDirectory();
  const set = computeStoreSet({
    home,
    rangeMiles: settings.rangeMiles,
    includeOnline: settings.includeOnline,
    excluded: settings.excluded,
    alwaysInclude: settings.stores,
    directory,
  });
  return { ...set, settings, home, directory };
}
