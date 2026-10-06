import browser from "webextension-polyfill";
import { loadLastCheck } from "../lib/lastCheck";
import { loadSettings } from "../lib/settings";

function openResults(query = ""): void {
  void browser.tabs.create({ url: browser.runtime.getURL(`results/results.html${query}`) });
  window.close();
}

void (async () => {
  const { stores, tag } = await loadSettings();
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
      `Last check: ${last.label}: ${found} of ${last.wanted.length} cards found. `,
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
