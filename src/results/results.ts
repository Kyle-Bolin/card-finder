import browser from "webextension-polyfill";
import { parseCardList, type StoreResult } from "../lib/check";
import { loadLastCheck } from "../lib/lastCheck";
import { runCheck } from "../lib/messages";
import { requestOrigins } from "../lib/permissions";
import {
  renderNeedsPermission,
  renderResults,
  RESULTS_CSS,
  type ResultsState,
} from "../ui/results";

function $<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`#${id} missing`);
  return node as T;
}

const style = document.createElement("style");
style.textContent = RESULTS_CSS;
document.head.append(style);

const status = $("status");
const resultsEl = $("results");
const checkButton = $<HTMLButtonElement>("check");

const openSettings = () => void browser.runtime.openOptionsPage();
$("settings").addEventListener("click", openSettings);

$<HTMLFormElement>("list-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const wanted = parseCardList($<HTMLTextAreaElement>("list").value);
  if (!wanted.length) {
    status.textContent = "Paste at least one card name.";
    return;
  }
  status.textContent = "";
  checkButton.disabled = true;
  const state: ResultsState = {
    wanted,
    totalStores: 0,
    results: [] as StoreResult[],
    done: false,
    onOpenSettings: openSettings,
  };
  runCheck(wanted, `Card list (${wanted.length})`, (event) => {
    switch (event.type) {
      case "no-stores":
        status.textContent =
          "You haven't added any stores yet. Open Settings & stores to add some.";
        checkButton.disabled = false;
        return;
      case "needs-permission":
        checkButton.disabled = false;
        renderNeedsPermission(resultsEl, async () => {
          if (await requestOrigins(event.origins)) {
            $<HTMLFormElement>("list-form").requestSubmit();
          } else {
            status.textContent = "Access wasn't granted. Allow Card Finder in Safari's settings.";
          }
        });
        return;
      case "started":
        state.totalStores = event.totalStores;
        state.filters = event.filters;
        break;
      case "result":
        state.results.push(event.result);
        break;
      case "done":
        state.done = true;
        checkButton.disabled = false;
        break;
      case "error":
        status.textContent = event.message;
        checkButton.disabled = false;
        return;
    }
    if (state.totalStores) renderResults(resultsEl, state);
  });
});

// Show the most recent check when opened from the popup.
void (async () => {
  if (!new URLSearchParams(location.search).has("last")) return;
  const last = await loadLastCheck();
  if (!last) return;
  status.textContent = `${last.label}, checked ${new Date(last.at).toLocaleString()}`;
  $<HTMLTextAreaElement>("list").value = last.wanted
    .map((w) => `${w.quantity} ${w.name}`)
    .join("\n");
  renderResults(resultsEl, { ...last, done: true, onOpenSettings: openSettings });
})();
