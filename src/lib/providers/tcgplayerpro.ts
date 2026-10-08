import { isSingleCard, matchesCard, parseCondition } from "../matching";
import { mapLimit } from "../storeFinder";
import { getSkus, productUrl, searchProducts, type CatalogProduct } from "../tcgplayerpro";
import type { Listing, WantedCard } from "../types";
import { cachedSearch, type StoreProvider } from "./types";

/**
 * One catalog search per card (exact name matches only, a few at a time), then one
 * batched inventory lookup.
 */
export const tcgplayerProProvider: StoreProvider = {
  platform: "tcgplayerpro",
  async findListings(store, wanted: WantedCard[], fetchFn, { cardConcurrency, searchCache }) {
    const perCard = await mapLimit(wanted, cardConcurrency, async (card) =>
      (
        await cachedSearch(searchCache, `${store.url}|${card.name.toLowerCase()}`, () =>
          searchProducts(store.url, card.name, fetchFn),
        )
      )
        .filter((p) => matchesCard(p.name, card.name) && isSingleCard(p.setName, p.name))
        .map((product) => ({ card: card.name, product })),
    );
    const matches: { card: string; product: CatalogProduct }[] = perCard.flat();
    if (!matches.length) return [];
    const skus = await getSkus(store.url, [...new Set(matches.map((m) => m.product.id))], fetchFn);
    const listings: Listing[] = [];
    for (const { card, product } of matches) {
      for (const sku of skus.get(product.id) ?? []) {
        if (sku.quantity <= 0) continue;
        listings.push({
          storeUrl: store.url,
          cardName: card,
          productName: product.name,
          setName: product.setName,
          condition: parseCondition(sku.conditionName),
          language: sku.languageName,
          foil: sku.isFoil,
          price: Number(sku.price),
          quantity: sku.quantity,
          url: productUrl(store.url, product),
        });
      }
    }
    return listings;
  },
};
