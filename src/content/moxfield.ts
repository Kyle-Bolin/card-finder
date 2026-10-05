import browser from "webextension-polyfill";
import type { FetchTextRequest, FetchTextResponse } from "../background/background";
import { deckApiUrl, parseDeckId } from "../lib/moxfield";
import { summarizeDeck, type DeckSummary } from "../lib/moxfieldDiagnostic";
import { loadSettings } from "../lib/settings";

// Moxfield is a single-page app: decks open without a full page load, so the
// content script runs on every moxfield.com page and shows the button only on decks.

const STYLES = `
  :host { all: initial; }
  .fab {
    position: fixed; right: 16px; bottom: 16px; z-index: 2147483647;
    font: 600 14px -apple-system, system-ui, sans-serif;
    background: #db7d30; color: #fff; border: 0; border-radius: 999px;
    padding: 12px 18px; box-shadow: 0 4px 14px rgba(0,0,0,.3); cursor: pointer;
  }
  .panel {
    position: fixed; right: 16px; bottom: 72px; z-index: 2147483647;
    width: min(420px, calc(100vw - 32px)); max-height: 70vh; overflow: auto;
    font: 13px/1.45 -apple-system, system-ui, sans-serif;
    background: #1d1d1f; color: #f5f5f7; border-radius: 14px; padding: 16px;
    box-shadow: 0 8px 30px rgba(0,0,0,.45);
  }
  .panel[hidden] { display: none; }
  h2 { font-size: 15px; margin: 0 0 8px; }
  h3 { font-size: 13px; margin: 14px 0 4px; color: #db7d30; }
  button.action {
    font: 600 13px -apple-system, system-ui, sans-serif; border: 0; border-radius: 8px;
    padding: 10px 14px; margin: 4px 6px 4px 0; background: #3a3a3c; color: #fff; cursor: pointer;
  }
  pre { white-space: pre-wrap; word-break: break-word; background: #2c2c2e; padding: 8px; border-radius: 8px; margin: 4px 0; }
  .ok { color: #30d158; } .bad { color: #ff453a; }
  ul { margin: 4px 0; padding-left: 18px; }
`;

interface Attempt {
  method: string;
  status: number;
  error?: string;
  body?: string;
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

async function fetchFromPage(url: string): Promise<Attempt> {
  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      credentials: "include",
    });
    return { method: "content script fetch", status: res.status, body: await res.text() };
  } catch (err) {
    return { method: "content script fetch", status: 0, error: String(err) };
  }
}

async function fetchFromBackground(url: string): Promise<Attempt> {
  try {
    const request: FetchTextRequest = { type: "fetchText", url };
    const res = (await browser.runtime.sendMessage(request)) as FetchTextResponse;
    return { method: "background fetch", status: res.status, body: res.body, error: res.error };
  } catch (err) {
    return { method: "background fetch", status: 0, error: String(err) };
  }
}

function parseJson(text: string | undefined): unknown {
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function renderReport(
  output: HTMLElement,
  deckId: string,
  tag: string,
  attempts: Attempt[],
  summary: DeckSummary | null,
  rawJson: string | undefined,
): void {
  output.replaceChildren();
  output.append(el("h3", {}, "Deck"), el("pre", {}, deckId));

  output.append(el("h3", {}, "How Card Finder can read this deck"));
  const list = el("ul");
  for (const a of attempts) {
    const good = a.status === 200 && parseJson(a.body) !== undefined;
    list.append(
      el(
        "li",
        {},
        el("span", { className: good ? "ok" : "bad" }, good ? "✓ " : "✗ "),
        `${a.method}: HTTP ${a.status || "—"}${a.error ? ` (${a.error})` : ""}`,
      ),
    );
  }
  output.append(list);

  if (!summary) {
    output.append(
      el("p", {}, "Couldn't read the deck JSON either way. Please share these results."),
    );
    return;
  }

  output.append(
    el("h3", {}, "Boards"),
    el("pre", {}, summary.boards.map((b) => `${b.name}: ${b.cards}`).join("\n") || "(none found)"),
    el("h3", {}, "Tag fields found"),
    el("pre", {}, summary.tagLocations.join("\n") || "(none found)"),
    el("h3", {}, `Cards tagged "${tag}" (${summary.taggedCards.length})`),
    el(
      "pre",
      {},
      summary.taggedCards.map((c) => `${c.name}${c.board ? `  [${c.board}]` : ""}`).join("\n") ||
        "(none)",
    ),
    el("h3", {}, "Top-level keys"),
    el("pre", {}, summary.topLevelKeys.join(", ")),
  );

  const report = {
    deckId,
    tag,
    attempts: attempts.map((a) => ({ method: a.method, status: a.status, error: a.error })),
    summary,
  };
  const copyReport = el("button", { className: "action", textContent: "Copy report" });
  copyReport.addEventListener("click", () => {
    void navigator.clipboard.writeText(JSON.stringify(report, null, 2));
    copyReport.textContent = "Copied ✓";
  });
  const copyJson = el("button", { className: "action", textContent: "Copy raw deck JSON" });
  copyJson.addEventListener("click", () => {
    void navigator.clipboard.writeText(rawJson ?? "");
    copyJson.textContent = "Copied ✓";
  });
  output.append(el("div", {}, copyReport, copyJson));
}

async function runDiagnostic(output: HTMLElement): Promise<void> {
  const deckId = parseDeckId(location.pathname);
  if (!deckId) return;
  const { tag } = await loadSettings();
  output.replaceChildren(el("p", {}, "Testing… (this tries Moxfield's API two ways)"));

  const url = deckApiUrl(deckId);
  const attempts = [await fetchFromPage(url), await fetchFromBackground(url)];
  const working = attempts.find((a) => a.status === 200 && parseJson(a.body) !== undefined);
  const summary = working ? summarizeDeck(parseJson(working.body), tag) : null;
  renderReport(output, deckId, tag, attempts, summary, working?.body);
}

function mount(): { show: (visible: boolean) => void } {
  const host = el("div", { id: "card-finder-root" });
  const shadow = host.attachShadow({ mode: "open" });
  const panel = el("div", { className: "panel", hidden: true });
  const output = el("div");
  const runButton = el("button", { className: "action", textContent: "Run Moxfield diagnostic" });
  runButton.addEventListener("click", () => void runDiagnostic(output));
  panel.append(
    el("h2", {}, "Card Finder"),
    el(
      "p",
      {},
      "Store checks are coming soon. For now, this checks how the extension can read this deck.",
    ),
    runButton,
    output,
  );
  const fab = el("button", { className: "fab", textContent: "Card Finder" });
  fab.addEventListener("click", () => {
    panel.hidden = !panel.hidden;
  });
  shadow.append(el("style", {}, STYLES), panel, fab);
  document.documentElement.append(host);
  return {
    show(visible) {
      host.style.display = visible ? "" : "none";
      if (!visible) panel.hidden = true;
    },
  };
}

const ui = mount();
let lastPath = "";
function onLocationChange(): void {
  if (location.pathname === lastPath) return;
  lastPath = location.pathname;
  ui.show(parseDeckId(location.pathname) !== null);
}
onLocationChange();
setInterval(onLocationChange, 1000);
