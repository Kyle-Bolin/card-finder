import type { StoreResult } from "../lib/check";
import { describeFilters, type Filters } from "../lib/filters";
import { todaysHours } from "../lib/hours";
import { distanceMiles } from "../lib/storeFinder";
import type { GeoPoint, Listing, WantedCard } from "../lib/types";

/** Everything the results view shows; re-rendered as stores report in. */
export interface ResultsState {
  wanted: WantedCard[];
  totalStores: number;
  /** Filters the results were checked with. */
  filters?: Filters;
  /** Opens the settings page; when set, the filter summary links to it. */
  onOpenSettings?: () => void;
  results: StoreResult[];
  done: boolean;
  /** Where the user searches from; enables distances and the "Closest" sort. */
  home?: GeoPoint;
  /** Overrides the clock for "today's hours" (tests). */
  now?: Date;
}

export type SortMode = "closest" | "cards";

/** Miles from `home` to the store, or null when either location is unknown. */
export function storeDistance(result: StoreResult, home: GeoPoint | undefined): number | null {
  const { latitude, longitude } = result.store;
  if (!home || latitude === undefined || longitude === undefined) return null;
  return distanceMiles(home, { latitude, longitude });
}

/** Stores with stock, ordered by distance (unknown distances last) or by number of cards. */
export function sortStores(
  results: StoreResult[],
  mode: SortMode,
  home: GeoPoint | undefined,
): StoreResult[] {
  const byCards = (a: StoreResult, b: StoreResult) =>
    b.found.length - a.found.length || a.store.name.localeCompare(b.store.name);
  const withStock = results.filter((r) => r.found.length);
  if (mode === "cards") return withStock.sort(byCards);
  const distance = new Map(withStock.map((r) => [r, storeDistance(r, home)]));
  return withStock.sort((a, b) => {
    const da = distance.get(a) ?? null;
    const db = distance.get(b) ?? null;
    if (da === null || db === null) return da === db ? byCards(a, b) : da === null ? 1 : -1;
    return da - db || byCards(a, b);
  });
}

const sortChoice = new WeakMap<HTMLElement, SortMode>();

function mapsUrl(address: string): string {
  return `https://maps.apple.com/?q=${encodeURIComponent(address)}`;
}

export const RESULTS_CSS = `
  .cf-results { font: 14px/1.45 -apple-system, system-ui, sans-serif; color: inherit; }
  .cf-summary { font-weight: 600; margin: 4px 0 2px; }
  .cf-progress { color: #8e8e93; font-size: 12px; margin-bottom: 10px; }
  .cf-store { border-radius: 12px; padding: 10px 12px; margin: 8px 0; background: rgba(127,127,127,.12); }
  .cf-store-head { display: flex; justify-content: space-between; gap: 8px; align-items: baseline; }
  .cf-store-name { font-weight: 600; }
  .cf-store-name a { color: inherit; text-decoration: none; }
  .cf-count { color: #db7d30; font-weight: 600; white-space: nowrap; font-size: 13px; }
  .cf-sort { display: flex; gap: 6px; margin: 6px 0; }
  .cf-sort button { font: inherit; font-size: 12px; padding: 2px 10px; border-radius: 999px; border: 1px solid rgba(127,127,127,.4); background: none; color: inherit; cursor: pointer; }
  .cf-sort button[aria-pressed="true"] { background: #db7d30; border-color: #db7d30; color: #fff; }
  .cf-meta a { color: inherit; }
  .cf-card { margin-top: 8px; }
  .cf-card-name { font-weight: 600; font-size: 13px; }
  .cf-listing { display: flex; justify-content: space-between; gap: 8px; font-size: 12px; padding: 3px 0; border-bottom: 1px solid rgba(127,127,127,.15); }
  .cf-listing:last-child { border-bottom: 0; }
  .cf-listing a { color: #db7d30; text-decoration: none; white-space: nowrap; }
  .cf-meta { color: #8e8e93; }
  .cf-price { font-variant-numeric: tabular-nums; white-space: nowrap; }
  .cf-foil { display: inline-block; font-size: 10px; font-weight: 700; padding: 0 4px; border-radius: 4px; background: linear-gradient(90deg,#f6d365,#a1c4fd); color: #1d1d1f; margin-left: 4px; }
  .cf-error { color: #ff453a; font-size: 12px; }
  .cf-missing { margin-top: 12px; color: #8e8e93; }
  .cf-missing summary { cursor: pointer; font-weight: 600; }
  .cf-missing ul { margin: 6px 0 0; padding-left: 18px; }
`;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

const money = (n: number) => `$${n.toFixed(2)}`;

function listingRow(listing: Listing): HTMLElement {
  const details = [listing.setName, listing.condition];
  if (listing.language && listing.language !== "English") details.push(listing.language);
  const left = el("span", {}, el("span", { className: "cf-meta" }, details.join(" · ")));
  if (listing.foil) left.append(el("span", { className: "cf-foil" }, "FOIL"));
  return el(
    "div",
    { className: "cf-listing" },
    left,
    el(
      "span",
      {},
      el("span", { className: "cf-price" }, `${money(listing.price)} ×${listing.quantity}`),
      " ",
      el("a", { href: listing.url, target: "_blank", rel: "noopener" }, "View"),
    ),
  );
}

