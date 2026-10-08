import { clearHistory } from "../lib/history";
import { ALL_CONDITIONS, normalizeFilters } from "../lib/filters";
import { loadDirectory } from "../lib/directoryCache";
import { isWelcomeQuery, welcomeSteps } from "../lib/onboarding";
import {
  findStorefronts,
  metersToMiles,
  nearbyWpnStores,
  withCoordinates,
  zipToLocation,
  type StorefrontMatch,
} from "../lib/storeFinder";
import { resolveStores } from "../lib/resolveStores";
import { MANY_STORES } from "../lib/storeSet";
import {
  loadSettings,
  removeStore,
  saveSettings,
  upsertStore,
  type Settings,
} from "../lib/settings";
import { describeFetchError } from "../lib/fetchError";
import {
  AUTO_STORE_ORIGINS,
  FIND_STORES_ORIGINS,
  missingOrigins,
  originPattern,
  originsForStores,
  requestOrigins,
  STORE_ORIGINS,
} from "../lib/permissions";
import { distanceMeters } from "../lib/directory";
import { detectShopifyStore, normalizeHttpsOrigin } from "../lib/shopifyStore";
import { getSite, normalizeStoreUrl } from "../lib/tcgplayerpro";
import type { GeoPoint, Store, StoreSite, WpnStore } from "../lib/types";

function $<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`#${id} missing`);
  return node as T;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

function setStatus(node: HTMLElement, text: string, isError = false): void {
  node.textContent = text;
  node.classList.toggle("error", isError);
}

function formatAddress(store: Pick<Store, "address">): string {
  const a = store.address;
  return a ? [a.street, a.city, `${a.state} ${a.zip}`.trim()].filter(Boolean).join(", ") : "";
}

function siteToStore(site: StoreSite, location?: GeoPoint): Store {
  return {
    latitude: location?.latitude,
    longitude: location?.longitude,
    url: site.url,
    name: site.name,
    address: site.address,
    phone: site.phone,
    hours: site.hours,
  };
}

function mapsUrl(address: string): string {
  return `https://maps.apple.com/?q=${encodeURIComponent(address)}`;
}

const ACCESS_DENIED =
  "Card Finder needs access to store sites. Allow it in Safari's settings, then try again.";

let settings: Settings;

function renderStores(): void {
  const list = $<HTMLUListElement>("stores");
  list.replaceChildren();
  $("no-stores").hidden = settings.stores.length > 0;
  for (const store of settings.stores) {
    const address = formatAddress(store);
    const info = el(
      "div",
      {},
      el("div", { className: "name" }, store.name),
      el(
        "div",
        { className: "meta" },
        el("a", { href: store.url, target: "_blank" }, new URL(store.url).hostname),
      ),
    );
    if (address) {
      info.append(
        el(
          "div",
          { className: "meta" },
          el("a", { href: mapsUrl(address), target: "_blank" }, address),
        ),
      );
    }
    const remove = el("button", { className: "secondary", textContent: "Remove", type: "button" });
    remove.addEventListener("click", async () => {
      settings.stores = removeStore(settings.stores, store.url);
      await saveSettings(settings);
      await refreshStores();
    });
    list.append(el("li", {}, info, remove));
  }
}

async function addStore(site: StoreSite, location?: GeoPoint): Promise<void> {
  await addSavedStore(siteToStore(site, location));
}

async function addSavedStore(saved: Store): Promise<void> {
  const store = await withCoordinates(saved);
  settings.stores = upsertStore(settings.stores, store);
  await saveSettings(settings);
  await refreshStores();
}

// --- Add by URL -----------------------------------------------------------

