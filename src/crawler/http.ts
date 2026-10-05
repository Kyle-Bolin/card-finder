import type { FetchFn } from "../lib/types";

/** Must look browser-like and avoid words like "crawler"/"bot": the storefront firewall blocks those. */
export const CRAWLER_USER_AGENT =
  "Mozilla/5.0 (compatible; card-finder/0.1; +https://github.com/Kyle-Bolin/card-finder)";

export interface PoliteFetchOptions {
  /** Minimum milliseconds between requests to the same rate-limit bucket. */
  intervalMs?: (bucket: string) => number;
  timeoutMs?: number;
  retries?: number;
  baseFetch?: FetchFn;
  sleep?: (ms: number) => Promise<void>;
}

/** All storefronts run on shared TCGplayer infrastructure, so they share one bucket. */
export function rateBucket(url: string): string {
  const host = new URL(url).hostname.toLowerCase();
  return host.endsWith(".tcgplayerpro.com") ? "tcgplayerpro.com" : host;
}

const defaultInterval = (bucket: string) =>
  bucket === "tcgplayerpro.com" ? 200 : bucket === "mp-search-api.tcgplayer.com" ? 300 : 1000;
const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export interface PoliteFetch {
  fetch: FetchFn;
  /** Requests made so far, per bucket. */
  counts: Map<string, number>;
}

/**
 * fetch() with an identifying User-Agent, per-bucket rate limiting, a timeout, and
 * retries with backoff on 429/5xx and network errors.
 */
export function politeFetch({
  intervalMs = defaultInterval,
  timeoutMs = 20_000,
  retries = 2,
  baseFetch = fetch,
  sleep = realSleep,
}: PoliteFetchOptions = {}): PoliteFetch {
  const nextSlot = new Map<string, number>();
  const counts = new Map<string, number>();

  async function waitTurn(bucket: string): Promise<void> {
    const now = Date.now();
    const slot = Math.max(now, nextSlot.get(bucket) ?? 0);
    nextSlot.set(bucket, slot + intervalMs(bucket));
    if (slot > now) await sleep(slot - now);
  }

  const fetchFn = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    const bucket = rateBucket(url);
    const headers = new Headers(init.headers);
    headers.set("User-Agent", CRAWLER_USER_AGENT);
    for (let attempt = 0; ; attempt++) {
      await waitTurn(bucket);
      counts.set(bucket, (counts.get(bucket) ?? 0) + 1);
      try {
        const res = await baseFetch(url, {
          ...init,
          headers,
          signal: AbortSignal.timeout(timeoutMs),
        });
        if ((res.status === 429 || res.status >= 500) && attempt < retries) {
          await sleep(1000 * 2 ** attempt);
          continue;
        }
        return res;
      } catch (err) {
        if (attempt >= retries) throw err;
        await sleep(1000 * 2 ** attempt);
      }
    }
  }) as FetchFn;

  return { fetch: fetchFn, counts };
}
