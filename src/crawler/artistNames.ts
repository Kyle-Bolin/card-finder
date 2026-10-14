/** Guest names that normalization and a one-character fix can't map to Scryfall's spelling. */
export const ARTIST_ALIASES: Record<string, string> = {
  "Dan Scott": "Dan Murayama Scott",
};

/** Lowercase, no accents or punctuation, no Jr./Sr. suffix, single spaces. */
export function normalizeName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((word) => word && word !== "jr" && word !== "sr")
    .join(" ");
}

/** Whether two strings differ by at most one inserted, deleted or substituted character. */
export function withinOneEdit(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  if (i === a.length && i === b.length) return true;
  if (a.length === b.length) return a.slice(i + 1) === b.slice(i + 1);
  return a.length > b.length ? a.slice(i + 1) === b.slice(i) : a.slice(i) === b.slice(i + 1);
}

const MIN_NEAR_LENGTH = 8;

export interface ArtistMatcher {
  /** Scryfall's spelling of the guest, or undefined when no artist matches. */
  match(guest: string): string | undefined;
}

export function artistMatcher(
  scryfallNames: string[],
  aliases: Record<string, string> = ARTIST_ALIASES,
): ArtistMatcher {
  const byNormal = new Map<string, string>();
  for (const name of scryfallNames) byNormal.set(normalizeName(name), name);
  const aliasByNormal = new Map<string, string>();
  for (const [from, to] of Object.entries(aliases)) {
    if (scryfallNames.includes(to)) aliasByNormal.set(normalizeName(from), to);
  }
  return {
    match(guest) {
      const key = normalizeName(guest);
      if (!key) return undefined;
      const direct = aliasByNormal.get(key) ?? byNormal.get(key);
      if (direct) return direct;
      if (key.length < MIN_NEAR_LENGTH) return undefined;
      const near = [...byNormal].filter(([k]) => withinOneEdit(key, k));
      return near.length === 1 ? near[0]?.[1] : undefined;
    },
  };
}
