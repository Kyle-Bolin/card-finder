# Moxfield fixtures

- `deck_with_tags.json`: the v3 API response for the test deck
  (`api2.moxfield.com/v3/decks/all/6bUjMtA1NUiqQYvr8uqXBg`), saved from Safari and trimmed to the
  fields Card Finder reads.
- `deck_page.html`: the rendered deck page (`moxfield.com/decks/6bUjMtA1NUiqQYvr8uqXBg`), saved from
  Safari as a web archive. Every `<script>`, `<iframe>`, `<link>`, `src`/`srcset`, inline event
  handler and `url(...)` was removed, so the page loads nothing; the deck author's username is
  replaced with `deck_author`. Use it as the page the content script runs on in browser tests.
