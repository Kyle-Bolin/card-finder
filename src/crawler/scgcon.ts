import type { ArtistEvent } from "../lib/artistEvents";
import type { FetchFn } from "../lib/types";
import type { ArtistMatcher } from "./artistNames";

export const SCGCON_URL = "https://scgcon.starcitygames.com/";
export const SCGCON_SOURCE = { name: "SCG CON", url: SCGCON_URL };

const decode = (s: string) =>
  s
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;|&#039;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");

/** Absolute `/event/<slug>/` URLs linked from the home page, in order. */
export function parseEventLinks(html: string, pageUrl = SCGCON_URL): string[] {
  const base = new URL(pageUrl);
  const urls: string[] = [];
  for (const match of html.matchAll(/<a\b[^>]*\bhref\s*=\s*["']([^"']+)["']/gi)) {
    let url: URL;
    try {
      url = new URL(decode(match[1] ?? ""), base);
    } catch {
      continue;
    }
    if (url.origin !== base.origin || !/^\/event\/[^/]+\/?$/.test(url.pathname)) continue;
    const href = `${url.origin}${url.pathname.replace(/\/?$/, "/")}`;
    if (!urls.includes(href)) urls.push(href);
  }
  return urls;
}

/** Guest names (the `alt` text of each picture card) under the Special Guests heading. */
export function parseGuests(html: string): string[] {
  const heading = html.search(/<h2\b[^>]*>\s*Special Guests\s*<\/h2>/i);
  if (heading < 0) return [];
  const names: string[] = [];
  for (const card of html
    .slice(heading)
    .matchAll(/<div\b[^>]*class="[^"]*special-guests[^"]*"[^>]*>[\s\S]*?<img\b[^>]*>/gi)) {
    const alt = /\balt\s*=\s*"([^"]*)"/i.exec(card[0].slice(card[0].lastIndexOf("<img")))?.[1];
    const name = alt ? decode(alt).trim() : "";
    if (name && !names.includes(name)) names.push(name);
  }
  return names;
}

interface JsonLdNode {
  "@type"?: string | string[];
  name?: string;
  startDate?: string;
  endDate?: string;
  location?: { address?: { addressLocality?: string; addressRegion?: string } | string };
}

function jsonLdNodes(html: string): JsonLdNode[] {
  const nodes: JsonLdNode[] = [];
  for (const m of html.matchAll(
    /<script\b[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi,
  )) {
    try {
      const data = JSON.parse(m[1] ?? "") as { "@graph"?: JsonLdNode[] } & JsonLdNode;
      nodes.push(...(Array.isArray(data["@graph"]) ? data["@graph"] : [data]));
    } catch {
      // Ignore malformed blocks.
    }
  }
  return nodes;
}

const isoDate = (value: string | undefined) => /^\d{4}-\d{2}-\d{2}/.exec(value ?? "")?.[0];

export interface ParsedEvent {
  name: string;
  url: string;
  city?: string;
  start: string;
  end: string;
  guests: string[];
}

/** An event page's name, dates, city and guests; undefined when it has no usable dates. */
export function parseEventPage(html: string, url: string): ParsedEvent | undefined {
  const nodes = jsonLdNodes(html);
  const dated = nodes.find((n) => isoDate(n.startDate));
  const start = isoDate(dated?.startDate);
  if (!dated || !start) return undefined;
  const end = isoDate(dated.endDate) ?? start;
  const rawName =
    dated.name ??
    nodes.find((n) => n.name)?.name ??
    /<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(html)?.[1] ??
    "";
  const name = decode(rawName.replace(/<[^>]+>/g, ""))
    .replace(/\s+[-–|]\s+SCG CON\s*$/i, "")
    .trim();
  const address = nodes.map((n) => n.location?.address).find((a) => a && typeof a === "object");
  const city =
    address && typeof address === "object"
      ? [address.addressLocality, address.addressRegion].filter(Boolean).join(", ") || undefined
      : undefined;
  return { name, url, city, start, end, guests: parseGuests(html) };
}

/** Upcoming SCG CON events (ending on or after `today`) that have at least one matched artist. */
export async function fetchScgconEvents(
  fetchFn: FetchFn,
  matcher: ArtistMatcher,
  today: string,
  log: (message: string) => void = () => {},
): Promise<ArtistEvent[]> {
  const home = await fetchFn(SCGCON_URL);
  if (!home.ok) throw new Error(`SCG CON home page: HTTP ${home.status}`);
  const events: ArtistEvent[] = [];
  for (const url of parseEventLinks(await home.text())) {
    const res = await fetchFn(url);
    if (!res.ok) {
      log(`  skipped ${url}: HTTP ${res.status}`);
      continue;
    }
    const parsed = parseEventPage(await res.text(), url);
    if (!parsed || parsed.end < today) continue;
    const artists = [...new Set(parsed.guests.flatMap((g) => matcher.match(g) ?? []))];
    for (const guest of parsed.guests) {
      if (!matcher.match(guest)) log(`  unmatched guest at ${parsed.name}: ${guest}`);
    }
    if (!artists.length) continue;
    const event = {
      name: parsed.name,
      url: parsed.url,
      city: parsed.city,
      start: parsed.start,
      end: parsed.end,
    };
    events.push({ ...event, artists });
  }
  return events.sort((a, b) => a.start.localeCompare(b.start) || a.name.localeCompare(b.name));
}