$<HTMLFormElement>("add-store-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const status = $("add-store-status");
  const input = $<HTMLInputElement>("store-url");
  const tcgUrl = normalizeStoreUrl(input.value);
  const origin = tcgUrl ?? normalizeHttpsOrigin(input.value);
  if (!origin) {
    setStatus(
      status,
      "Enter a store's web address starting with https:// (or something.tcgplayerpro.com).",
      true,
    );
    return;
  }
  // Request first: Safari only shows the prompt for a call made straight from the click.
  const accessGranted = requestOrigins(tcgUrl ? STORE_ORIGINS : [originPattern(origin)]);
  if (!(await accessGranted)) {
    setStatus(status, ACCESS_DENIED, true);
    return;
  }
  setStatus(status, "Checking store…");
  try {
    if (!tcgUrl) {
      const shopify = await detectShopifyStore(origin);
      if (shopify) {
        await addSavedStore(shopify);
        input.value = "";
        setStatus(status, `Added ${shopify.name}.`);
        return;
      }
    }
    const site = await getSite(origin).catch(() => null);
    if (!site) {
      setStatus(
        status,
        `${new URL(origin).hostname} isn't a TCGplayer Pro or Shopify store Card Finder supports.`,
        true,
      );
      return;
    }
    await addStore(site);
    input.value = "";
    setStatus(status, `Added ${site.name}.`);
  } catch (err) {
    setStatus(status, describeFetchError(err, origin), true);
  }
});

// --- Tag ------------------------------------------------------------------

$<HTMLFormElement>("tag-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const tag = $<HTMLInputElement>("tag").value.trim();
  if (!tag) return;
  settings.tag = tag;
  await saveSettings(settings);
});

// --- Result filters ---------------------------------------------------------

function renderFilters(): void {
  const f = settings.filters;
  $<HTMLInputElement>("max-price").value = f.maxPrice === null ? "" : String(f.maxPrice);
  $<HTMLSelectElement>("foil").value = f.foil;
  $<HTMLInputElement>("english-only").checked = f.englishOnly;
  for (const box of $("conditions").querySelectorAll<HTMLInputElement>("input")) {
    box.checked = f.conditions.includes(box.value as (typeof ALL_CONDITIONS)[number]);
  }
}

async function saveFilters(): Promise<void> {
  const price = $<HTMLInputElement>("max-price").value.trim();
  settings.filters = normalizeFilters({
    maxPrice: price === "" ? null : Number(price),
    conditions: [...$("conditions").querySelectorAll<HTMLInputElement>("input:checked")].map(
      (box) => box.value as (typeof ALL_CONDITIONS)[number],
    ),
    foil: $<HTMLSelectElement>("foil").value as "any" | "nonfoil" | "foil",
    englishOnly: $<HTMLInputElement>("english-only").checked,
  });
  await saveSettings(settings);
}

for (const id of ["max-price", "conditions", "foil", "english-only"]) {
  const node = $(id);
  node.addEventListener(node.id === "max-price" ? "input" : "change", () => void saveFilters());
}

// --- Location, range and stores in range -----------------------------------

let inRange: Store[] = [];

function renderLocation(): void {
  const status = $("location");
  const home = settings.manualLocation ?? settings.approxLocation;
  if (!home) {
    setStatus(
      status,
      "We couldn't work out where you are. Enter your ZIP code to find stores.",
      true,
    );
    return;
  }
  const kind = settings.manualLocation ? "from your ZIP" : "approximate";
  setStatus(status, `Location: ${home.label ?? "your area"} (${kind})`);
  $("use-approx").hidden = !settings.manualLocation;
}

