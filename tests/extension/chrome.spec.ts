import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, expect, test, type BrowserContext } from "@playwright/test";

// Loads the real build/chrome extension (not the fake runtime) into Chromium. Run
// `npm run build:all` first. Requests are served from recorded fixtures; the extension
// service worker's own requests are routed too (see the env var below).
// Only used inside worker.evaluate, where the extension runtime provides it.
declare const chrome: { storage: { local: { set(items: object): Promise<void> } } };

// Lets context.route() see the extension service worker's requests.
process.env.PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS = "1";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const extensionPath = join(root, "build/chrome");
const fixtures = join(root, "tests/fixtures");
const fixture = (path: string) => readFileSync(join(fixtures, path), "utf8");

const DECK_ID = "6bUjMtA1NUiqQYvr8uqXBg";
const CORS = { "access-control-allow-origin": "*" };

test.describe.configure({ mode: "serial" });

let context: BrowserContext;

test.beforeAll(async () => {
  context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), "cf-chrome-")), {
    channel: "chromium",
    headless: true,
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
  });
  // Registered first so it matches last: anything without a recorded response is blocked.
  await context.route(/^https?:/, (route) => route.abort("blockedbyclient"));
  await context.route(`https://moxfield.com/decks/${DECK_ID}`, (route) =>
    route.fulfill({
      body: fixture("moxfield/deck_page.html"),
      contentType: "text/html; charset=utf-8",
    }),
  );
  await context.route("https://api2.moxfield.com/v3/decks/all/*", (route) =>
    route.fulfill({
      body: fixture("moxfield/deck_with_tags.json"),
      headers: { ...CORS, "content-type": "application/json" },
    }),
  );
  await context.route("https://edhpowerlevel.com/**", (route) =>
    route.fulfill({ body: "<title>EDH Power Level</title>", contentType: "text/html" }),
  );
});

test.afterAll(async () => {
  await context.close();
});

test("the extension registers its service worker and options page", async () => {
  const worker =
    context.serviceWorkers()[0] ??
    (await context.waitForEvent("serviceworker", { timeout: 15000 }));
  const origin = `chrome-extension://${new URL(worker.url()).host}`;
  expect(worker.url()).toMatch(/^chrome-extension:\/\/.+\/background\.js$/);

  const page = await context.newPage();
  await page.goto(`${origin}/options/options.html`);
  await expect(page).toHaveTitle(/Card Finder/);
});

test("the content script adds the Card Finder panel to the saved deck page", async () => {
  const page = await context.newPage();
  await page.goto(`https://moxfield.com/decks/${DECK_ID}`);
  const button = page.getByRole("button", { name: "Card Finder", exact: true });
  await expect(button).toBeVisible({ timeout: 15000 });
  await button.click();
  await expect(page.getByRole("button", { name: "Check local stores (13 cards)" })).toBeVisible();
});

test("a check runs in the real background worker against recorded store data", async () => {
  // Stores are read from storage.local, so seed it from the extension's own options page.
  const worker =
    context.serviceWorkers()[0] ??
    (await context.waitForEvent("serviceworker", { timeout: 15000 }));
  await worker.evaluate(() =>
    chrome.storage.local.set({
      settings: {
        stores: [
          { url: "https://relentlessdragon.tcgplayerpro.com", name: "The Relentless Dragon" },
        ],
      },
    }),
  );
  await context.route(/^https:\/\/relentlessdragon\.tcgplayerpro\.com\/api\//, (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/catalog/search") {
      const { query } = route.request().postDataJSON() as { query: string };
      const file =
        {
          cloudshift: "tcgplayerpro/search_cloudshift.json",
          "pearl medallion": "tcgplayerpro/search_pearl_medallion.json",
        }[query.toLowerCase()] ?? "tcgplayerpro/search_no_results.json";
      return route.fulfill({
        body: fixture(file),
        headers: { ...CORS, "content-type": "application/json" },
      });
    }
    return route.fulfill({
      body: fixture("tcgplayerpro/skus_cloudshift_pearl_in_stock.json"),
      headers: { ...CORS, "content-type": "application/json" },
    });
  });

  const page = await context.newPage();
  await page.goto(`https://moxfield.com/decks/${DECK_ID}`);
  await page.getByRole("button", { name: "Card Finder", exact: true }).click();
  await page.getByRole("button", { name: "Check local stores (13 cards)" }).click();
  await expect(page.getByText("Found 2 of 13 cards in stock at 1 stores")).toBeVisible({
    timeout: 20000,
  });
  await expect(page.locator(".cf-store")).toContainText("The Relentless Dragon");
});

test("Power level opens the deck on edhpowerlevel.com", async () => {
  const page = await context.newPage();
  await page.goto(`https://moxfield.com/decks/${DECK_ID}`);
  await page.getByRole("button", { name: "Card Finder", exact: true }).click();
  const popup = context.waitForEvent("page");
  await page.getByRole("button", { name: "Power level ↗" }).click();
  expect((await popup).url()).toContain("edhpowerlevel.com");
});
