import type { TtlCache } from "./cache";
import type { FetchFn } from "./types";

const API = "https://api.scryfall.com";

/** Scryfall asks for 50–100 ms between requests. */
export const SCRYFALL_INTERVAL_MS = 100;
export const COLLECTION_BATCH = 75;
export const SCRYFALL_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** The parts of a Scryfall card object the artists page reads. */
export interface ScryfallCard {
  id?: string;
  name?: string;
  set?: string;
  set_name?: string;
  collector_number?: string;
  artist?: string;
  illustration_id?: string;
  type_line?: string;
  scryfall_uri?: string;
  image_uris?: { small?: string };
  card_faces?: {
    name?: string;
    artist?: string;
    illustration_id?: string;
    type_line?: string;
    image_uris?: { small?: string };
  }[];
}

export interface Face {
  name: string;
  artist: string;
  image?: string;
}

/** One illustration of a card, as printed in one particular set. */
export interface Art {
  illustrationId: string;
  /** Full card name ("Front // Back" for double-faced cards). */
  name: string;
  faces: Face[];
  set: string;
  setName: string;
  collectorNumber: string;
  url: string;
  typeLine: string;
}

export class ScryfallError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export type Identifier = { set: string; collector_number: string } | { name: string };

export function identifierFor(card: { name: string; set?: string; cn?: string }): Identifier {
  return card.set && card.cn
    ? { set: card.set.toLowerCase(), collector_number: card.cn }
    : { name: card.name };
}

export function batches<T>(items: T[], size = COLLECTION_BATCH): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export function searchUrl(name: string): string {
  const q = `!"${name.replaceAll('"', '\\"')}"`;
  return `${API}/cards/search?q=${encodeURIComponent(q)}&unique=art`;
}

export function artistSearchUrl(artist: string): string {
  return `https://scryfall.com/search?q=${encodeURIComponent(`a:"${artist}"`)}`;
}

/** Parses a Scryfall card into the face artists, thumbnails and illustration it shows. */
export function parseArt(card: ScryfallCard): Art | null {
  if (typeof card.name !== "string") return null;
  const faces: Face[] = [];
  const sourceFaces = card.card_faces ?? [];
  if (sourceFaces.length > 1 && sourceFaces.some((f) => f.artist)) {
    for (const f of sourceFaces) {
      faces.push({
        name: f.name ?? card.name,
        artist: f.artist ?? card.artist ?? "Unknown",
        image: f.image_uris?.small ?? card.image_uris?.small,
      });
    }
  } else {
    faces.push({
      name: card.name,
      artist: card.artist ?? sourceFaces[0]?.artist ?? "Unknown",
      image: card.image_uris?.small ?? sourceFaces[0]?.image_uris?.small,
    });
  }
  const illustrationId =
    card.illustration_id ??
    sourceFaces[0]?.illustration_id ??
    card.id ??
    `${card.set}-${card.collector_number}`;
  return {
    illustrationId,
    name: card.name,
    faces,
    set: card.set ?? "",
    setName: card.set_name ?? (card.set ?? "").toUpperCase(),
    collectorNumber: card.collector_number ?? "",
    url:
      card.scryfall_uri ??
      `https://scryfall.com/card/${card.set}/${encodeURIComponent(card.collector_number ?? "")}`,
    typeLine: card.type_line ?? sourceFaces[0]?.type_line ?? "",
  };
}

/** One entry per illustration (reprints with the same art fold together), first printing wins. */
export function groupByIllustration(cards: ScryfallCard[]): Art[] {
  const arts = new Map<string, Art>();
  for (const card of cards) {
    const art = parseArt(card);
    if (art && !arts.has(art.illustrationId)) arts.set(art.illustrationId, art);
  }
  return [...arts.values()];
}

const BASIC = /^basic /i;
const BASIC_NAMES = new Set(["plains", "island", "swamp", "mountain", "forest", "wastes"]);

export function isBasicLand(name: string, typeLine?: string): boolean {
  if (typeLine) return BASIC.test(typeLine);
  return BASIC_NAMES.has(name.toLowerCase().replace(/^snow-covered /, ""));
}

function matches(id: Identifier, card: ScryfallCard): boolean {
  if ("name" in id) {
    const want = id.name.toLowerCase();
    const got = (card.name ?? "").toLowerCase();
    return got === want || got.startsWith(`${want} // `);
  }
  return (
    (card.set ?? "").toLowerCase() === id.set &&
    (card.collector_number ?? "") === id.collector_number
  );
}

/** Enforces a minimum gap between request starts. */
export class Pacer {
  private next = 0;
  constructor(
    private readonly intervalMs = SCRYFALL_INTERVAL_MS,
    private readonly sleep: (ms: number) => Promise<void> = (ms) =>
      new Promise((r) => setTimeout(r, ms)),
    private readonly now: () => number = Date.now,
  ) {}

  async wait(): Promise<void> {
    const start = Math.max(this.now(), this.next);
    this.next = start + this.intervalMs;
    const delay = start - this.now();
    if (delay > 0) await this.sleep(delay);
  }
}

export class ScryfallClient {
  constructor(
    private readonly fetchFn: FetchFn,
    private readonly pacer: Pacer = new Pacer(),
  ) {}

