# Spike: store platforms other than TCGplayer Pro

Surveyed 2026-10-07: every Wizards store-locator (WPN) store within 100 mi of Milford, NH (03055), 201 stores in all.
The question was which e-commerce platforms they use for singles, and whether a browser extension can search them.

## Counts

| Platform                                           |         Stores | Searchable singles?       |
| -------------------------------------------------- | -------------: | ------------------------- |
| TCGplayer Pro (already in `data/storefronts.json`) |             51 | yes, supported            |
| Facebook / Discord / WPN page / dead link only     |             57 | no                        |
| GameStop, Best Buy                                 |             31 | no                        |
| Info-only website (hours, events)                  |             26 | no                        |
| No website listed                                  |              8 | no                        |
| Shopify without Magic singles                      |              7 | no                        |
| **Shopify + BinderPOS**                            |          **4** | yes                       |
| WooCommerce                                        |              4 | yes                       |
| Lightspeed eCom                                    |    3 (2 sites) | yes                       |
| **Crystal Commerce**                               | **3** (1 site) | yes, see robots.txt below |
| ShadowPOS                                          |              3 | HTML only                 |
| TCGplayer marketplace seller (link)                |              2 | yes (marketplace API)     |
| BigCommerce, ComicHub                              |         1 each | yes                       |

About 21 stores, on about 17 sites, have searchable singles off TCGplayer Pro. None of them is within 30 mi of Milford.
The nearest are:

- Webway Games, 33 mi (BinderPOS)
- PLAYNOW! Westborough, 38 mi (Lightspeed)
- Battleground Games Framingham and Saugus, 39–41 mi (Crystal Commerce)

## Shopify + BinderPOS

BinderPOS syncs a store's inventory into Shopify, so it uses Shopify's public storefront endpoints.
`robots.txt` on all four stores allows both endpoints below.
Stores: Webway Games, Pandemonium Books & Games, Dynamic Card Collectors, Tabletop Gaming Center.

**Search:**

```
GET {origin}/search/suggest.json?q="Cloudshift"&resources[type]=product&resources[limit]=10
```

- The response has `resources.results.products[]`, with `title`, `handle`, `url`, `type`, `vendor`, `price`, `available` and `tags`. The `variants` array is empty.
- The limit is at most **10** products, and results mix in other games and books. Keep only `type` matching `/magic|mtg/i`, such as "Magic: The Gathering Singles" or "MTG Single".
- Quote the card name. An unquoted `Sol Ring` at Webway returned Flesh and Blood and Bushido products (`webway_suggest_sol_ring_unquoted_noise.json`).
- A quoted search can come back empty even for a store that sells Magic (`webway_suggest_sol_ring_empty.json`). Report that as "not found", not as an error.

**Details:**

```
GET {origin}/products/{handle}.js
```

- Returns `variants[]` with `title`, `price` (in **cents**), `available` (boolean) and `option1`–`option3`. `options[]` names the axes.
- **Quantity is not exposed.** `inventory_quantity` is absent, so a listing is "in stock" without a count.
- Variant naming differs between stores:
  - Pandemonium: options Condition / Language / Printing, e.g. `Near Mint / English / Normal`
  - Tabletop Gaming Center and Dynamic: a single option, e.g. `Near Mint`, `Lightly Played Foil`, `Damaged`
- Product titles look like `Sol Ring [3ED - N/A]`, `Sol Ring (1734) [SLD - 1734]`, `Cloudshift [Avacyn Restored]` or `Sol Ring (0912) (Rainbow Foil) [Secret Lair Drop Series]`.
  - The card name is the text before the first ` (` or ` [`.
  - The set is the last `[...]`, or `vendor` when `vendor` isn't "Magic: The Gathering".
- The `.js` endpoint sends `Access-Control-Allow-Origin: *`; `suggest.json` sends no CORS header. Fetch both from the background worker, which has host permissions.

**Fixtures:** `tests/fixtures/shopify/`. All are trimmed real responses from these stores.

## Crystal Commerce

The 3 Battleground Games & Hobbies locations use one store at `store.battlegroundgames.com`. Its main site is WordPress.

**`store.battlegroundgames.com/robots.txt` disallows everything for every user agent except Google's crawlers.** So:

- The **crawler must never fetch** that host. A store's Crystal Commerce URL can be recorded from a link on its main site without fetching it.
- **Card Finder's checks are not crawling.** When the user presses Check, the extension makes one search per wanted card, from the user's browser, on the user's behalf. That is the same request as the user searching the site.
- This spike didn't fetch it, so there are no Crystal Commerce fixtures yet. They need a search results page and a product page saved from Safari (web archive), sanitized like `tests/fixtures/moxfield/deck_page.html`.

Crystal Commerce storefronts are server-rendered HTML. The usual search is `GET /products/search?q=<name>`, with each listing's condition, price and quantity in the HTML. Confirm this against the saved page.
The extension's background is a service worker with no `DOMParser`, so the parser has to work on strings, or run in an offscreen or extension page.

## Recommendation

1. **Shopify + BinderPOS first.** It has a standard JSON API, robots allows it, and the fixtures are recorded.
2. **Crystal Commerce** after its fixtures are saved from Safari.
3. Later, if wanted: TCGplayer marketplace sellers (2 stores; the crawler already uses `mp-search-api`), then WooCommerce and Lightspeed.

### Shape

- `src/lib/check.ts` `findListings` is TCGplayer Pro-specific today. Introduce a provider interface along these lines:

  ```ts
  interface StoreProvider {
    platform: "tcgplayerpro" | "shopify" | "crystalcommerce";
    findListings(store: Store, wanted: WantedCard[], fetchFn: FetchFn): Promise<Listing[]>;
  }
  ```

  Pick the provider by `store.platform`, with `tcgplayerpro` as the default for stored data.

- `Listing.quantity` becomes optional (Shopify has none), and the results UI shows "in stock" when it's missing.
- **Host permissions:** these stores sit on arbitrary domains, unlike `*.tcgplayerpro.com`. Request each store's origin when it's added or selected (`permissions.request`, from a click), and extend the existing missing-access check (#41) from `STORE_ORIGINS` to the origins of the current store set.
- **Directory:** add an optional `platform` to `DirectoryStorefront`. The crawler can fingerprint WPN websites for Shopify, by fetching the homepage and the `suggest.json` probe, both allowed. Until then, adding a store by URL can detect Shopify (`/products.json` or the `Shopify` global) and Crystal Commerce.
