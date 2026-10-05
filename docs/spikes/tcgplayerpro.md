# Spike: TCGplayer Pro storefront inventory API

Issue: #3. Tested 2026-10-05 against `dmcomics.tcgplayerpro.com` (Double Midnight Comics)
and `mdgamehaven.tcgplayerpro.com`.

## Summary

**Go.** Every TCGplayer Pro storefront is the same JavaScript app
(`storefronts-app.tcgplayer.com/app.js`) backed by a JSON API on the store's own domain.
Two plain HTTP calls give us everything we need. No browser or HTML scraping is required.

## Access rules

- The store's AWS load balancer returns **403** unless the `User-Agent` starts like a
  browser. Requests with no UA, a `python-httpx/...` UA, or a `HeadlessChrome` UA are blocked.
- A polite, identifying UA **is accepted**:
  `Mozilla/5.0 (compatible; card-finder/0.1; +https://github.com/Kyle-Bolin/card-finder)`
- No cookies, auth, or CSRF tokens are needed.
- Requests from a cloud/datacenter IP worked, so GitHub Actions should be fine.

## Endpoints

All paths are relative to the store's base URL, e.g. `https://dmcomics.tcgplayerpro.com`.

### `POST /api/catalog/search`: find products

```json
{
  "query": "lightning bolt",
  "context": { "productLineName": "Magic: The Gathering" },
  "filters": {},
  "from": 0,
  "size": 24,
  "sort": [{ "field": "in-stock-price-sort", "order": "desc" }]
}
```

- **Only in-stock products are returned by default.** Adding
  `"filters": {"availableItems": ["Include Out of Stock"]}` includes sold-out products.
- `query` is a fuzzy text search. `"lightning bolt"` also returns
  `Thrum of the Vestige - Lightning Bolt (Showcase)`, so exact name matching must happen
  on our side (#8).
- An empty `query` lists the store's whole Magic inventory (18,986 products at
  dmcomics). `size` up to at least 1000 works, so a full inventory dump is about 19 requests.
- Response: `products.totalItems` plus `products.items[]` with `id`, `name`, `setName`,
  `rarityName`, `lowestPrice`, `productUrlName`, `setUrlName`, `productLineUrlName`,
  `customAttributes` (type, colors, etc). The response also includes facet counts under `filters`.
- Product names carry variant suffixes: `Lightning Bolt (084)`,
  `Lightning Bolt (Borderless)`, `Sol Ring (Retro Frame)`, `Sol Ring (Surge Foil)`.

### `GET /api/inventory/skus?productIds=1,2,3`: per-condition price and quantity

- Comma-separated product IDs; **at least 200 per request** works.
- Response: `[{productId, skus: [{skuId, conditionName, languageName, isFoil, price, quantity, ...}]}]`
- `conditionName` combines condition, foil and language:
  `"Heavily Played"`, `"Lightly Played Foil"`, `"Lightly Played - Japanese"`. Parse the
  condition from the prefix, and use `isFoil` / `languageName` for the rest.

### `GET /api/site`: store metadata

Store display name, address, hours and `seller.sellerKey`. Useful for showing the store's
real name in notifications.

### Product page URL

Built from the search result (verify the exact pattern when implementing #7):
`{base}/catalog/{productLineUrlName}/{setUrlName}/{productUrlName}/{id}`

## Recommended approach for #7

Two strategies; implement **per-card search** first, since it's simpler and plenty fast
for a typical wanted list.

1. **Per-card search** (`find_listings(name)`): one search per wanted card (in-stock only),
   keep exact name matches, then one batched `skus` call for the matched product IDs.
   About N+1 requests per store for N wanted cards.
2. **Full inventory dump** (later optimization): about 19 paged searches with an empty
   query, match names locally, then batched `skus` calls. Fixed cost per store regardless
   of wanted-list size. Worth it once the wanted list gets past a few dozen cards.

Politeness: about 1 request/second per store, identifying UA, retry with backoff on 429/5xx.

## Fixtures

`tests/fixtures/tcgplayerpro/`:

- `search_lightning_bolt.json`: fuzzy results including variants and a non-matching card
- `skus_lightning_bolt.json`: SKUs for those products (multiple conditions, foils)
- `search_no_results.json`: empty result
- `site.json`: store metadata
