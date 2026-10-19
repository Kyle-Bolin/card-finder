import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("webextension-polyfill", () => ({ default: {} }));
import { artistMatcher, normalizeName, withinOneEdit } from "../src/crawler/artistNames";
import {
  fetchScgconEvents,
  parseEventLinks,
  parseEventPage,
  parseGuests,
} from "../src/crawler/scgcon";
import { politeFetch } from "../src/crawler/http";
import {
  fetchArtistEvents,
  formatEventDates,
  matchEvents,
  nextEventByArtist,
  type ArtistEvent,
} from "../src/lib/artistEvents";
import { loadArtistEvents } from "../src/lib/artistEventsCache";
import type { CardArt } from "../src/lib/scryfall";
import type { FetchFn } from "../src/lib/types";

const fixture = (name: string) =>
  readFileSync(new URL(`./fixtures/scgcon/${name}`, import.meta.url), "utf8");
const BASE = "https://scgcon.starcitygames.com";
const HARTFORD = `${BASE}/event/scg-con-hartford-2026/`;

const SCRYFALL = [
  "Jarel Threat",
  "Dan Murayama Scott",
  "Randy Gallegos",
  "Ken Meyer, Jr.",
  "rk post",
  "Ken Meyers",
];

describe("artist name matching", () => {
  const matcher = artistMatcher(SCRYFALL);
  it.each([
    ["Dan Scott", "Dan Murayama Scott"],
    ["Randy Gallgos", "Randy Gallegos"],
    ["Ken Meyer Jr.", "Ken Meyer, Jr."],
    ["RK Post", "rk post"],
    ["Jarel Threat", "Jarel Threat"],
  ])("%s -> %s", (guest, expected) => {
    expect(matcher.match(guest)).toBe(expected);
  });
  it("drops guests that aren't Scryfall artists", () => {
    expect(matcher.match("Some Cosplayer")).toBeUndefined();
    expect(matcher.match("")).toBeUndefined();
  });
  it("normalizes case, accents, punctuation and suffixes", () => {
    expect(normalizeName("  Ken  Meyer, Jr. ")).toBe("ken meyer");
    expect(normalizeName("José Ñandú")).toBe("jose nandu");
  });
  it("only allows single-character edits", () => {
    expect(withinOneEdit("abc", "abd")).toBe(true);
    expect(withinOneEdit("abc", "abcd")).toBe(true);
    expect(withinOneEdit("abc", "xbd")).toBe(false);
  });
});

describe("SCG CON parsing", () => {
  it("finds event links on the home page", () => {
    expect(parseEventLinks(fixture("home.html"))).toEqual([
      HARTFORD,
      `${BASE}/event/scg-con-minneapolis-2027/`,
      `${BASE}/event/scg-con-old-2025/`,
    ]);
  });
  it("reads name, dates, city and guests", () => {
    expect(parseEventPage(fixture("hartford-2026.html"), HARTFORD)).toEqual({
      name: "SCG CON Hartford 2026",
      url: HARTFORD,
      city: "Hartford, CT",
      start: "2026-10-23",
      end: "2026-10-25",
      guests: [
        "Jarel Threat",
        "Dan Scott",
        "Randy Gallgos",
        "Ken Meyer Jr.",
        "RK Post",
        "Some Cosplayer",
      ],
    });
  });
  it("treats a page without Special Guests as having none", () => {
    expect(parseGuests(fixture("minneapolis-2027.html"))).toEqual([]);
  });
  it("returns nothing for a page without dates", () => {
    expect(parseEventPage("<html></html>", HARTFORD)).toBeUndefined();
  });
});

function fakeSite(calls: { url: string; ua: string | null }[] = []): FetchFn {
  const pages: Record<string, string> = {
    [`${BASE}/`]: fixture("home.html"),
    [HARTFORD]: fixture("hartford-2026.html"),
    [`${BASE}/event/scg-con-minneapolis-2027/`]: fixture("minneapolis-2027.html"),
    [`${BASE}/event/scg-con-old-2025/`]: fixture("old-2025.html"),
  };
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, ua: new Headers(init?.headers).get("User-Agent") });
    const body = pages[url];
    return body ? new Response(body) : new Response("", { status: 404 });
  }) as FetchFn;
}