function renderInRange(): void {
  const list = $<HTMLUListElement>("in-range");
  list.replaceChildren();
  const saved = new Set(settings.stores.map((s) => s.url));
  const excluded = new Set(settings.excluded);
  const auto = inRange.filter((s) => !saved.has(s.url));
  const checked = auto.filter((s) => !excluded.has(s.url)).length + settings.stores.length;
  const home = settings.manualLocation ?? settings.approxLocation;
  $("range-summary").textContent = home
    ? `${inRange.length} store${inRange.length === 1 ? "" : "s"} within ${settings.rangeMiles} mi. ` +
      `Checking ${checked} in total. Turn a store off to exclude it.`
    : "";
  const many = $("many-stores");
  many.hidden = checked <= MANY_STORES;
  many.textContent = `Checking ${checked} stores. Checks will take longer; narrow the range or exclude stores to speed them up.`;
  for (const store of auto) {
    const miles =
      home && store.latitude !== undefined && store.longitude !== undefined
        ? metersToMiles(
            distanceMeters(home, { latitude: store.latitude, longitude: store.longitude }),
          ).toFixed(1)
        : "";
    const address = formatAddress(store);
    const toggle = el("input", { type: "checkbox", checked: !excluded.has(store.url) });
    toggle.setAttribute("aria-label", `Check ${store.name}`);
    toggle.addEventListener("change", async () => {
      const others = settings.excluded.filter((u) => u !== store.url);
      settings.excluded = toggle.checked ? others : [...others, store.url];
      await saveSettings(settings);
      renderInRange();
    });
    const info = el(
      "div",
      {},
      el("div", { className: "name" }, store.name),
      el(
        "div",
        { className: "meta" },
        [miles && `${miles} mi`, address].filter(Boolean).join(" · "),
      ),
    );
    list.append(el("li", {}, info, el("label", { className: "checkbox" }, toggle, "Check")));
  }
}

/** Recompute everything derived from location, range, exclusions and saved stores. */
async function refreshStores(refreshLocation = false): Promise<void> {
  const resolved = await resolveStores({ refreshLocation });
  settings = resolved.settings;
  inRange = resolved.inRange;
  $<HTMLSelectElement>("radius").value = String(settings.rangeMiles);
  $<HTMLInputElement>("include-online").checked = settings.includeOnline;
  renderLocation();
  renderStores();
  renderInRange();
}

$<HTMLFormElement>("zip-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const status = $("location");
  const accessGranted = requestOrigins(AUTO_STORE_ORIGINS);
  try {
    if (!(await accessGranted)) {
      setStatus(status, ACCESS_DENIED, true);
      return;
    }
    const point = await zipToLocation($<HTMLInputElement>("zip").value);
    settings.manualLocation = point;
    await saveSettings(settings);
    $<HTMLInputElement>("zip").value = "";
    await refreshStores();
  } catch (err) {
    setStatus(status, describeFetchError(err, "https://api.zippopotam.us"), true);
  }
});

$<HTMLButtonElement>("use-approx").addEventListener("click", async () => {
  const accessGranted = requestOrigins(AUTO_STORE_ORIGINS);
  await accessGranted;
  delete settings.manualLocation;
  await saveSettings(settings);
  await refreshStores(true);
});

$<HTMLSelectElement>("radius").addEventListener("change", async () => {
  settings.rangeMiles = Number($<HTMLSelectElement>("radius").value);
  await saveSettings(settings);
  await refreshStores();
});

$<HTMLInputElement>("include-online").addEventListener("change", async () => {
  settings.includeOnline = $<HTMLInputElement>("include-online").checked;
  await saveSettings(settings);
  await refreshStores();
});

$<HTMLButtonElement>("refresh-directory").addEventListener("click", async () => {
  const accessGranted = requestOrigins(AUTO_STORE_ORIGINS);
  await accessGranted;
  await loadDirectory({ refresh: true });
  await refreshStores();
});

// --- Find more stores (live WPN probing) -----------------------------------

let found: StorefrontMatch[] = [];
const foundButtons = new Map<string, HTMLButtonElement>();

function renderFoundButtons(): void {
  for (const [url, button] of foundButtons) {
    const saved = settings.stores.some((s) => s.url === url);
    button.disabled = saved;
    button.textContent = saved ? "Added" : "Add";
  }
}

