import { fetchDirectory, nearbyFromDirectory } from "../lib/directory";
import {
  findStorefronts,
  metersToMiles,
  nearbyWpnStores,
  zipToLocation,
  type StorefrontMatch,
} from "../lib/storeFinder";
import {
  loadSettings,
  removeStore,
  saveSettings,
  upsertStore,
  type Settings,
} from "../lib/settings";
import { describeFetchError } from "../lib/fetchError";
import {
  FIND_STORES_ORIGINS,
  missingOrigins,
  requestOrigins,
  STORE_ORIGINS,
} from "../lib/permissions";
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

function siteToStore(site: StoreSite): Store {
  return {
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

const METERS_PER_MILE = 1609.344;

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
      renderStores();
      renderFoundButtons();
    });
    list.append(el("li", {}, info, remove));
  }
}

async function addStore(site: StoreSite): Promise<void> {
  settings.stores = upsertStore(settings.stores, siteToStore(site));
  await saveSettings(settings);
  renderStores();
  renderFoundButtons();
}

// --- Add by URL -----------------------------------------------------------

$<HTMLFormElement>("add-store-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const status = $("add-store-status");
  // Request first: Safari only shows the prompt for a call made straight from the click.
  const accessGranted = requestOrigins(STORE_ORIGINS);
  const input = $<HTMLInputElement>("store-url");
  const url = normalizeStoreUrl(input.value);
  if (!url) {
    setStatus(
      status,
      "That doesn't look like a TCGplayer Pro store (something.tcgplayerpro.com).",
      true,
    );
    return;
  }
  if (!(await accessGranted)) {
    setStatus(status, ACCESS_DENIED, true);
    return;
  }
  setStatus(status, "Checking store…");
  try {
    const site = await getSite(url);
    if (!site) {
      setStatus(status, `No TCGplayer Pro store at ${new URL(url).hostname}.`, true);
      return;
    }
    await addStore(site);
    input.value = "";
    setStatus(status, `Added ${site.name}.`);
  } catch (err) {
    setStatus(status, describeFetchError(err, url), true);
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

// --- Find stores near me --------------------------------------------------

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
    if (match.confidence === "possible") {
      const siteAddress = formatAddress(match.site);
      info.append(
        el(
          "div",
          { className: "meta" },
          siteAddress ? `Web store lists: ${siteAddress}` : "Web store lists no address",
        ),
      );
    }
    let button = foundButtons.get(match.site.url);
    const li = el("li", {}, info);
    if (!button) {
      button = el("button", { type: "button", textContent: "Add" });
      button.addEventListener("click", () => void addStore(match.site));
      foundButtons.set(match.site.url, button);
      li.append(button);
    } else {
      // Another branch already listed with the same storefront.
      li.append(el("span", { className: "meta" }, "Same web store as above"));
    }
    list.append(li);
  }
  renderFoundButtons();
}

async function search(point: GeoPoint): Promise<void> {
  const status = $("find-status");
  const miles = Number($<HTMLSelectElement>("radius").value);
  const submit = $<HTMLFormElement>("find-form").querySelectorAll("button");
  submit.forEach((b) => (b.disabled = true));
  found = [];
  renderFound();
  try {
    setStatus(status, `Finding stores within ${miles} mi of ${point.label ?? "you"}…`);
    // The published directory (built weekly by the crawler) answers instantly; then we
    // only live-check WPN stores the crawler hasn't seen yet.
    const [directory, stores] = await Promise.all([
      fetchDirectory(),
      nearbyWpnStores(point, miles).catch(() => [] as WpnStore[]),
    ]);
    if (directory) {
      found = nearbyFromDirectory(directory, point, miles * METERS_PER_MILE, {
        includeOnlineOnly: $<HTMLInputElement>("include-online").checked,
      });
      renderFound();
    }
    const checked = new Set(directory?.checkedWpnStoreIds ?? []);
    const unchecked = stores.filter((s) => !checked.has(s.id));
    if (unchecked.length) {
      const fromDirectory = found.length;
      setStatus(status, `${fromDirectory} found so far. Checking ${unchecked.length} more stores…`);
      await findStorefronts(unchecked, {
        onProgress(done, total, match) {
          if (match) {
            found = [...found, match].sort((a, b) => a.store.distance - b.store.distance);
            renderFound();
          }
          setStatus(status, `Checked ${done} of ${total} stores… ${found.length} found`);
        },
      });
    }
    renderFound();
    setStatus(
      status,
      found.length
        ? `Found ${found.length} stores with TCGplayer Pro web stores within ${miles} mi.`
        : `No TCGplayer Pro web stores found within ${miles} mi.`,
    );
  } catch (err) {
    setStatus(status, describeFetchError(err, "https://api.tabletop.wizards.com"), true);
  } finally {
    submit.forEach((b) => (b.disabled = false));
  }
}

$<HTMLFormElement>("find-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const status = $("find-status");
  const accessGranted = requestOrigins(FIND_STORES_ORIGINS);
  try {
    if (!(await accessGranted)) {
      setStatus(status, ACCESS_DENIED, true);
      return;
    }
    const point = await zipToLocation($<HTMLInputElement>("zip").value);
    await search(point);
  } catch (err) {
    setStatus(status, describeFetchError(err, "https://api.zippopotam.us"), true);
  }
});

$<HTMLButtonElement>("use-location").addEventListener("click", () => {
  const status = $("find-status");
  if (!navigator.geolocation) {
    setStatus(status, "Location isn't available here. Enter a ZIP code instead.", true);
    return;
  }
  setStatus(status, "Getting your location…");
  const accessGranted = requestOrigins(FIND_STORES_ORIGINS);
  navigator.geolocation.getCurrentPosition(
    async (pos) => {
      if (!(await accessGranted)) {
        setStatus(status, ACCESS_DENIED, true);
        return;
      }
      void search({
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
        label: "your location",
      });
    },
    () => setStatus(status, "Couldn't get your location. Enter a ZIP code instead.", true),
    { timeout: 15000, maximumAge: 10 * 60 * 1000 },
  );
});

// --- Init -----------------------------------------------------------------

void (async () => {
  settings = await loadSettings();
  $<HTMLInputElement>("tag").value = settings.tag;
  renderStores();
  await showAccessBanner();
})();

// --- Site access ------------------------------------------------------------

/** Offer the access prompt when site access is missing (always after "Grant access" in the panel). */
async function showAccessBanner(): Promise<void> {
  const banner = $("access");
  if (!(await missingOrigins(STORE_ORIGINS)).length) {
    banner.hidden = true;
    return;
  }
  banner.hidden = false;
  $<HTMLButtonElement>("grant-access").onclick = () => {
    void requestOrigins(STORE_ORIGINS).then(showAccessBanner);
  };
}