  private async request(url: string, init?: RequestInit): Promise<Response> {
    await this.pacer.wait();
    let res: Response;
    try {
      res = await this.fetchFn(url, {
        ...init,
        headers: { Accept: "application/json", ...(init?.headers as Record<string, string>) },
      });
    } catch {
      throw new ScryfallError("Couldn't reach Scryfall.", 0);
    }
    if (res.status === 429) {
      throw new ScryfallError("Scryfall is rate limiting Card Finder. Try again in a minute.", 429);
    }
    return res;
  }

  /** Looks up printings; the result has one entry per identifier that was found, in the order asked. */
  async collection(ids: Identifier[]): Promise<(ScryfallCard | null)[]> {
    const found: ScryfallCard[] = [];
    for (const batch of batches(ids)) {
      const res = await this.request(`${API}/cards/collection`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifiers: batch }),
      });
      if (!res.ok) throw new ScryfallError(`Scryfall returned HTTP ${res.status}.`, res.status);
      const body = (await res.json()) as { data?: ScryfallCard[] };
      found.push(...(body.data ?? []));
    }
    return ids.map((id) => found.find((c) => matches(id, c)) ?? null);
  }

  /** Every illustration of a card, following pagination. A card Scryfall doesn't know has none. */
  async searchArts(name: string): Promise<ScryfallCard[]> {
    const cards: ScryfallCard[] = [];
    let url: string | undefined = searchUrl(name);
    while (url) {
      const res = await this.request(url);
      if (res.status === 404) return cards;
      if (!res.ok) throw new ScryfallError(`Scryfall returned HTTP ${res.status}.`, res.status);
      const body = (await res.json()) as {
        data?: ScryfallCard[];
        has_more?: boolean;
        next_page?: string;
      };
      cards.push(...(body.data ?? []));
      url = body.has_more ? body.next_page : undefined;
    }
    return cards;
  }
}

export interface ArtDeckCard {
  name: string;
  set?: string;
  cn?: string;
  signed: boolean;
}

/** What the page shows for one card of the deck. */
export interface CardArt {
  name: string;
  isBasic: boolean;
  /** The deck's own printing, once looked up. */
  printing?: Art;
  /** Other illustrations, once looked up (undefined while pending or skipped). */
  alternatives?: Art[];
}

export interface DeckArt {
  rows: CardArt[];
  signedSkipped: number;
  error?: string;
}

export interface ArtCaches {
  printings: TtlCache<Art>;
  arts: TtlCache<Art[]>;
}

const printingKey = (c: ArtDeckCard) => (c.set && c.cn ? `${c.set}:${c.cn}` : `name:${c.name}`);

/**
 * Looks up the deck's printings (batched), then the other artworks of each card, calling
 * `onUpdate` as results arrive. A Scryfall failure stops the lookups and is returned
 * alongside everything loaded so far.
 */
export async function loadDeckArt(
  cards: ArtDeckCard[],
  opts: {
    client: ScryfallClient;
    caches: ArtCaches;
    includeBasics: boolean;
    onUpdate?: (state: DeckArt) => void;
  },
): Promise<DeckArt> {
  const signedSkipped = new Set(cards.filter((c) => c.signed).map((c) => c.name)).size;
  const byName = new Map<string, ArtDeckCard>();
  for (const c of cards) if (!c.signed && !byName.has(c.name)) byName.set(c.name, c);
  const rows = new Map<string, CardArt>(
    [...byName.values()].map((c) => [c.name, { name: c.name, isBasic: isBasicLand(c.name) }]),
  );
  const state = (error?: string): DeckArt => ({
    rows: [...rows.values()],
    signedSkipped,
    ...(error ? { error } : {}),
  });
  const update = () => opts.onUpdate?.(state());
  const setPrinting = (name: string, art: Art) => {
    const row = rows.get(name);
    if (row) {
      row.printing = art;
      row.isBasic = isBasicLand(name, art.typeLine);
    }
  };

  try {
    const missing: ArtDeckCard[] = [];
    for (const c of byName.values()) {
      const hit = await opts.caches.printings.get(printingKey(c));
      if (hit) setPrinting(c.name, hit);
      else missing.push(c);
    }
    update();
    for (const batch of batches(missing)) {
      const found = await opts.client.collection(batch.map(identifierFor));
      for (const [i, card] of batch.entries()) {
        const art = found[i] ? parseArt(found[i] as ScryfallCard) : null;
        const c = card as ArtDeckCard;
        if (!art) continue;
        setPrinting(c.name, art);
        await opts.caches.printings.set(printingKey(c), art);
      }
      update();
    }
    for (const row of rows.values()) {
      if (row.isBasic && !opts.includeBasics) continue;
      const searchName = row.printing?.name ?? row.name;
      const all = await opts.caches.arts.getOrLoad(searchName, async () =>
        groupByIllustration(await opts.client.searchArts(searchName)),
      );
      row.alternatives = all.filter((a) => a.illustrationId !== row.printing?.illustrationId);
      update();
    }
  } catch (err) {
    if (err instanceof ScryfallError) return state(err.message);
    throw err;
  }
  return state();
}

/** Artists of the deck's printings with the number of cards each drew, most first. */
export function artistCounts(rows: CardArt[]): { artist: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    for (const artist of new Set(row.printing?.faces.map((f) => f.artist))) {
      counts.set(artist, (counts.get(artist) ?? 0) + 1);
    }
  }
  return [...counts]
    .map(([artist, count]) => ({ artist, count }))
    .sort((a, b) => b.count - a.count || a.artist.localeCompare(b.artist));
}
