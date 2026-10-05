import browser from "webextension-polyfill";
import { loadSettings } from "../lib/settings";

void (async () => {
  const { stores, tag } = await loadSettings();
  const summary = document.getElementById("summary");
  if (summary) {
    summary.textContent = stores.length
      ? `Checking ${stores.length} store${stores.length === 1 ? "" : "s"} for cards tagged "${tag}".`
      : "No stores set up yet.";
  }
})();

document.getElementById("open-settings")?.addEventListener("click", () => {
  void browser.runtime.openOptionsPage();
  window.close();
});
