import browser from "webextension-polyfill";
import type { FetchTextResponse } from "../background/background";
import type { StoreResult } from "../lib/check";
import { deckApiUrl, extractWanted, parseDeckId } from "../lib/moxfield";
import { summarizeDeck } from "../lib/moxfieldDiagnostic";
import { runCheck, type BackgroundRequest } from "../lib/messages";
import { onboardingState } from "../lib/onboarding";
import { loadSettings } from "../lib/settings";
import type { WantedCard } from "../lib/types";
import { renderNeedsPermission, renderResults, RESULTS_CSS } from "../ui/results";

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
    width: min(440px, calc(100vw - 32px)); max-height: 75vh; overflow: auto;
    font: 14px/1.45 -apple-system, system-ui, sans-serif;
    background: #1d1d1f; color: #f5f5f7; border-radius: 14px; padding: 16px;
    box-shadow: 0 8px 30px rgba(0,0,0,.45);
  }
  .panel[hidden] { display: none; }
  h2 { font-size: 16px; margin: 0 0 4px; }
  .muted { color: #8e8e93; font-size: 13px; margin: 0 0 10px; }
  button.primary, button.secondary {
    font: 600 14px -apple-system, system-ui, sans-serif; border: 0; border-radius: 10px;
    padding: 12px 14px; min-height: 44px; cursor: pointer; margin: 4px 6px 4px 0;
  }
  button.primary { background: #db7d30; color: #fff; width: 100%; }
  button.secondary { background: #3a3a3c; color: #fff; }
  button:disabled { opacity: .5; cursor: default; }
  .links { margin-top: 14px; font-size: 12px; color: #8e8e93; }
  .links button { background: none; border: 0; color: #db7d30; font: inherit; cursor: pointer; padding: 0; margin-right: 12px; }
  pre { white-space: pre-wrap; word-break: break-word; background: #2c2c2e; padding: 8px; border-radius: 8px; font-size: 12px; }
  ${RESULTS_CSS}
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

function sendBackground<T>(request: BackgroundRequest): Promise<T> {
  return browser.runtime.sendMessage(request) as Promise<T>;
}

function parseJson(text: string | undefined): unknown {
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

interface DeckLoad {
  deck?: unknown;
  /** How each way of reading the deck went, for the diagnostic. */
  attempts: { method: string; status: number; error?: string }[];
}

/** Read the deck JSON: from the page's context first, then via the background worker. */
async function loadDeck(deckId: string): Promise<DeckLoad> {
  const url = deckApiUrl(deckId);
  const attempts: DeckLoad["attempts"] = [];
  try {
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    const deck = res.ok ? parseJson(await res.text()) : undefined;
    attempts.push({ method: "content script fetch", status: res.status });
    if (deck) return { deck, attempts };
  } catch (err) {
    attempts.push({ method: "content script fetch", status: 0, error: String(err) });
  }
  const res = await sendBackground<FetchTextResponse>({ type: "fetchText", url }).catch(
    (err: unknown) => ({ ok: false, status: 0, error: String(err) }) as FetchTextResponse,
  );
  attempts.push({ method: "background fetch", status: res.status, error: res.error });
  const deck = res.ok ? parseJson(res.body) : undefined;
  return { deck, attempts };
}

class Panel {
  private readonly body = el("div");
  private readonly panel = el("div", { className: "panel", hidden: true });
  private readonly host = el("div", { id: "card-finder-root" });
  private deckId: string | null = null;
  private wanted: WantedCard[] = [];
  private deckName = "Deck";
  private tag = "unowned";
  private load: DeckLoad | null = null;
  private stopCheck: (() => void) | null = null;

  constructor() {
    const shadow = this.host.attachShadow({ mode: "open" });
    const fab = el("button", { className: "fab", textContent: "Card Finder" });
    fab.addEventListener("click", () => this.toggle());
    this.panel.append(el("h2", {}, "Card Finder"), this.body);
    shadow.append(el("style", {}, STYLES), this.panel, fab);
    document.documentElement.append(this.host);
  }

  show(deckId: string | null): void {
    this.host.style.display = deckId ? "" : "none";
    if (deckId !== this.deckId) {
      this.stopCheck?.();
      this.deckId = deckId;
      this.load = null;
      this.panel.hidden = true;
    }
  }

  private async toggle(): Promise<void> {
    this.panel.hidden = !this.panel.hidden;
    if (!this.panel.hidden && !this.load) await this.loadDeck();
  }

  private links(...extra: HTMLElement[]): HTMLElement {
    const settings = el("button", { textContent: "Settings & stores" });
    settings.addEventListener("click", () => void sendBackground({ type: "openOptions" }));
    const paste = el("button", { textContent: "Check a card list" });
    paste.addEventListener("click", () => void sendBackground({ type: "openResults" }));
    const diagnostic = el("button", { textContent: "Diagnostics" });
    diagnostic.addEventListener("click", () => this.showDiagnostic());
    return el("div", { className: "links" }, ...extra, settings, paste, diagnostic);
  }

  private async loadDeck(): Promise<void> {
    if (!this.deckId) return;
    this.body.replaceChildren(el("p", { className: "muted" }, "Reading this deck…"));
    const settings = await loadSettings();
    const { tag } = settings;
    this.tag = tag;
    this.load = await loadDeck(this.deckId);
    const deck = this.load.deck as { name?: unknown } | undefined;
    if (!deck) {
      this.body.replaceChildren(
        el("p", {}, "Couldn't read this deck from Moxfield."),
        el(
          "p",
          { className: "muted" },
          "Run Diagnostics and share the report, or paste the cards you need with “Check a card list”.",
        ),
        this.links(),
      );
      return;
    }
    this.deckName = typeof deck.name === "string" ? deck.name : "Deck";
    this.wanted = extractWanted(deck, tag);
    if (!this.wanted.length) {
      this.body.replaceChildren(
        el("p", {}, `No cards tagged “${tag}” in this deck.`),
        el(
          "p",
          { className: "muted" },
          "Tag the cards you don't own in Moxfield, or change the tag in settings.",
        ),
        this.links(),
      );
      return;
    }
    const button = el("button", {
      className: "primary",
      textContent: `Check local stores (${this.wanted.length} card${this.wanted.length === 1 ? "" : "s"})`,
    });
    button.addEventListener("click", () => this.check(button));
    const children: HTMLElement[] = [
      el("p", { className: "muted" }, `Cards tagged “${tag}” in ${this.deckName}.`),
    ];
    if (onboardingState(settings).needsStores) {
      const add = el("button", { className: "primary", textContent: "Add stores" });
      add.addEventListener("click", () => void sendBackground({ type: "openOptions" }));
      children.push(el("p", {}, "Add your local stores before checking."), add);
      button.className = "secondary";
    }
    children.push(button, this.links());
    this.body.replaceChildren(...children);
  }

  private check(button: HTMLButtonElement): void {
    button.disabled = true;
    const results = el("div");
    this.body.replaceChildren(results, this.links());
    const state = {
      wanted: this.wanted,
      totalStores: 0,
      results: [] as StoreResult[],
      done: false,
    };
    results.append(el("p", { className: "muted" }, "Starting…"));
    this.stopCheck = runCheck(this.wanted, this.deckName, (event) => {
      switch (event.type) {
        case "no-stores": {
          const open = el("button", {
            className: "primary",
            textContent: "Add stores in settings",
          });
          open.addEventListener("click", () => void sendBackground({ type: "openOptions" }));
          results.replaceChildren(el("p", {}, "You haven't added any stores yet."), open);
          return;
        }
        case "needs-permission":
          // Content scripts can't call permissions.request; the settings page can.
          renderNeedsPermission(
            results,
            () => void sendBackground({ type: "openOptions", grant: true }),
          );
          return;
        case "started":
          state.totalStores = event.totalStores;
          break;
        case "result":
          state.results.push(event.result);
          break;
        case "done":
          state.done = true;
          break;
        case "error":
          results.append(el("p", { className: "cf-error" }, event.message));
          return;
      }
      if (state.totalStores) renderResults(results, state);
    });
  }

  private showDiagnostic(): void {
    const load = this.load;
    const report = el("div");
    if (!load) {
      report.append(el("p", { className: "muted" }, "Open a deck first."));
    } else {
      const summary = load.deck ? summarizeDeck(load.deck, this.tag) : null;
      report.append(
        el(
          "pre",
          {},
          load.attempts
            .map((a) => `${a.method}: HTTP ${a.status || "—"}${a.error ? ` (${a.error})` : ""}`)
            .join("\n"),
        ),
      );
      if (summary) {
        report.append(
          el(
            "pre",
            {},
            [
              `Boards: ${summary.boards.map((b) => `${b.name} ${b.cards}`).join(", ") || "none"}`,
              `Tag fields: ${summary.tagLocations.join(", ") || "none"}`,
              `Tagged "${this.tag}": ${summary.taggedCards.length}`,
              `Top-level keys: ${summary.topLevelKeys.join(", ")}`,
            ].join("\n"),
          ),
        );
      }
      const copy = el("button", { className: "secondary", textContent: "Copy report" });
      copy.addEventListener("click", () => {
        void navigator.clipboard.writeText(
          JSON.stringify({ deckId: this.deckId, attempts: load.attempts, summary }, null, 2),
        );
        copy.textContent = "Copied ✓";
      });
      report.append(copy);
    }
    const back = el("button", { className: "secondary", textContent: "Back" });
    back.addEventListener("click", () => void this.loadDeck());
    this.body.replaceChildren(report, back);
  }
}

const panel = new Panel();
let lastPath = "";
function onLocationChange(): void {
  if (location.pathname === lastPath) return;
  lastPath = location.pathname;
  panel.show(parseDeckId(location.pathname));
}
onLocationChange();
setInterval(onLocationChange, 1000);
