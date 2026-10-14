import type { CardArt } from "./scryfall";
import type { FetchFn } from "./types";

export const ARTIST_EVENTS_URL =
  "https://raw.githubusercontent.com/Kyle-Bolin/card-finder/main/data/artist-events.json";

export interface ArtistEvent {
  name: string;
  url: string;
  city?: string;
  /** Inclusive dates, YYYY-MM-DD. */
  start: string;
  end: string;
  /** Guest artists, spelled as Scryfall spells them. */
  artists: string[];
}

export interface ArtistEvents {
  generatedAt: string;
  sources: { name: string; url: string }[];
  events: ArtistEvent[];
}

export async function fetchArtistEvents(fetchFn: FetchFn = fetch): Promise<ArtistEvents | null> {
  try {
    const res = await fetchFn(ARTIST_EVENTS_URL, { cache: "no-cache" });
    if (!res.ok) return null;
    const data = (await res.json()) as ArtistEvents;
    return Array.isArray(data.events) && Array.isArray(data.sources) ? data : null;
  } catch {
    return null;
  }
}

export interface EventMatch {
  event: ArtistEvent;
  artists: { artist: string; cards: string[] }[];
}

/** Local calendar date as YYYY-MM-DD. */
export function todayIso(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** Deck cards drawn by each artist, by exact artist name. */
export function cardsByArtist(rows: CardArt[]): Map<string, string[]> {
  const byArtist = new Map<string, string[]>();
  for (const row of rows) {
    for (const artist of new Set(row.printing?.faces.map((f) => f.artist))) {
      byArtist.set(artist, [...(byArtist.get(artist) ?? []), row.name]);
    }
  }
  return byArtist;
}

/** Upcoming events (ending today or later) with deck artists, soonest first. */
export function matchEvents(events: ArtistEvent[], rows: CardArt[], today: string): EventMatch[] {
  const byArtist = cardsByArtist(rows);
  const matches: EventMatch[] = [];
  for (const event of events) {
    if (event.end < today) continue;
    const artists = event.artists
      .filter((artist) => byArtist.has(artist))
      .map((artist) => ({ artist, cards: byArtist.get(artist) ?? [] }));
    if (artists.length) matches.push({ event, artists });
  }
  return matches.sort(
    (a, b) =>
      a.event.start.localeCompare(b.event.start) || a.event.name.localeCompare(b.event.name),
  );
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function part(iso: string): { month: string; day: number; year: string } {
  const [year = "", month = "1", day = "1"] = iso.split("-");
  return { month: MONTHS[Number(month) - 1] ?? "", day: Number(day), year };
}

/** "Oct 23–25", "Oct 30 – Nov 1", or one day. */
export function formatEventDates(start: string, end: string): string {
  const s = part(start);
  const e = part(end);
  if (start === end) return `${s.month} ${s.day}`;
  if (s.month === e.month && s.year === e.year) return `${s.month} ${s.day}–${e.day}`;
  return `${s.month} ${s.day} – ${e.month} ${e.day}`;
}

/** First upcoming event per artist, for the note beside the artist list. */
export function nextEventByArtist(matches: EventMatch[]): Map<string, ArtistEvent> {
  const next = new Map<string, ArtistEvent>();
  for (const { event, artists } of matches) {
    for (const { artist } of artists) if (!next.has(artist)) next.set(artist, event);
  }
  return next;
}
