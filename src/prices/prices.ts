import browser from "webextension-polyfill";
import { storageAreaStore } from "../lib/cache";
import { formatAgo } from "../lib/history";
import { missingOrigins, originsForStores, requestOrigins } from "../lib/permissions";
import { PRICE_BASKET } from "../lib/priceBasket";
import {
  describeRatio,
  loadBaskets,
  scoreStores,
  sortScores,
  type PriceSort,
  type StoreBasket,
  type StoreScore,
} from "../lib/priceRanking";
import { resolveStores } from "../lib/resolveStores";

function $<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`#${id} missing`);
  return node as T;
}

const status = $("status");
const rankingEl = $("ranking");
const refreshButton = $<HTMLButtonElement>("refresh");
const sortEl = $<HTMLSelectElement>("sort");
const totalsEl = $<HTMLInputElement>("totals");

const store = storageAreaStore(() => browser.storage?.local);
const money = (n: number) => `$${n.toFixed(2)}`;

let baskets: StoreBasket[] = [];
let home: Awaited<ReturnType<typeof resolveStores>>["home"];

function row(score: StoreScore, rank: number | null): HTMLLIElement {
  const li = document.createElement("li");
  li.className = "price-row";
  li.style.display = "block";
  const { store: s } = score;
  const head = document.createElement("div");
  head.className = "name";
  head.textContent = `${rank === null ? "–" : `${rank}.`} ${s.name}`;
  const meta = document.createElement("div");
  meta.className = "meta";
  const parts = [
    score.ratio === null ? "not enough data" : describeRatio(score.ratio),
    `${score.coverage} of ${score.basketSize} basket cards`,
  ];
  if (score.distanceMiles !== null) parts.push(`${score.distanceMiles.toFixed(1)} mi`);
  if (totalsEl.checked && score.total !== null) parts.push(`basket total ${money(score.total)}`);
  meta.textContent = parts.join(" · ");
  li.append(head, meta);
  if (score.cards.length) {
    const details = document.createElement("details");
    const summary = document.createElement("summary");
    summary.textContent = "Prices by card";
    const list = document.createElement("ul");
    for (const c of score.cards) {
      const item = document.createElement("li");
      item.textContent = `${c.name}: ${money(c.price)} (area median ${money(c.median)})`;
      list.append(item);
    }
    details.append(summary, list);
    li.append(details);
  }
  return li;
}

function render(): void {
  const scores = sortScores(scoreStores(baskets, home), sortEl.value as PriceSort);
  let rank = 0;
  rankingEl.replaceChildren(...scores.map((s) => row(s, s.ratio === null ? null : ++rank)));
  for (const b of baskets.filter((x) => x.error)) {
    const li = document.createElement("li");
    li.style.display = "block";
    li.innerHTML = "";
    const name = document.createElement("div");
    name.className = "name";
    name.textContent = b.store.name;
    const meta = document.createElement("div");
    meta.className = "meta";
    meta.textContent = `Couldn't check: ${b.error}`;
    li.append(name, meta);
    rankingEl.append(li);
  }
  const loaded = baskets.filter((b) => !b.error);
  const oldest = Math.min(...loaded.map((b) => b.at));
  $("updated").textContent = loaded.length
    ? `Last updated ${formatAgo(new Date(oldest).toISOString())}`
    : "";
}

let running = false;
async function run(force: boolean): Promise<void> {
  if (running) return;
  running = true;
  refreshButton.disabled = true;
  try {
    const resolved = await resolveStores();
    home = resolved.home;
    const { stores } = resolved;
    if (!stores.length) {
      status.textContent =
        "No stores to check yet. Open Settings & stores to enter a ZIP code or widen the range.";
      return;
    }
    const origins = await missingOrigins(originsForStores(stores));
    if (origins.length && !(await requestOrigins(origins))) {
      status.textContent =
        "Access wasn't granted. Allow Card Finder in your browser's extension settings.";
      return;
    }
    status.textContent = `Checked 0 of ${stores.length} stores…`;
    const seen: StoreBasket[] = [];
    baskets = await loadBaskets(stores, {
      store,
      force,
      onProgress: (done, total, basket) => {
        seen.push(basket);
        status.textContent = `Checked ${done} of ${total} stores…`;
        baskets = seen;
        render();
      },
    });
    const failed = baskets.filter((b) => b.error).length;
    status.textContent =
      `Checked ${baskets.length} stores with ${PRICE_BASKET.length} basket cards.` +
      (failed ? ` ${failed} couldn't be checked and are left out of the ranking.` : "");
    render();
  } catch (err) {
    status.textContent = err instanceof Error ? err.message : String(err);
  } finally {
    running = false;
    refreshButton.disabled = false;
  }
}

refreshButton.addEventListener("click", () => void run(true));
sortEl.addEventListener("change", render);
totalsEl.addEventListener("change", render);
$("settings").addEventListener("click", () => void browser.runtime.openOptionsPage());

// Opening the page is the user's request to rank; cached stores are not fetched again.
void run(false);