function storeCard(
  result: StoreResult,
  wantedCount: number,
  home: GeoPoint | undefined,
  now: Date | undefined,
): HTMLElement {
  const head = el(
    "div",
    { className: "cf-store-head" },
    el(
      "span",
      { className: "cf-store-name" },
      el("a", { href: result.store.url, target: "_blank", rel: "noopener" }, result.store.name),
    ),
    el("span", { className: "cf-count" }, `${result.found.length} of ${wantedCount}`),
  );
  const card = el("div", { className: "cf-store" }, head);
  const a = result.store.address;
  const miles = storeDistance(result, home);
  if (a?.city) {
    const short = [a.street, a.city].filter(Boolean).join(", ");
    const full = [a.street, a.city, `${a.state} ${a.zip}`.trim()].filter(Boolean).join(", ");
    const line = el(
      "div",
      { className: "cf-meta" },
      el("a", { href: mapsUrl(full), target: "_blank", rel: "noopener" }, short),
    );
    if (miles !== null) line.append(` · ${Math.round(miles)} mi`);
    card.append(line);
  } else if (miles !== null) {
    card.append(el("div", { className: "cf-meta" }, `${Math.round(miles)} mi`));
  }
  const hours = todaysHours(result.store.hours, now);
  if (hours) card.append(el("div", { className: "cf-meta" }, `Today: ${hours}`));
  const byCard = new Map<string, Listing[]>();
  for (const listing of result.listings) {
    byCard.set(listing.cardName, [...(byCard.get(listing.cardName) ?? []), listing]);
  }
  for (const [name, listings] of byCard) {
    const shown = listings.slice(0, 4);
    const block = el(
      "div",
      { className: "cf-card" },
      el("div", { className: "cf-card-name" }, name),
    );
    shown.forEach((l) => block.append(listingRow(l)));
    if (listings.length > shown.length) {
      block.append(el("div", { className: "cf-meta" }, `+${listings.length - shown.length} more`));
    }
    card.append(block);
  }
  return card;
}

/** Ask for site access; `onGrant` runs on click, so it can call `permissions.request`. */
export function renderNeedsPermission(container: HTMLElement, onGrant: () => void): void {
  const button = el("button", { className: "primary", textContent: "Grant access" });
  button.addEventListener("click", onGrant);
  container.replaceChildren(
    el(
      "div",
      { className: "cf-results" },
      el("p", {}, "Card Finder needs access to store sites"),
      el(
        "p",
        { className: "cf-meta" },
        "Safari asks you to allow each site separately before Card Finder can check store inventories.",
      ),
      button,
    ),
  );
}

/** Render (or re-render) the results view into `container`. */
export function renderResults(container: HTMLElement, state: ResultsState): void {
  const { wanted, results, totalStores, done, filters, onOpenSettings, home, now } = state;
  const mode = sortChoice.get(container) ?? (home ? "closest" : "cards");
  const found = new Set(results.flatMap((r) => r.found));
  const root = el("div", { className: "cf-results" });
  root.append(
    el(
      "div",
      { className: "cf-summary" },
      `Found ${found.size} of ${wanted.length} cards in stock at ${results.filter((r) => r.found.length).length} stores`,
    ),
    el(
      "div",
      { className: "cf-progress" },
      done
        ? `Checked ${totalStores} stores`
        : `Checking stores… ${results.length} of ${totalStores} done`,
    ),
  );
  if (filters) {
    const active = describeFilters(filters);
    const line = el(
      "div",
      { className: "cf-progress" },
      active.length ? `Filters: ${active.join(" · ")} · ` : "No filters · ",
    );
    const link = el("a", { href: "#", textContent: "Change in settings" });
    link.addEventListener("click", (event) => {
      event.preventDefault();
      onOpenSettings?.();
    });
    line.append(link);
    root.append(line);
  }
  const withStock = sortStores(results, home ? mode : "cards", home);
  if (home && withStock.length > 1) {
    const toggle = el("div", { className: "cf-sort" });
    for (const [value, label] of [
      ["closest", "Closest"],
      ["cards", "Most cards"],
    ] as const) {
      const button = el("button", { type: "button", textContent: label });
      button.setAttribute("aria-pressed", String(mode === value));
      button.addEventListener("click", () => {
        sortChoice.set(container, value);
        renderResults(container, state);
      });
      toggle.append(button);
    }
    root.append(toggle);
  }
  withStock.forEach((r) => root.append(storeCard(r, wanted.length, home, now)));

  const missing = wanted.filter((w) => !found.has(w.name));
  if (done && missing.length) {
    const list = el("ul");
    missing.forEach((w) => list.append(el("li", {}, w.name)));
    root.append(
      el(
        "details",
        { className: "cf-missing", open: missing.length <= 5 },
        el("summary", {}, `Not in stock nearby (${missing.length})`),
        list,
      ),
    );
  }
  const errors = results.filter((r) => r.error);
  if (errors.length) {
    root.append(
      el(
        "div",
        { className: "cf-error" },
        `Couldn't check: ${errors.map((r) => r.store.name).join(", ")}`,
      ),
    );
  }
  container.replaceChildren(root);
}
