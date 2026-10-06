import type { Condition } from "./types";

/**
 * Canonical form of a card name for comparison: lowercase, accents stripped,
 * Æ → ae, curly quotes and dashes unified, whitespace collapsed.
 */
export function normalizeName(name: string): string {
  return name
    .replace(/Æ/g, "Ae")
    .replace(/æ/g, "ae")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[‘’`´]/g, "'")
    .replace(/[‐‑‒–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * A store product name without variant decorations:
 * "Lightning Bolt (Borderless)" → "Lightning Bolt", "Sol Ring [Foil Etched]" → "Sol Ring",
 * "Sword of Hearth and Home - Foil" → "Sword of Hearth and Home".
 */
export function baseProductName(productName: string): string {
  let name = productName.trim();
  for (;;) {
    const stripped = name
      .replace(/\s*[([][^()[\]]*[)\]]\s*$/, "")
      .replace(/\s+-\s+(foil|etched|foil etched|non-foil)$/i, "")
      .trim();
    if (stripped === name || !stripped) return name;
    name = stripped;
  }
}

/** Front face of a double-faced card name ("Delver of Secrets // Insectile Aberration"). */
function frontFace(name: string): string {
  return name.split(/\s*\/\/\s*/)[0] ?? name;
}

/**
 * Whether a store product is the wanted card. Exact match on normalized names
 * after removing variant suffixes. Never substring matching: a search for
 * "Lightning Bolt" also returns "Thrum of the Vestige - Lightning Bolt".
 */
export function matchesCard(productName: string, wantedName: string): boolean {
  const product = normalizeName(baseProductName(productName));
  const wanted = normalizeName(wantedName);
  if (product === wanted) return true;
  // Double-faced cards: stores and Moxfield may list either the full name or the front face.
  return (
    normalizeName(frontFace(baseProductName(productName))) === normalizeName(frontFace(wantedName))
  );
}

const NOT_A_SINGLE =
  /\b(art series|art card|tokens?|emblems?|oversized|minigames?|playtest|world championship|collectors' edition|international edition|checklist|helper card|front card|substitute card)\b/i;

/** Excludes tokens, art cards, oversized cards and other non-singles by set or product name. */
export function isSingleCard(setName: string, productName: string): boolean {
  return !NOT_A_SINGLE.test(setName) && !NOT_A_SINGLE.test(productName);
}

const CONDITIONS: [RegExp, Condition][] = [
  [/^near mint/i, "NM"],
  [/^lightly played/i, "LP"],
  [/^moderately played/i, "MP"],
  [/^heavily played/i, "HP"],
  [/^damaged/i, "DMG"],
];

/**
 * TCGplayer condition strings combine condition, foil and language:
 * "Lightly Played Foil", "Lightly Played - Japanese". Returns the short condition.
 */
export function parseCondition(conditionName: string): Condition | string {
  const match = CONDITIONS.find(([pattern]) => pattern.test(conditionName.trim()));
  return match ? match[1] : conditionName.trim();
}
