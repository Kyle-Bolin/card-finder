import browser from "webextension-polyfill";
import { checkStores, type StoreResult } from "../lib/check";
import { saveLastCheck } from "../lib/lastCheck";
import {
  CHECK_PORT,
  type BackgroundRequest,
  type CheckEvent,
  type CheckRequest,
} from "../lib/messages";
import { loadSettings } from "../lib/settings";

export interface FetchTextResponse {
  ok: boolean;
  status: number;
  body?: string;
  error?: string;
}

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
      await browser.runtime.openOptionsPage();
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
    const { stores, filters } = await loadSettings();
    if (!stores.length) {
      send({ type: "no-stores" });
      return;
    }
    send({ type: "started", totalStores: stores.length, filters });
    try {
      const results: StoreResult[] = await checkStores(
        stores,
        request.wanted,
        (result) => send({ type: "result", result }),
        { filters },
      );
      await saveLastCheck({
        at: new Date().toISOString(),
        label: request.label ?? "Card list",
        wanted: request.wanted,
        totalStores: stores.length,
        filters,
        results,
      });
      send({ type: "done" });
    } catch (err) {
      send({ type: "error", message: err instanceof Error ? err.message : String(err) });
    }
  });
});