describe("fetchScgconEvents", () => {
  const matcher = artistMatcher(SCRYFALL);
  it("keeps upcoming events with matched artists, in Scryfall's spelling", async () => {
    const events = await fetchScgconEvents(fakeSite(), matcher, "2026-10-14");
    expect(events).toEqual([
      {
        name: "SCG CON Hartford 2026",
        url: HARTFORD,
        city: "Hartford, CT",
        start: "2026-10-23",
        end: "2026-10-25",
        artists: [
          "Jarel Threat",
          "Dan Murayama Scott",
          "Randy Gallegos",
          "Ken Meyer, Jr.",
          "rk post",
        ],
      },
    ]);
  });
  it("keeps an event through its last day, then drops it", async () => {
    expect(await fetchScgconEvents(fakeSite(), matcher, "2026-10-25")).toHaveLength(1);
    expect(await fetchScgconEvents(fakeSite(), matcher, "2026-10-26")).toHaveLength(0);
  });
  it("sends the crawler User-Agent", async () => {
    const calls: { url: string; ua: string | null }[] = [];
    const http = politeFetch({ baseFetch: fakeSite(calls), intervalMs: () => 0 });
    await fetchScgconEvents(http.fetch, matcher, "2026-10-14");
    expect(calls.length).toBe(4);
    for (const call of calls) expect(call.ua).toMatch(/card-finder/);
  });
});

const row = (name: string, artist: string): CardArt =>
  ({ name, printing: { faces: [{ artist }] } }) as unknown as CardArt;

const events: ArtistEvent[] = [
  { name: "B", url: "u2", start: "2026-11-05", end: "2026-11-07", artists: ["Jarel Threat"] },
  {
    name: "A",
    url: "u1",
    start: "2026-10-23",
    end: "2026-10-25",
    artists: ["Jarel Threat", "Dan Murayama Scott"],
  },
  { name: "Past", url: "u0", start: "2026-10-01", end: "2026-10-03", artists: ["Jarel Threat"] },
  { name: "Other", url: "u3", start: "2026-12-01", end: "2026-12-02", artists: ["Nobody"] },
];
const rows = [
  row("Opt", "Jarel Threat"),
  row("Bolt", "Jarel Threat"),
  row("Island", "Dan Murayama Scott"),
];

describe("matching events to a deck", () => {
  it("sorts by date, drops past events and non-matching ones, lists cards", () => {
    const matches = matchEvents(events, rows, "2026-10-14");
    expect(matches.map((m) => m.event.name)).toEqual(["A", "B"]);
    expect(matches[0]?.artists).toEqual([
      { artist: "Jarel Threat", cards: ["Opt", "Bolt"] },
      { artist: "Dan Murayama Scott", cards: ["Island"] },
    ]);
  });
  it("gives each artist their first upcoming event", () => {
    const next = nextEventByArtist(matchEvents(events, rows, "2026-10-14"));
    expect(next.get("Jarel Threat")?.name).toBe("A");
  });
  it("formats date ranges", () => {
    expect(formatEventDates("2026-10-23", "2026-10-25")).toBe("Oct 23–25");
    expect(formatEventDates("2026-10-30", "2026-11-01")).toBe("Oct 30 – Nov 1");
    expect(formatEventDates("2026-10-30", "2026-10-30")).toBe("Oct 30");
  });
});

describe("loading artist events", () => {
  const data = { generatedAt: "x", sources: [], events: [] };
  const okFetch = (async () => new Response(JSON.stringify(data))) as FetchFn;
  const failFetch = (async () => new Response("", { status: 500 })) as FetchFn;
  const memory = () => {
    const m = new Map<string, unknown>();
    return {
      get: async (k: string) => m.get(k),
      set: async (k: string, v: unknown) => void m.set(k, v),
    };
  };
  it("returns null when the file can't be fetched", async () => {
    expect(await fetchArtistEvents(failFetch)).toBeNull();
    expect(await loadArtistEvents({ fetchFn: failFetch, store: memory() })).toBeNull();
  });
  it("caches for a day and falls back to a stale copy", async () => {
    const store = memory();
    let t = 0;
    expect(await loadArtistEvents({ fetchFn: okFetch, store, now: () => t })).toEqual(data);
    expect(await loadArtistEvents({ fetchFn: failFetch, store, now: () => (t += 1000) })).toEqual(
      data,
    );
    expect(
      await loadArtistEvents({ fetchFn: failFetch, store, now: () => (t += 2 * 86_400_000) }),
    ).toEqual(data);
  });
});