function renderFound(): void {
  const list = $<HTMLUListElement>("found");
  list.replaceChildren();
  foundButtons.clear();
  for (const match of found) {
    const miles = metersToMiles(match.store.distance).toFixed(1);
    const name = el("div", { className: "name" }, match.store.name);
    if (match.confidence === "possible") {
      name.append(
        el(
          "span",
          { className: "badge", title: "Name matches, but address and phone differ" },
          "likely",
        ),
      );
    }
    const info = el(
      "div",
      {},
      name,
      el(
        "div",
        { className: "meta" },
        `${miles} mi · `,
        el(
          "a",
          { href: mapsUrl(match.store.postalAddress), target: "_blank" },
          match.store.postalAddress,
        ),
      ),
      el(
        "div",
        { className: "meta" },
        el("a", { href: match.site.url, target: "_blank" }, new URL(match.site.url).hostname),
      ),
    );
    let button = foundButtons.get(match.site.url);
    const li = el("li", {}, info);
    if (!button) {
      button = el("button", { type: "button", textContent: "Add" });
      button.addEventListener("click", () => void addStore(match.site, match.store));
      foundButtons.set(match.site.url, button);
      li.append(button);
    } else {
      li.append(el("span", { className: "meta" }, "Same web store as above"));
    }
    list.append(li);
  }
  renderFoundButtons();
}

$<HTMLButtonElement>("find-more").addEventListener("click", async () => {
  const status = $("find-status");
  const button = $<HTMLButtonElement>("find-more");
  const accessGranted = requestOrigins(FIND_STORES_ORIGINS);
  const point = settings.manualLocation ?? settings.approxLocation;
  if (!point) {
    setStatus(status, "Enter a ZIP code first.", true);
    return;
  }
  button.disabled = true;
  found = [];
  renderFound();
  try {
    if (!(await accessGranted)) {
      setStatus(status, ACCESS_DENIED, true);
      return;
    }
    const miles = settings.rangeMiles;
    setStatus(status, `Looking for more stores within ${miles} mi of ${point.label ?? "you"}…`);
    const [directory, stores] = await Promise.all([
      loadDirectory(),
      nearbyWpnStores(point, miles).catch(() => [] as WpnStore[]),
    ]);
    const checked = new Set(directory?.checkedWpnStoreIds ?? []);
    const unchecked = stores.filter((s) => !checked.has(s.id));
    await findStorefronts(unchecked, {
      onProgress(done, total, match) {
        if (match) {
          found = [...found, match].sort((a, b) => a.store.distance - b.store.distance);
          renderFound();
        }
        setStatus(status, `Checked ${done} of ${total} stores… ${found.length} found`);
      },
    });
    setStatus(
      status,
      found.length
        ? `Found ${found.length} more stores. Add the ones you want.`
        : `No additional TCGplayer Pro web stores found within ${miles} mi.`,
    );
  } catch (err) {
    setStatus(status, describeFetchError(err, "https://api.tabletop.wizards.com"), true);
  } finally {
    button.disabled = false;
  }
});

// --- Init -----------------------------------------------------------------

void (async () => {
  settings = await loadSettings();
  $<HTMLInputElement>("tag").value = settings.tag;
  renderFilters();
  await refreshStores();
  await showAccessBanner();
})();

// --- Site access ------------------------------------------------------------

/** Offer the access prompt when site access is missing (always after "Grant access" in the panel). */
async function showAccessBanner(): Promise<void> {
  const banner = $("access");
  const origins = originsForStores((await resolveStores()).stores);
  if (!(await missingOrigins(origins)).length) {
    banner.hidden = true;
    return;
  }
  banner.hidden = false;
  $<HTMLButtonElement>("grant-access").onclick = () => {
    void requestOrigins(origins).then(showAccessBanner);
  };
}

// --- First-run welcome ----------------------------------------------------

if (isWelcomeQuery(location.search)) {
  void loadSettings().then(({ tag }) => {
    $("welcome-steps").replaceChildren(...welcomeSteps(tag).map((step) => el("li", {}, step)));
    $("welcome").hidden = false;
    $<HTMLInputElement>("zip").focus();
  });
}

$("clear-history").addEventListener("click", async () => {
  await clearHistory();
  $("clear-history-status").textContent = "History cleared.";
});
