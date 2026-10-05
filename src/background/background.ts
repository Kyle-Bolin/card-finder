import browser from "webextension-polyfill";

export interface FetchTextRequest {
  type: "fetchText";
  url: string;
}

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

// Lets content scripts make requests from the extension's own context, which has
// host permissions and isn't subject to the page's CORS rules.
browser.runtime.onMessage.addListener(
  async (message: unknown): Promise<FetchTextResponse | undefined> => {
    const request = message as Partial<FetchTextRequest>;
    if (request?.type !== "fetchText" || typeof request.url !== "string") return undefined;
    if (!isAllowed(request.url)) return { ok: false, status: 0, error: "URL not allowed" };
    try {
      const res = await fetch(request.url, { headers: { Accept: "application/json" } });
      return { ok: res.ok, status: res.status, body: await res.text() };
    } catch (err) {
      return { ok: false, status: 0, error: String(err) };
    }
  },
);
