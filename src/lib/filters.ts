import type { Condition, Listing } from "./types";

export const ALL_CONDITIONS: Condition[] = ["NM", "LP", "MP", "HP", "DMG"];

/** Which in-stock listings count as a match. */
export interface Filters {
  /** Per copy, USD; null means no limit. */
  maxPrice: number | null;
  conditions: Condition[];
  foil: "any" | "nonfoil" | "foil";
  englishOnly: boolean;
}

export const DEFAULT_FILTERS: Filters = {
  maxPrice: null,
  conditions: ALL_CONDITIONS,
  foil: "any",
  englishOnly: false,
};

/** Fill in anything missing or malformed in stored filters (older versions had none). */
export function normalizeFilters(stored: Partial<Filters> | undefined): Filters {
  const f = stored ?? {};
  return {
    maxPrice:
      typeof f.maxPrice === "number" && Number.isFinite(f.maxPrice) && f.maxPrice >= 0
        ? f.maxPrice
        : null,
    conditions: Array.isArray(f.conditions)
      ? ALL_CONDITIONS.filter((c) => f.conditions?.includes(c))
      : [...ALL_CONDITIONS],
    foil: f.foil === "nonfoil" || f.foil === "foil" ? f.foil : "any",
    englishOnly: f.englishOnly === true,
  };
}

/** Listings that pass every filter. */
export function applyFilters(listings: Listing[], filters: Filters): Listing[] {
  return listings.filter((l) => {
    if (filters.maxPrice !== null && l.price > filters.maxPrice) return false;
    // A condition we can't classify only passes when no condition is excluded.
    const known = ALL_CONDITIONS.includes(l.condition as Condition);
    if (
      known
        ? !filters.conditions.includes(l.condition as Condition)
        : filters.conditions.length < ALL_CONDITIONS.length
    )
      return false;
    if (filters.foil === "foil" && !l.foil) return false;
    if (filters.foil === "nonfoil" && l.foil) return false;
    if (filters.englishOnly && l.language !== "English") return false;
    return true;
  });
}

/** Short description of the filters that are narrowing results, e.g. "NM/LP · ≤ $20 · non-foil". */
export function describeFilters(filters: Filters): string[] {
  const parts: string[] = [];
  if (filters.conditions.length < ALL_CONDITIONS.length) {
    parts.push(filters.conditions.length ? filters.conditions.join("/") : "no conditions");
  }
  if (filters.maxPrice !== null) parts.push(`≤ $${filters.maxPrice}`);
  if (filters.foil === "foil") parts.push("foil only");
  if (filters.foil === "nonfoil") parts.push("non-foil");
  if (filters.englishOnly) parts.push("English only");
  return parts;
}
