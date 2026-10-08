import { readFileSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { BrowserContext, Page, Route } from "@playwright/test";
import { installFakeExtension, type FakeExtensionOptions } from "./fakeExtension";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const dist = join(root, "dist");
const fixtures = join(root, "tests/fixtures");

export const EXTENSION_ORIGIN = "https://extension.test";
export const DECK_ID = "6bUjMtA1NUiqQYvr8uqXBg";
export const DECK_URL = `https://moxfield.com/decks/${DECK_ID}`;
export const TABLETOP_ORIGIN = "https://www.tabletopgamingcenter.com";
export const OPTIONS_URL = `${EXTENSION_ORIGIN}/options/options.html`;

const fixture = (path: string) => readFileSync(join(fixtures, path), "utf8");

export interface WorldOptions {
  /** Contents of `storage.local` at the start. */
  local?: FakeExtensionOptions["local"];
  /** Site access granted at the start (default true). */
  permissionsGranted?: boolean;
  /** Whether the user allows a permission request (default true). */
  grantOnRequest?: boolean;
  /** Both IP location providers fail. */
  ipLookupFails?: boolean;
}

const CORS = { "access-control-allow-origin": "*" };

function json(route: Route, body: string, status = 200): Promise<void> {
  return route.fulfill({
    status,
    body,
    headers: { ...CORS, "content-type": "application/json" },
  });
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".png": "image/png",
  ".json": "application/json",
};

/** Search results by card name, per storefront; any other search finds nothing. */
const SEARCHES: Record<string, Record<string, string>> = {
  relentlessdragon: {
    cloudshift: "tcgplayerpro/search_cloudshift.json",
    "pearl medallion": "tcgplayerpro/search_pearl_medallion.json",
  },
  // Lists Cloudshift, but every copy is out of stock.
  bazaargametrading: { cloudshift: "tcgplayerpro/search_cloudshift.json" },
};
const SKUS: Record<string, string> = {
  relentlessdragon: "tcgplayerpro/skus_cloudshift_pearl_in_stock.json",
  bazaargametrading: "tcgplayerpro/skus_cloudshift_out_of_stock.json",
};

/** Every request the page made that no route covers. Tests assert this stays empty. */
export interface World {
  unrouted: string[];
}

/**
 * Sets up a browser context with the fake extension runtime and recorded network data.
 * Requests with no recorded response are aborted and listed in `unrouted`, so a test
 * can never reach the network.
 */
export async function createWorld(
  context: BrowserContext,
  options: WorldOptions = {},
): Promise<World> {
  const world: World = { unrouted: [] };

  await context.addInitScript(installFakeExtension, {
    extensionOrigin: EXTENSION_ORIGIN,
    local: options.local,
    permissionsGranted: options.permissionsGranted ?? true,
    grantOnRequest: options.grantOnRequest ?? true,
  });

  // Routes registered later win, so this catch-all goes first.
  await context.route(/.*/, (route) => {
    world.unrouted.push(`${route.request().method()} ${route.request().url()}`);
    return route.abort("blockedbyclient");
  });

  // Cross-origin calls from the page need CORS answers, including preflights.
  await context.route(/.*/, (route) => {
    const request = route.request();
    if (request.method() !== "OPTIONS" || !request.headers()["access-control-request-method"]) {
      return route.fallback();
    }
    return route.fulfill({
      status: 204,
      headers: {
        ...CORS,
        "access-control-allow-methods": "GET, POST, OPTIONS",
        "access-control-allow-headers": request.headers()["access-control-request-headers"] ?? "*",
      },
    });
  });

  await context.route(`${EXTENSION_ORIGIN}/**`, (route) => {
    const path = new URL(route.request().url()).pathname;
    try {
      const body = readFileSync(join(dist, path));
      return route.fulfill({
        body,
        contentType: MIME[extname(path)] ?? "application/octet-stream",
      });
    } catch {
      return route.fulfill({ status: 404, body: `${path} is not in dist/` });
    }
  });

  await context.route(DECK_URL, (route) =>
    route.fulfill({
      body: fixture("moxfield/deck_page.html"),
      contentType: "text/html; charset=utf-8",
    }),
  );
  await context.route("https://api2.moxfield.com/v3/decks/all/*", (route) =>
    json(route, fixture("moxfield/deck_with_tags.json")),
  );

  await context.route(/^https:\/\/([a-z0-9-]+)\.tcgplayerpro\.com\/api\//, async (route) => {
    const url = new URL(route.request().url());
    const store = url.hostname.split(".")[0] ?? "";
    if (url.pathname === "/api/catalog/search") {
      const { query } = route.request().postDataJSON() as { query: string };
      const file = SEARCHES[store]?.[query.toLowerCase()] ?? "tcgplayerpro/search_no_results.json";
      return json(route, fixture(file));
    }
    if (url.pathname === "/api/inventory/skus") {
      const file = SKUS[store];
      return json(route, file ? fixture(file) : "[]");
    }
    return route.fallback();
  });

  // Tabletop Gaming Center (Shopify): Cloudshift is in stock, nothing else is.
  await context.route(`${TABLETOP_ORIGIN}/**`, (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/") {
      return route.fulfill({
        body: fixture("shopify/tabletop_home.html"),
        contentType: "text/html; charset=utf-8",
      });
    }
    if (url.pathname === "/products.json") return json(route, '{"products":[]}');
    if (url.pathname === "/search/suggest.json") {
      const q = url.searchParams.get("q");
      return json(
        route,
        fixture(
          q === '"Cloudshift"'
            ? "shopify/tabletop_suggest_cloudshift.json"
            : "shopify/webway_suggest_sol_ring_empty.json",
        ),
      );
    }
    if (url.pathname === "/products/cloudshift-avacyn-restored.js") {
      return json(route, fixture("shopify/tabletop_product_cloudshift_avr.json"));
    }
    // The store lists a second Cloudshift printing that isn't in the recorded data.
    if (url.pathname.endsWith(".js")) return route.fulfill({ status: 404, body: "Not Found" });
    return route.fallback();
  });

  await context.route(
    "https://raw.githubusercontent.com/Kyle-Bolin/card-finder/**/data/storefronts.json",
    (route) => json(route, fixture("directory/storefronts.json")),
  );

  await context.route("https://ipapi.co/json/", (route) =>
    options.ipLookupFails
      ? json(route, fixture("ip/ipapi_error.json"), 429)
      : json(route, fixture("ip/ipapi_milford.json")),
  );
  await context.route("https://get.geojs.io/v1/ip/geo.json", (route) =>
    options.ipLookupFails ? json(route, "{}", 503) : json(route, fixture("ip/geojs_milford.json")),
  );
  await context.route("https://api.zippopotam.us/us/03301", (route) =>
    json(route, fixture("zippopotam/03301.json")),
  );

  // The page behind "Power level ↗": nothing to test beyond the URL it was opened with.
  await context.route("https://edhpowerlevel.com/**", (route) =>
    route.fulfill({ body: "<title>EDH Power Level</title>", contentType: "text/html" }),
  );

  return world;
}

/** The deck page with the built background and content scripts running, as at `document_idle`. */
export async function openDeckPage(page: Page): Promise<void> {
  await page.goto(DECK_URL);
  await page.addScriptTag({ path: join(dist, "background.js") });
  await page.addScriptTag({ path: join(dist, "content/moxfield.js") });
}
