import { PRICE_BASKET } from "../../src/lib/priceBasket";
import { expect, test } from "./fixtures";
import { EXTENSION_ORIGIN } from "./harness/world";

const PRICES_URL = `${EXTENSION_ORIGIN}/prices/prices.html`;

/** Price multiplier per store, and how many basket cards it stocks. */
const STORES: Record<string, { factor: number; cards: number }> = {
  bazaargametrading: { factor: 0.8, cards: PRICE_BASKET.length },
  relentlessdragon: { factor: 1, cards: PRICE_BASKET.length },
  // Too few basket cards to be ranked.
  midgardcomicsangames: { factor: 1, cards: 3 },
};

test.beforeEach(async ({ context }) => {
  // Every basket card exists at every store as product i+1, priced (i+1) × the store's factor.
  await context.route(/^https:\/\/([a-z0-9-]+)\.tcgplayerpro\.com\/api\//, async (route) => {
    const url = new URL(route.request().url());
    const store = STORES[url.hostname.split(".")[0] ?? ""];
    const headers = { "access-control-allow-origin": "*", "content-type": "application/json" };
    if (!store) return route.fallback();
    if (url.pathname === "/api/catalog/search") {
      const { query } = route.request().postDataJSON() as { query: string };
      const index = PRICE_BASKET.findIndex((c) => c.name.toLowerCase() === query.toLowerCase());
      const items =
        index >= 0 && index < store.cards
          ? [
              {
                id: index + 1,
                name: PRICE_BASKET[index]?.name,
                setName: "Commander Masters",
                productLineUrlName: "magic",
                setUrlName: "commander-masters",
                productUrlName: "card",
              },
            ]
          : [];
      return route.fulfill({ headers, body: JSON.stringify({ products: { items } }) });
    }
    if (url.pathname === "/api/inventory/skus") {
      const ids = (url.searchParams.get("productIds") ?? "").split(",").map(Number);
      const body = ids.map((id) => ({
        productId: id,
        skus: [
          {
            conditionName: "Near Mint",
            languageName: "English",
            price: id * store.factor,
            quantity: 2,
            isFoil: false,
          },
        ],
      }));
      return route.fulfill({ headers, body: JSON.stringify(body) });
    }
    return route.fallback();
  });
});

test("ranks stores by price and lists a low-coverage store as not enough data", async ({
  page,
}) => {
  await page.goto(PRICES_URL);
  await expect(page.locator("#status")).toContainText("Checked 3 stores");

  const rows = page.locator("#ranking > li");
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toContainText("BazaarGameTrading");
  await expect(rows.nth(0)).toContainText("below area median");
  await expect(rows.nth(0)).toContainText("25 of 25 basket cards");
  await expect(rows.nth(1)).toContainText("The Relentless Dragon");
  await expect(rows.nth(1)).toContainText("above area median");
  await expect(rows.nth(2)).toContainText("Midgard Hobbies and Games");
  await expect(rows.nth(2)).toContainText("not enough data");
  await expect(rows.nth(2)).toContainText("3 of 25 basket cards");

  // Per-card detail: Sol Ring is product 1, $0.80 at the cheapest store.
  await rows.nth(0).locator("summary").click();
  await expect(rows.nth(0)).toContainText("Sol Ring: $0.80");

  await page.locator("#sort").selectOption("closest");
  await expect(rows.nth(0)).toContainText("BazaarGameTrading");
  await expect(page.locator("#updated")).toContainText("Last updated");
});
