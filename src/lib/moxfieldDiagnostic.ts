/**
 * Summarize an unknown Moxfield deck payload for the #2 spike: which boards exist,
 * where per-card tags live, and which cards carry the wanted tag. Tolerant of
 * format differences since the API is undocumented.
 */
export interface DeckSummary {
  topLevelKeys: string[];
  deckName?: string;
  boards: { name: string; cards: number }[];
  /** JSON paths of every object key that looks like a tag container. */
  tagLocations: string[];
  /** Cards carrying the wanted tag, with the board they're in when known. */
  taggedCards: { name: string; board?: string; tags: string[] }[];
}

type Json = unknown;

function isObject(value: Json): value is Record<string, Json> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cardName(entry: Json): string | undefined {
  if (!isObject(entry)) return undefined;
  const card = entry.card;
  if (isObject(card) && typeof card.name === "string") return card.name;
  return typeof entry.name === "string" ? entry.name : undefined;
}

function collectTagLocations(value: Json, path: string, out: string[], depth = 0): void {
  if (depth > 6 || !isObject(value)) return;
  for (const [key, child] of Object.entries(value)) {
    const childPath = path ? `${path}.${key}` : key;
    if (/tags?$/i.test(key) && (isObject(child) || Array.isArray(child))) out.push(childPath);
    // Board card maps can be large; don't descend into every card.
    if (!/^cards$/.test(key)) collectTagLocations(child, childPath, out, depth + 1);
  }
}

export function summarizeDeck(deck: Json, tag: string): DeckSummary {
  const wanted = tag.trim().toLowerCase();
  const root = isObject(deck) ? deck : {};
  const summary: DeckSummary = {
    topLevelKeys: Object.keys(root).sort(),
    deckName: typeof root.name === "string" ? root.name : undefined,
    boards: [],
    tagLocations: [],
    taggedCards: [],
  };

  // Board name for each card name, so tagged cards can report where they live.
  const boardOf = new Map<string, string>();
  const boards = isObject(root.boards) ? root.boards : {};
  for (const [boardName, board] of Object.entries(boards)) {
    const cards = isObject(board) && isObject(board.cards) ? Object.values(board.cards) : [];
    summary.boards.push({ name: boardName, cards: cards.length });
    for (const entry of cards) {
      const name = cardName(entry);
      if (name && !boardOf.has(name)) boardOf.set(name, boardName);
    }
  }

  collectTagLocations(root, "", summary.tagLocations);

  // Expected shape: authorTags = { "Card Name": ["tag", ...] }.
  const authorTags = isObject(root.authorTags) ? root.authorTags : {};
  for (const [name, tags] of Object.entries(authorTags)) {
    if (!Array.isArray(tags)) continue;
    const tagList = tags.filter((t): t is string => typeof t === "string");
    if (tagList.some((t) => t.toLowerCase() === wanted)) {
      summary.taggedCards.push({ name, board: boardOf.get(name), tags: tagList });
    }
  }
  return summary;
}
