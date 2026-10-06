import browser from "webextension-polyfill";
import { formatAgo } from "../lib/history";
import { loadLastCheck } from "../lib/lastCheck";
import { onboardingState } from "../lib/onboarding";
import { loadSettings } from "../lib/settings";

function openResults(query = ""): void {
  void browser.tabs.create({ url: browser.runtime.getURL(`results/results.html${query}`) });
  window.close();
}

void (async () => {
  const { stores, tag } = await loadSettings();
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
      ? `Checking ${stores.length} store${stores.length === 1 ? "" : "s"} for cards tagged "${tag}".`
      : "No stores set up yet.";
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
