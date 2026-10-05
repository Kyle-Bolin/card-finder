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
import { getSite, normalizeStoreUrl } from "../lib/tcgplayerpro";
import type { GeoPoint, Store, StoreSite } from "../lib/types";

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
    setStatus(status, `Couldn't reach the store: ${String(err)}`, true);
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
    setStatus(status, `Finding game stores within ${miles} mi of ${point.label ?? "you"}…`);
    const stores = await nearbyWpnStores(point, miles);
    setStatus(status, `Checking ${stores.length} stores for TCGplayer Pro web stores…`);
    found = await findStorefronts(stores, {
      onProgress(done, total, match) {
        if (match) {
          found = [...found, match].sort((a, b) => a.store.distance - b.store.distance);
          renderFound();
        }
        setStatus(status, `Checked ${done} of ${total} stores… ${found.length} found`);
      },
    });
    renderFound();
    setStatus(
      status,
      found.length
        ? `Found ${found.length} stores with TCGplayer Pro web stores (of ${stores.length} game stores nearby).`
        : `None of the ${stores.length} game stores nearby have a TCGplayer Pro web store we could find.`,
    );
  } catch (err) {
    setStatus(status, String(err), true);
  } finally {
    submit.forEach((b) => (b.disabled = false));
  }
}

$<HTMLFormElement>("find-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const status = $("find-status");
  try {
    const point = await zipToLocation($<HTMLInputElement>("zip").value);
    await search(point);
  } catch (err) {
    setStatus(status, err instanceof Error ? err.message : String(err), true);
  }
});

$<HTMLButtonElement>("use-location").addEventListener("click", () => {
  const status = $("find-status");
  if (!navigator.geolocation) {
    setStatus(status, "Location isn't available here. Enter a ZIP code instead.", true);
    return;
  }
  setStatus(status, "Getting your location…");
  navigator.geolocation.getCurrentPosition(
    (pos) =>
      void search({
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
        label: "your location",
      }),
    () => setStatus(status, "Couldn't get your location. Enter a ZIP code instead.", true),
    { timeout: 15000, maximumAge: 10 * 60 * 1000 },
  );
});

// --- Init -----------------------------------------------------------------

void (async () => {
  settings = await loadSettings();
  $<HTMLInputElement>("tag").value = settings.tag;
  renderStores();
})();
