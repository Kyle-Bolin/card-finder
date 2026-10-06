import browser from "webextension-polyfill";

/** Minimal async key-value store: `browser.storage.*` areas and in-memory maps both fit. */
export interface KeyValueStore {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
}

interface Entry<T> {
  at: number;
  value: T;
}

export function memoryStore(): KeyValueStore {
  const map = new Map<string, unknown>();
  return {
    get: async (key) => map.get(key),
    set: async (key, value) => void map.set(key, value),
  };
}

/** Adapter for a `browser.storage` area; falls back to memory if the area is missing or throws. */
export function storageAreaStore(
  area: () => browser.Storage.StorageArea | undefined,
): KeyValueStore {
  const fallback = memoryStore();
  return {
    async get(key) {
      try {
        const a = area();
        if (a) return (await a.get(key))[key];
      } catch {
        // fall through to memory
      }
      return fallback.get(key);
    },
    async set(key, value) {
      try {
        const a = area();
        if (a) return await a.set({ [key]: value });
      } catch {
        // fall through to memory
      }
      return fallback.set(key, value);
    },
  };
}

export const SEARCH_CACHE_TTL_MS = 10 * 60 * 1000;

/** Values expire `ttlMs` after being stored. */
export class TtlCache<T> {
  constructor(
    private readonly store: KeyValueStore,
    private readonly prefix: string,
    private readonly ttlMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  async get(key: string): Promise<T | undefined> {
    const entry = (await this.store.get(this.prefix + key)) as Entry<T> | undefined;
    if (!entry || typeof entry.at !== "number") return undefined;
    return this.now() - entry.at < this.ttlMs ? entry.value : undefined;
  }

  async set(key: string, value: T): Promise<void> {
    await this.store.set(this.prefix + key, { at: this.now(), value } satisfies Entry<T>);
  }

  /** Cached value, or the result of `load` (which is then cached). */
  async getOrLoad(key: string, load: () => Promise<T>): Promise<T> {
    const hit = await this.get(key);
    if (hit !== undefined) return hit;
    const value = await load();
    await this.set(key, value);
    return value;
  }
}

/** Search results per (store, card), kept in session storage (cleared when the browser closes). */
export function sessionSearchStore(): KeyValueStore {
  return storageAreaStore(() => browser.storage?.session);
}
