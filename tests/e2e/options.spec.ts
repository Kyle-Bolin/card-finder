import { expect, test } from "./fixtures";
import { OPTIONS_URL, TABLETOP_ORIGIN } from "./harness/world";

const stores = (page: import("@playwright/test").Page) => page.locator("#in-range li");

test("the approximate location comes from the IP lookup and lists the stores in range", async ({
  page,
}) => {
  await page.goto(OPTIONS_URL);
  await expect(page.locator("#location")).toHaveText("Location: Milford, NH 03055 (approximate)");
  await expect(page.locator("#range-summary")).toContainText("3 stores within 25 mi");
  await expect(stores(page)).toHaveCount(3);
  await expect(stores(page).first()).toContainText("BazaarGameTrading");
  await expect(stores(page).first()).toContainText("5.8 mi");
});

test("changing the range updates the stores in range", async ({ page }) => {
  await page.goto(OPTIONS_URL);
  await expect(stores(page)).toHaveCount(3);

  await page.locator("#radius").selectOption("10");
  await expect(page.locator("#range-summary")).toContainText("2 stores within 10 mi");
  await expect(stores(page)).toHaveCount(2);

  await page.locator("#radius").selectOption("50");
  await expect(page.locator("#range-summary")).toContainText("4 stores within 50 mi");
  await expect(stores(page)).toHaveCount(4);
  await expect(stores(page).last()).toContainText("rjsgamingNH");
});

test("changing the ZIP code re-centers the search", async ({ page }) => {
  await page.goto(OPTIONS_URL);
  await expect(stores(page)).toHaveCount(3);

  await page.locator("#zip").fill("03301");
  await page.getByRole("button", { name: "Change" }).click();
  await expect(page.locator("#location")).toHaveText("Location: Concord, NH 03301 (from your ZIP)");
  // From Concord the closest store is the one in Concord.
  await expect(stores(page).first()).toContainText("rjsgamingNH");
  await expect(stores(page).first()).toContainText("0.");
  await expect(page.getByRole("button", { name: "Use my approximate location" })).toBeVisible();
});

test("turning a store off excludes it from the check", async ({ page }) => {
  await page.goto(OPTIONS_URL);
  await expect(page.locator("#range-summary")).toContainText("Checking 3 in total");

  await page.getByLabel("Check The Relentless Dragon").uncheck();
  await expect(page.locator("#range-summary")).toContainText("Checking 2 in total");
  await expect(page.getByLabel("Check The Relentless Dragon")).not.toBeChecked();
  const settings = await page.evaluate(
    () => window.__fakeExtension.local.settings as { excluded: string[] },
  );
  expect(settings.excluded).toEqual(["https://relentlessdragon.tcgplayerpro.com"]);
});

test.describe("when the IP lookup fails", () => {
  test.use({ world: { ipLookupFails: true } });

  test("the settings page asks for a ZIP code", async ({ page }) => {
    await page.goto(`${OPTIONS_URL}?welcome=1`);
    await expect(page.locator("#location")).toHaveText(
      "We couldn't work out where you are. Enter your ZIP code to find stores.",
    );
    await expect(page.locator("#zip")).toBeFocused();
    await expect(stores(page)).toHaveCount(0);
  });
});

test.describe("without site access", () => {
  test.use({ world: { permissionsGranted: false } });

  test("the settings page offers Grant access, and the banner goes away once granted", async ({
    page,
  }) => {
    await page.goto(`${OPTIONS_URL}?grant=1`);
    await expect(page.getByText("Card Finder needs access to store sites")).toBeVisible();
    await page.getByRole("button", { name: "Grant access" }).click();
    await expect(page.locator("#access")).toBeHidden();
    await expect(page.evaluate(() => window.__fakeExtension.permissionRequests)).resolves.toEqual([
      { origins: ["https://*.tcgplayerpro.com/*"] },
    ]);
  });
});

test("adding a Shopify store by URL detects Shopify, asks for its site access and saves it", async ({
  page,
}) => {
  await page.goto(OPTIONS_URL);
  await page.locator("#store-url").fill(TABLETOP_ORIGIN);
  await page.getByRole("button", { name: "Add store" }).click();
  await expect(page.locator("#add-store-status")).toHaveText("Added Tabletop Gaming Center.");
  await expect(page.locator("#stores li")).toContainText("Tabletop Gaming Center");

  const requests = await page.evaluate(() => window.__fakeExtension.permissionRequests);
  expect(requests).toContainEqual({ origins: [`${TABLETOP_ORIGIN}/*`] });
  const settings = await page.evaluate(
    () => window.__fakeExtension.local.settings as { stores: unknown[] },
  );
  expect(settings.stores).toEqual([
    expect.objectContaining({
      url: TABLETOP_ORIGIN,
      name: "Tabletop Gaming Center",
      platform: "shopify",
    }),
  ]);
});
