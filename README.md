# Card Finder

A Safari extension for **Mac and iPad** that checks your local game stores' TCGplayer Pro web
stores for the cards you've tagged as **unowned** in your Moxfield decks.

> Work in progress. See the [MVP epic](https://github.com/Kyle-Bolin/card-finder/issues/1).

What works today:

- **Find stores near me** (settings page): finds game stores near a ZIP code or your location
  using the Wizards store locator, then checks which have a TCGplayer Pro web store. Add them
  with one tap.
- **Add a store by URL**, e.g. `dmcomics.tcgplayerpro.com`.
- **Moxfield diagnostic**: on a Moxfield deck page, tap the **Card Finder** button and run the
  diagnostic to check how the extension can read the deck and its tags (issue #2).

## Development

Requires Node 22+.

```sh
npm install
npm run build        # bundle into dist/
npm run dev          # rebuild on change
npm test             # unit tests (Vitest, no network)
npm run lint         # ESLint + Prettier
npm run typecheck
```

Code layout:

```
src/
  lib/            platform-neutral logic (unit-tested)
  background/     service worker
  content/        injected into moxfield.com
  options/        settings page
  popup/          toolbar popup
static/           manifest, HTML, CSS, icons (copied into dist/)
tests/            Vitest tests and recorded API fixtures
docs/spikes/      API investigation notes
```

## Running in Safari

Safari extensions ship inside a small app built with Xcode, so you need a Mac with Xcode.

### One-time setup (Mac)

```sh
npm install
./scripts/create-xcode-project.sh   # generates xcode/ from dist/
```

The Xcode project references `dist/` in place, so after the first setup, `npm run build` (or
`npm run dev`) and then **Run** in Xcode picks up your changes.

### Mac

1. Open `xcode/Card Finder/Card Finder.xcodeproj`.
2. For each target, set your Apple ID team under **Signing & Capabilities**.
3. Choose the **Card Finder (macOS)** scheme and press **Run**.
4. In Safari: **Settings → Extensions → Card Finder → enable**, and allow it on
   moxfield.com, tcgplayerpro.com and the other listed sites.
   - If it doesn't appear: **Settings → Advanced → Show features for web developers**, then
     **Develop → Allow Unsigned Extensions** (this resets when Safari quits).

### iPad

1. Connect the iPad (or pair it over Wi-Fi) and turn on **Developer Mode** on the iPad
   (Settings → Privacy & Security).
2. Choose the **Card Finder (iOS)** scheme, select the iPad, and press **Run**.
3. On the iPad: **Settings → Apps → Safari → Extensions → Card Finder → On**, and allow the sites.

With a free Apple ID the iPad install expires after 7 days. See issue #20 for longer-lived
options (TestFlight).
