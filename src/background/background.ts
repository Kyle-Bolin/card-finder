import browser from "webextension-polyfill";
import { checkStores, type StoreResult } from "../lib/check";
import { SEARCH_CACHE_TTL_MS, TtlCache, sessionSearchStore } from "../lib/cache";
import {
  diffCheck,
  listKey,
  loadDeckHistory,
  saveDeckHistory,
  type CheckChanges,
} from "../lib/history";
import { loadLastCheck, saveLastCheck } from "../lib/lastCheck";
import type { CatalogProduct } from "../lib/tcgplayerpro";
import {
  CHECK_PORT,
  type BackgroundRequest,
  type CheckEvent,
  type CheckRequest,
} from "../lib/messages";
import { missingOrigins, STORE_ORIGINS } from "../lib/permissions";
import { shouldShowWelcomeOnInstall, WELCOME_PARAM } from "../lib/onboarding";
import { loadSettings, saveSettings } from "../lib/settings";
import { resolveStores } from "../lib/resolveStores";
import { mapLimit, withCoordinates } from "../lib/storeFinder";

export interface FetchTextResponse {
  ok: boolean;
  status: number;
  body?: string;
  error?: string;
}

/** Catalog searches are reused for 10 minutes; SKU stock is always fetched fresh. */
const searchCache = new TtlCache<CatalogProduct[]>(
  sessionSearchStore(),
  "search:",
  SEARCH_CACHE_TTL_MS,
);

const ALLOWED_FETCH_HOSTS = new Set(["api2.moxfield.com", "api.moxfield.com"]);

function isAllowed(url: string): boolean {
  try {
    const { protocol, hostname } = new URL(url);
    return protocol === "https:" && ALLOWED_FETCH_HOSTS.has(hostname);
  } catch {
    return false;
  }
}

async function fetchText(url: string): Promise<FetchTextResponse> {
  if (!isAllowed(url)) return { ok: false, status: 0, error: "URL not allowed" };
  try {
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    return { ok: res.ok, status: res.status, body: await res.text() };
  } catch (err) {
    return { ok: false, status: 0, error: String(err) };
  }
}

browser.runtime.onMessage.addListener(async (message: unknown) => {
  const request = message as Partial<BackgroundRequest>;
  switch (request?.type) {
    // Lets content scripts make requests from the extension's own context, which has
    // host permissions and isn't subject to the page's CORS rules.
    case "fetchText":
      return typeof request.url === "string" ? fetchText(request.url) : undefined;
    case "openOptions":
      if (request.grant) {
        await browser.tabs.create({ url: browser.runtime.getURL("options/options.html?grant=1") });
      } else {
        await browser.runtime.openOptionsPage();
      }
      return undefined;
    case "openResults": {
      const query = typeof request.query === "string" ? request.query : "";
      await browser.tabs.create({ url: browser.runtime.getURL(`results/results.html${query}`) });
      return undefined;
    }
    default:
      return undefined;
  }
});

browser.runtime.onInstalled.addListener((details) => {
  if (!shouldShowWelcomeOnInstall(details)) return;
  void browser.tabs.create({
    url: browser.runtime.getURL(`options/options.html?${WELCOME_PARAM}=1`),
  });
});

// Store checks run here: the worker has host permissions for the storefronts.
browser.runtime.onConnect.addListener((port) => {
  if (port.name !== CHECK_PORT) return;
  let connected = true;
  port.onDisconnect.addListener(() => (connected = false));
  const send = (event: CheckEvent) => {
    if (connected) port.postMessage(event);
  };

  port.onMessage.addListener(async (message: unknown) => {
    const request = message as Partial<CheckRequest>;
    if (request?.type !== "start" || !Array.isArray(request.wanted)) return;
    // Location + range + exclusions + always-include stores + directory → stores to check.
    const resolved = await resolveStores();
    const { filters } = resolved.settings;
    let { stores } = resolved;
    if (!stores.length) {
      send({ type: "no-stores" });
      return;
    }
    const origins = await missingOrigins(STORE_ORIGINS);
    if (origins.length) {
      send({ type: "needs-permission", origins });
      return;
    }
    send({ type: "started", totalStores: stores.length, filters });
    // Always-include stores saved before coordinates existed are located once, on their next check.
    const saved = resolved.settings.stores;
    if (saved.some((s) => s.latitude === undefined)) {
      const located = await mapLimit(saved, 3, (store) => withCoordinates(store));
      if (located.some((s, i) => s !== saved[i])) {
        stores = stores.map((s) => located.find((l) => l.url === s.url) ?? s);
        await saveSettings({ ...(await loadSettings()), stores: located });
      }
    }
    try {
      const results: StoreResult[] = await checkStores(
        stores,
        request.wanted,
        (result) => send({ type: "result", result }),
        { filters, previous: (await loadLastCheck())?.results, searchCache },
      );
      const at = new Date().toISOString();
      let changes: CheckChanges | undefined;
      // Nothing to compare or remember if every store failed.
      if (results.some((r) => !r.error)) {
        try {
          const deckKey = request.deckKey ?? listKey(request.wanted);
          const diff = diffCheck(await loadDeckHistory(deckKey), results, request.wanted, at);
          await saveDeckHistory(deckKey, diff.history);
          changes = diff.changes;
        } catch {
          // History is a nicety; the results still count.
        }
      }
      await saveLastCheck({
        at,
        label: request.label ?? "Card list",
        wanted: request.wanted,
        totalStores: stores.length,
        filters,
        results,
        changes,
      });
      send({ type: "done", changes });
    } catch (err) {
      send({ type: "error", message: err instanceof Error ? err.message : String(err) });
    }
  });
});
