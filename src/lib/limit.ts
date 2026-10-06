import type { FetchFn } from "./types";

/** Wrap `fetchFn` so at most `max` requests are in flight at once, across all callers. */
export function limitFetch(fetchFn: FetchFn, max: number): FetchFn {
  let active = 0;
  const waiting: (() => void)[] = [];
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (active >= max) await new Promise<void>((resolve) => waiting.push(resolve));
    else active++;
    try {
      return await fetchFn(input, init);
    } finally {
      const next = waiting.shift();
      if (next)
        next(); // hand the slot straight to the next waiter
      else active--;
    }
  }) as FetchFn;
}
