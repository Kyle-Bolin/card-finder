import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { openDeckPage, TABLETOP_ORIGIN } from "./harness/world";

const openPanel = async (page: Page) => {
  await openDeckPage(page);
  await page.getByRole("button", { name: "Card Finder", exact: true }).click();
};

test("the deck page shows the Card Finder button and a panel with the tagged cards", async ({
  page,
}) => {
  await openDeckPage(page);
  await expect(page.getByRole("button", { name: "Card Finder", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Card Finder", exact: true }).click();
  await expect(page.getByRole("button", { name: "Check local stores (13 cards)" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Power level ↗" })).toBeVisible();
});

test("a check lists the stores with stock and the cards not found, and is saved", async ({
  page,
}) => {
  await openPanel(page);
  await page.getByRole("button", { name: "Check local stores (13 cards)" }).click();

  await expect(page.getByText("Found 2 of 13 cards in stock at 1 stores")).toBeVisible();
  await expect(page.getByText("Checked 3 stores")).toBeVisible();
  const store = page.locator(".cf-store");
  await expect(store).toHaveCount(1);
  await expect(store).toContainText("The Relentless Dragon");
  await expect(store).toContainText("2 of 13");
  const cloudshift = store.locator(".cf-card", { hasText: "Cloudshift" });
  await expect(cloudshift.locator(".cf-listing")).toHaveCount(2);
  await expect(cloudshift).toContainText("Commander Masters · LP");
  await expect(cloudshift).toContainText("$0.35 ×2");
  await expect(cloudshift).toContainText("Commander Masters · NM");
  await expect(cloudshift).toContainText("$0.45 ×4");
  await expect(store.locator(".cf-card", { hasText: "Pearl Medallion" })).toContainText("$1.25 ×1");

  // The store that lists Cloudshift with no stock isn't a result.
  await expect(page.getByText("BazaarGameTrading")).toHaveCount(0);
  const missing = page.locator(".cf-missing");
  await expect(missing).toContainText("Not in stock nearby (11)");
  await missing.locator("summary").click();
  await expect(missing).toContainText("Sword of Hearth and Home");
  await expect(missing).not.toContainText("Cloudshift");

  const lastCheck = await page.evaluate(
    () => window.__fakeExtension.local.lastCheck as Record<string, unknown>,
  );
  expect(lastCheck).toMatchObject({
    totalStores: 3,
    wanted: expect.arrayContaining([expect.objectContaining({ name: "Cloudshift" })]),
  });
  const results = lastCheck.results as { store: { name: string }; found: string[] }[];
  expect(results.map((r) => [r.store.name, r.found])).toEqual(
    expect.arrayContaining([
      ["The Relentless Dragon", ["Cloudshift", "Pearl Medallion"]],
      ["BazaarGameTrading", []],
      ["Midgard Hobbies and Games", []],
    ]),
  );
});

test("Power level opens EDH Power Level with the deck, commander included", async ({
  page,
  context,
}) => {
  await openPanel(page);
  const popup = context.waitForEvent("page");
  await page.getByRole("button", { name: "Power level ↗" }).click();
  const url = new URL((await popup).url());
  expect(url.origin + url.pathname).toBe("https://edhpowerlevel.com/");
  const list = url.searchParams.get("d") ?? "";
  expect(list.startsWith("1 Preston, the Vanisher~")).toBe(true);
  expect(list.endsWith("~Z~")).toBe(true);
  expect(url.search).toContain("Preston%2C+the+Vanisher");
});

test.describe("without site access", () => {
  test.use({ world: { permissionsGranted: false } });

  test("a check asks for access, which opens the settings page ready to grant it", async ({
    page,
  }) => {
    await openPanel(page);
    await page.getByRole("button", { name: "Check local stores (13 cards)" }).click();
    await expect(page.getByText("Card Finder needs access to store sites")).toBeVisible();
    await page.getByRole("button", { name: "Grant access" }).click();
    await expect
      .poll(() => page.evaluate(() => window.__fakeExtension.tabs))
      .toEqual([{ url: "https://extension.test/options/options.html?grant=1" }]);
  });
});

test.describe("with a Shopify store saved", () => {
  test.use({
    world: {
      local: {
        settings: {
          stores: [{ url: TABLETOP_ORIGIN, name: "Tabletop Gaming Center", platform: "shopify" }],
        },
      },
    },
  });

  test("a check shows its Cloudshift as in stock, with no quantity", async ({ page }) => {
    await openPanel(page);
    await page.getByRole("button", { name: "Check local stores (13 cards)" }).click();

    await expect(page.getByText("Checked 4 stores")).toBeVisible();
    const store = page.locator(".cf-store", { hasText: "Tabletop Gaming Center" });
    await expect(store).toHaveCount(1);
    const cloudshift = store.locator(".cf-card", { hasText: "Cloudshift" });
    await expect(cloudshift.locator(".cf-listing")).toHaveCount(2);
    await expect(cloudshift).toContainText("Avacyn Restored · NM");
    await expect(cloudshift).toContainText("$2.10 in stock");
    await expect(cloudshift).toContainText("$1.80 in stock");
    await expect(cloudshift).not.toContainText("×");
    // TCGplayer Pro stores are checked in the same run and still show quantities.
    await expect(page.locator(".cf-store", { hasText: "The Relentless Dragon" })).toContainText(
      "$0.45 ×4",
    );
  });
});
