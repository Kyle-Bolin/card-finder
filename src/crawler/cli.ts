/**
 * Builds data/storefronts.json, the directory of TCGplayer Pro storefronts.
 *
 *   npm run crawl                          # full US run (incremental)
 *   npm run crawl -- --zip 03055 --miles 30  # just one area, for testing
 *
 * Options:
 *   --zip <zip> --miles <n>   crawl only around a ZIP code
 *   --limit <n>               check at most n new WPN stores
 *   --recheck-days <n>        re-check stores without a storefront after n days (default 30)
 *   --concurrency <n>         parallel stores (default 4; rate limits still apply)
 *   --data <dir>              data directory (default ./data)
 *   --marketplace-products <n> best sellers per product line to collect Pro sellers from
 *                             (default 200; 0 for --zip runs)
 *   --product-lines <list>    comma-separated TCGplayer product lines
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import type { Directory } from "../lib/directory";
import { zipToLocation } from "../lib/storeFinder";
import { crawl, EMPTY_STATE, type CrawlState, type SeedStorefront } from "./crawl";
import { politeFetch } from "./http";

function readJson<T>(path: string, fallback: T): T {
  return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as T) : fallback;
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

const { values } = parseArgs({
  options: {
    zip: { type: "string" },
    miles: { type: "string", default: "50" },
    limit: { type: "string" },
    "recheck-days": { type: "string", default: "30" },
    concurrency: { type: "string", default: "4" },
    data: { type: "string", default: "data" },
    "marketplace-products": { type: "string" },
    "product-lines": {
      type: "string",
      default: "magic,pokemon,yugioh,lorcana-tcg,one-piece-card-game",
    },
  },
});

const dataDir = values.data ?? "data";
mkdirSync(dataDir, { recursive: true });
const directoryPath = join(dataDir, "storefronts.json");
const statePath = join(dataDir, "crawl-state.json");
const seedPath = join(dataDir, "commoncrawl-storefronts.json");

const previous = readJson<Directory | null>(directoryPath, null);
const state = readJson<CrawlState>(statePath, EMPTY_STATE);
const seeds: SeedStorefront[] = readJson<{ url: string }[]>(seedPath, []).map((s) => ({
  url: s.url,
  source: "commoncrawl",
}));

// Marketplace discovery is nationwide, so it's off by default for --zip test runs.
const marketplaceProducts = Number(values["marketplace-products"] ?? (values.zip ? 0 : 200));

const http = politeFetch();
const started = Date.now();
const region = values.zip
  ? { point: await zipToLocation(values.zip, http.fetch), miles: Number(values.miles) }
  : undefined;

const {
  directory,
  state: nextState,
  stats,
} = await crawl(previous, state, seeds, {
  fetchFn: http.fetch,
  region,
  limit: values.limit ? Number(values.limit) : undefined,
  recheckDays: Number(values["recheck-days"]),
  concurrency: Number(values.concurrency),
  marketplace:
    marketplaceProducts > 0
      ? {
          productLines: (values["product-lines"] ?? "").split(",").filter(Boolean),
          productsPerLine: marketplaceProducts,
        }
      : undefined,
  log: (message) => console.log(message),
  checkpoint: (inProgress) => writeJson(statePath, inProgress),
});

writeJson(directoryPath, directory);
writeJson(statePath, nextState);

const minutes = ((Date.now() - started) / 60_000).toFixed(1);
console.log(`
Done in ${minutes} min.
  WPN stores:        ${stats.wpnStores}
  Pro sellers:       ${stats.proSellers}
  Checked this run:  ${stats.checkedThisRun}
  Verified:          ${stats.verified}
  Storefronts:       ${stats.total} (+${stats.newStorefronts.length} new, -${stats.removedStorefronts.length} removed)
  Requests:          ${[...http.counts]
    .map(([bucket, n]) => `${bucket}=${n}`)
    .slice(0, 3)
    .join(", ")}${http.counts.size > 3 ? `, +${http.counts.size - 3} other hosts` : ""}`);
for (const url of stats.newStorefronts) console.log(`  + ${url}`);
for (const url of stats.removedStorefronts) console.log(`  - ${url}`);
