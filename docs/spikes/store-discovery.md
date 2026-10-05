# Spike: discovering TCGplayer Pro storefronts

Issues: #21 (nearby finder), #22 (directory crawler). Investigated 2026-10-05.

There is no public list of TCGplayer Pro storefronts. What we tried:

| Source                                     | Result                                                                                                                                                                           |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Brute-forcing `{x}.tcgplayerpro.com`       | Infeasible (37^n names) and abusive. DNS is a wildcard; unknown names reach the app and get a 404 from `/api/site`.                                                              |
| Certificate transparency (crt.sh)          | No help: every storefront uses the single `*.tcgplayerpro.com` certificate.                                                                                                      |
| Wayback Machine CDX API                    | archive.org resets connections from the cloud environment.                                                                                                                       |
| Common Crawl CDX API                       | Wildcard/domain queries time out (504) or reset.                                                                                                                                 |
| Common Crawl Parquet index (DuckDB, HTTPS) | Works, about 30s per crawl. 10 crawls (2023–2026) → 118 hosts, 102 still live (`data/commoncrawl-storefronts.json`). Each crawl samples only about 20 storefronts.               |
| WPN locator + subdomain guessing           | 10 storefronts within 50 mi and 32 within 100 mi of Manchester, NH (ZIP 03103). Only 1 of those 32 is in the Common Crawl list, so the sources are complementary, not redundant. |

## WPN store locator

`POST https://api.tabletop.wizards.com/silverbeak-griffin-service/graphql`, no auth. The
`storesByLocation` query returns name, address, lat/lng, distance (meters), phone, website and
email, plus `showEmailInSEL` (whether the store shows its email publicly; we only use
emails when it's true). `page` is zero-based.

## Guessing misses

- Names with a trailing city and no separator ("The Relentless Dragon Nashua"): handled by
  stripping trailing words that appear in the address.
- Website set to Discord/Facebook: handled by skipping generic hosts and using name variants.
- Subdomains unrelated to the name (`battlegroundsct` for "Battlegrounds Gaming",
  `aaambaaam`, `boardgamingwedu` for "BGE's Tabletop"): not guessable; needs the homepage
  link scan or Common Crawl (#22).

## Re-running the Common Crawl query

```sh
pip install duckdb
python3 scripts/commoncrawl_storefronts.py CC-MAIN-2025-51 CC-MAIN-2025-38 CC-MAIN-2025-26
```
