import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { FetchFn } from "../src/lib/types";

export function fixture<T = unknown>(path: string): T {
  return JSON.parse(
    readFileSync(fileURLToPath(new URL(`./fixtures/${path}`, import.meta.url)), "utf8"),
  ) as T;
}

export interface Call {
  url: string;
  init?: RequestInit;
}

/** A fake fetch that answers from a route table and records calls. */
export function fakeFetch(routes: Record<string, { status?: number; body?: unknown }>): {
  fetchFn: FetchFn;
  calls: Call[];
} {
  const calls: Call[] = [];
  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    const route = routes[url];
    if (!route) return new Response("not found", { status: 404 });
    return new Response(JSON.stringify(route.body ?? {}), { status: route.status ?? 200 });
  }) as FetchFn;
  return { fetchFn, calls };
}
