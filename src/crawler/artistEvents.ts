/**
 * Builds data/artist-events.json: upcoming events whose guest artists are Scryfall artists.
 *
 *   npm run artist-events [-- --data <dir>]
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import type { ArtistEvents } from "../lib/artistEvents";
import { artistMatcher } from "./artistNames";
import { politeFetch } from "./http";
import { fetchScgconEvents, SCGCON_SOURCE } from "./scgcon";

const SCRYFALL_ARTISTS_URL = "https://api.scryfall.com/catalog/artist-names";

const { values } = parseArgs({ options: { data: { type: "string", default: "data" } } });
const dataDir = values.data ?? "data";
const http = politeFetch();

const catalog = await http.fetch(SCRYFALL_ARTISTS_URL, { headers: { Accept: "application/json" } });
if (!catalog.ok) throw new Error(`Scryfall artist names: HTTP ${catalog.status}`);
const names = ((await catalog.json()) as { data: string[] }).data;

const now = new Date();
const today = now.toISOString().slice(0, 10);
const matcher = artistMatcher(names);
const events = await fetchScgconEvents(http.fetch, matcher, today, console.log);

const output: ArtistEvents = {
  generatedAt: now.toISOString().replace(/\.\d+Z$/, "Z"),
  sources: [SCGCON_SOURCE],
  events,
};
mkdirSync(dataDir, { recursive: true });
const path = join(dataDir, "artist-events.json");
// Keep the old file (and its timestamp) when nothing changed, so the daily run commits only real changes.
const previous = existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as ArtistEvents) : null;
const same =
  previous &&
  JSON.stringify([previous.sources, previous.events]) ===
    JSON.stringify([output.sources, output.events]);
if (!same) writeFileSync(path, `${JSON.stringify(output, null, 2)}\n`);
console.log(`Wrote ${events.length} event${events.length === 1 ? "" : "s"} with guest artists.`);
