# Card Finder

A browser extension for **Safari (Mac and iPad), Chrome and Firefox** that checks your local game stores' TCGplayer Pro web
stores for the cards you've tagged as **unowned** in your Moxfield decks.

## What it does

Tag the cards you still need in Moxfield, and Card Finder tells you which of your local stores
have them in stock, with prices and links.

How it works: Moxfield tag → your stores' TCGplayer Pro web stores → in-stock list.

## Install

Pick your browser: [Safari](#safari-mac-and-ipad), [Chrome](#chrome-and-other-chromium-browsers) or [Firefox](#firefox).

### Chrome and other Chromium browsers

Works in Chrome, Edge, Brave and Arc.

```sh
npm ci
npm run build:all
```

1. Open `chrome://extensions` (or `edge://extensions`) and turn on **Developer mode**.
2. Click **Load unpacked** and choose the `build/chrome` folder.

Chrome grants the site access at install. CI also uploads `card-finder-chrome.zip` as an artifact
on `main`.

### Firefox

```sh
npm ci
npm run build:all
```

1. Open `about:debugging#/runtime/this-firefox` and click **Load Temporary Add-on**.
2. Choose `build/firefox/manifest.json`.
3. Firefox keeps site access optional: open the extension's **Permissions** (in
   `about:addons`) and allow it on the listed sites, or use the **Grant access** button in the panel.

A temporary add-on is removed when Firefox quits. A permanent install needs an add-on signed by
Mozilla, which isn't set up yet.

### Safari (Mac and iPad)

Safari extensions ship inside a small app built with Xcode, so you need a Mac with Xcode.

### One-time setup (Mac)

The Xcode project is committed in `xcode/`, so you only need to build the extension:

```sh
npm ci
npm run build
```

The Xcode project references the files in `dist/` in place, so `npm run build` (or `npm run dev`)
and then **Run** in Xcode picks up your changes. If a build adds a new top-level file to `dist/`,
regenerate the project: run the **Generate Xcode project** workflow from the Actions tab (it
pushes to the `xcode-project` branch), or delete `xcode/` and run
`./scripts/create-xcode-project.sh` on a Mac.

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

With a free Apple ID the iPad install expires after 7 days.

### TestFlight (iPad and Mac, no Xcode)

Every change merged to `main` is built and uploaded to TestFlight by GitHub Actions. Install the
**TestFlight** app, then install and update Card Finder from there. Builds are properly signed, so
the Mac doesn't need "Allow unsigned extensions". One-time setup: [docs/deploy.md](docs/deploy.md).

## Use it

1. **Tag cards.** In Moxfield, tag the cards you need with `unowned`, in any board of the deck,
   including Considering. (The tag name can be changed in settings.)
2. **Check your stores.** Card Finder picks every store within your range (25 mi by default) from
   your approximate location. Open **Settings & stores** to enter a ZIP code instead, change the
   range, or turn individual stores off. Stores added by URL are always checked.
   Online-only sellers are hidden by default; tick **Include online-only sellers** to include
   them. **Find more stores** probes for stores the weekly directory hasn't seen.
3. **Check.** On a Moxfield deck page, tap the **Card Finder** button. Or open the toolbar popup,
   choose **Check a card list** and paste cards one per line (e.g. `1 Sol Ring`) or a Moxfield
   export.
4. **Read the results.** Each store shows how many of your wanted cards it has ("3 of 12"). Under
   each card are the listings with set, condition, foil, price and quantity, plus a **View** link
   to the store's page. Cards no store has are collected under a "not found" list.
   - Stores are sorted **Closest** first (from where you last searched for stores) or by
     **Most cards**, with each store's distance, a map link and today's hours.
   - When you check the same deck again, listings are marked **new** or with a **price drop**,
     and anything that sold out since the last check is listed.
5. **Filter.** In settings, under **Results**, set a max price per copy, conditions, foil or
   non-foil, and English only. Results show which filters were applied.

If Safari hasn't given Card Finder access to the store sites yet, the check shows a **Grant access**
button. Allow the sites when Safari asks.

## Privacy

- Your settings (tag, stores, filters) and recent results are stored in Safari on each device.
  Results history can be cleared in settings.
- Checks go straight from your browser to Moxfield and the stores' TCGplayer Pro sites. There is
  no Card Finder server.
- To find nearby stores, Card Finder looks up your approximate (city-level) location from your
  device's IP address. This sends your IP address to ipapi.co, or to get.geojs.io if that fails.
  It runs only to find nearby stores (at most once a day), and a ZIP code you enter replaces it.
  Safari shows no location prompt, because the browser's location feature isn't used.
- "Find more stores" queries the Wizards store locator, and a ZIP code lookup (zippopotam.us)
  runs if you enter a ZIP code.
- The store directory is a public file, `data/storefronts.json`, built weekly by GitHub Actions
  and fetched from this repository.

## Development

Requires Node 24.

```sh
npm ci
npm run build        # bundle into dist/
npm run dev          # rebuild on change
npm test             # unit tests (Vitest, no network)
npm run test:e2e     # UI tests: built extension in Playwright WebKit (run npm run build first)
npm run lint         # ESLint + Prettier check
npm run format       # fix formatting
npm run typecheck
```

`npm run build:all` writes the Safari build to `dist/` and the Chrome and Firefox builds to
`build/chrome/` and `build/firefox/`. `npm run test:e2e -- --project=chrome-extension` loads the
real Chrome build in Chromium (`npx playwright install chromium` once); CI also runs
`web-ext lint` on the Firefox build.

`test:e2e` runs `dist/` in Safari's engine (Playwright WebKit) with a fake extension runtime
(`tests/e2e/harness/`), a stand-in Moxfield deck page and recorded store, location and directory
responses (`tests/fixtures/`). Any request without a recorded response fails the test. Install the
browser once with `npx playwright install webkit`; where WebKit can't be installed, use
`npm run test:e2e -- --project=chromium`. CI runs WebKit and uploads the Playwright report when it fails.

Code layout:

```
src/
  lib/            platform-neutral logic (unit-tested)
  background/     service worker
  content/        injected into moxfield.com
  options/        settings page
  popup/          toolbar popup
  results/        "Check a card list" page
  ui/             shared UI code
  crawler/        Node-only crawler that builds data/storefronts.json
static/           manifest, HTML, CSS, icons (copied into dist/)
tests/            Vitest tests and recorded API fixtures
data/             generated by the crawler, never hand-edit
docs/spikes/      API investigation notes
```

### Crawler

The crawler builds the storefront directory, `data/storefronts.json`. It makes live requests. To
try it on one area without touching `data/`:

```sh
npm run crawl -- --zip 03055 --miles 30 --marketplace-products 0 --data /tmp/crawl-test
```

Run without arguments it does the full US crawl. The **Update store directory** workflow
(`.github/workflows/crawl.yml`) runs it every Monday and commits the result; it can also be run
by hand from the Actions tab.

### Issue sessions

Adding the `claude` label to an issue starts an automated Claude Code session that works on it
and opens a pull request (`.github/workflows/claude-issue.yml`).

## Limitations

- Moxfield's API is undocumented and could change without notice.
- Checks run on demand only; browsers don't allow background alerts for extensions like this.
- Only stores with a TCGplayer Pro web store are supported.
