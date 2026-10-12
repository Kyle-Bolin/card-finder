import browser from "webextension-polyfill";
import { formatAgo } from "../lib/history";
import { loadLastCheck } from "../lib/lastCheck";
import { onboardingState } from "../lib/onboarding";
import { resolveStores } from "../lib/resolveStores";
import { MANY_STORES } from "../lib/storeSet";

function openResults(query = ""): void {
  void browser.tabs.create({ url: browser.runtime.getURL(`results/results.html${query}`) });
  window.close();
}

void (async () => {
  const {
    stores,
    settings: { tag },
  } = await resolveStores();
  if (onboardingState({ stores }).needsStores) {
    // Setup comes first: make settings the primary button.
    document.getElementById("open-settings")?.classList.remove("secondary");
    document.getElementById("check-list")?.classList.add("secondary");
    const settingsButton = document.getElementById("open-settings");
    const checkButton = document.getElementById("check-list");
    if (settingsButton && checkButton) checkButton.before(settingsButton);
  }
  const summary = document.getElementById("summary");
  if (summary) {
    summary.textContent = stores.length
      ? `Checking ${stores.length} store${stores.length === 1 ? "" : "s"} for cards tagged "${tag}".` +
        (stores.length > MANY_STORES ? " That's a lot of stores, so checks will take longer." : "")
      : "No stores in range yet. Open settings to enter a ZIP code or widen the range.";
  }
  const last = await loadLastCheck();
  const lastEl = document.getElementById("last");
  if (last && lastEl) {
    const found = new Set(last.results.flatMap((r) => r.found)).size;
    const link = document.createElement("a");
    link.href = "#";
    link.textContent = "View results";
    link.addEventListener("click", (event) => {
      event.preventDefault();
      openResults("?last=1");
    });
    lastEl.append(
      `Last checked ${formatAgo(last.at)}: ${last.label}: ${found} of ${last.wanted.length} cards found. `,
      link,
    );
    lastEl.hidden = false;
  }
})();

document.getElementById("check-list")?.addEventListener("click", () => openResults());
document.getElementById("open-settings")?.addEventListener("click", () => {
  void browser.runtime.openOptionsPage();
  window.close();
});
document.getElementById("store-prices")?.addEventListener("click", () => {
  void browser.tabs.create({ url: browser.runtime.getURL("prices/prices.html") });
  window.close();
});
