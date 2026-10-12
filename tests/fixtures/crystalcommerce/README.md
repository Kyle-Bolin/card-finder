# Crystal Commerce fixtures

Pages from Battleground Games & Hobbies (`store.battlegroundgames.com`), saved from Firefox as
"Web Page, HTML only" (the HTML the server sent). Every `<script>`, `<iframe>`, `<noscript>`,
`<style>`, `<link>`, `src`/`srcset`, inline event handler, CSRF token and absolute asset URL was
removed, so the pages load nothing.

- `search_goblin_bushwack.html`: `/products/search?q=goblin bushwack`, page 1 of 5. 17 products,
  some in stock (several conditions, counts 1 to 8) and many out of stock; includes foils as
  separate " - Foil" products and loose matches (Bushwhack, Frenzied Goblin, foreign names).
- `search_path_to_exile.html`: `/products/search?q=path to exile`. 20 products, all out of stock.
- `product_goblin_bushwhacker_showcase.html`: an in-stock product page ("1 in-stock").
- `product_path_to_exile.html`: an out-of-stock product page whose related-products list has
  in-stock rows.
