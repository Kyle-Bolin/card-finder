import browser from "webextension-polyfill";
import { storageAreaStore, TtlCache } from "../lib/cache";
import {
  artistCounts,
  artistSearchUrl,
  loadDeckArt,
  SCRYFALL_CACHE_TTL_MS,
  ScryfallClient,
  type Art,
  type ArtDeckCard,
  type CardArt,
  type DeckArt,
} from "../lib/scryfall";
import { ARTISTS_KEY_PREFIX, type ArtistsDeck } from "../lib/artistsDeck";

function $<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`#${id} missing`);
  return node as T;
}

const statusEl = $("status");
const basicsEl = $<HTMLInputElement>("basics");
const store = storageAreaStore(() => browser.storage?.local);
const caches = {
  printings: new TtlCache<Art>(store, "scryfall:print:", SCRYFALL_CACHE_TTL_MS),
  arts: new TtlCache<Art[]>(store, "scryfall:arts:", SCRYFALL_CACHE_TTL_MS),
};

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

function thumb(src: string | undefined, alt: string): HTMLElement {
  if (!src) return el("span");
  const img = el("img", { src, alt, loading: "lazy" });
  img.width = 60;
  img.style.borderRadius = "4px";
  img.style.marginRight = "8px";
  img.style.verticalAlign = "middle";
  return img;
}

const artistText = (art: Art) => [...new Set(art.faces.map((f) => f.artist))].join(" / ");

const open = new Set<string>();

function cardRow(row: CardArt): HTMLLIElement {
  const li = el("li");
  li.style.display = "block";
  const printing = row.printing;
  const head = el("div", { className: "name" }, thumb(printing?.faces[0]?.image, ""), row.name);
  const meta = el("div", { className: "meta" });
  if (printing) {
    meta.textContent =
      printing.faces.length > 1
        ? printing.faces.map((f) => `${f.name}: ${f.artist}`).join(" · ")
        : artistText(printing);
  } else {
    meta.textContent = "Looking up…";
  }
  li.append(head, meta);
  if (row.alternatives) {
    const details = el("details");
    details.open = open.has(row.name);
    details.addEventListener("toggle", () => {
      if (details.open) open.add(row.name);
      else open.delete(row.name);
    });
    const count = row.alternatives.length;
    details.append(el("summary", {}, `${count} other artwork${count === 1 ? "" : "s"}`));
    const list = el("ul");
    for (const alt of row.alternatives) {
      const item = el("li");
      item.style.display = "block";
      item.append(
        thumb(alt.faces[0]?.image, ""),
        el("a", {
          href: alt.url,
          target: "_blank",
          rel: "noopener",
          textContent: `${artistText(alt)} – ${alt.setName} #${alt.collectorNumber}`,
        }),
      );
      list.append(item);
    }
    details.append(list);
    li.append(details);
  } else if (row.isBasic && !basicsEl.checked) {
    li.append(el("div", { className: "meta" }, "Basic land: alternatives hidden."));
  }
  return li;
}

function render(state: DeckArt): void {
  $("signed").textContent = state.signedSkipped
    ? `${state.signedSkipped} signed card${state.signedSkipped === 1 ? "" : "s"} skipped.`
    : "";
  $("artists").replaceChildren(
    ...artistCounts(state.rows).map(({ artist, count }) => {
      const li = el("li");
      li.style.display = "block";
      li.append(
        el("a", {
          href: artistSearchUrl(artist),
          target: "_blank",
          rel: "noopener",
          textContent: artist,
        }),
        ` · ${count} card${count === 1 ? "" : "s"}`,
      );
      return li;
    }),
  );
  $("cards").replaceChildren(...state.rows.map(cardRow));
  const pending = state.rows.filter((r) => !r.printing).length;
  if (state.error) statusEl.textContent = `${state.error} Showing what loaded so far.`;
  else if (pending) statusEl.textContent = "Looking up printings…";
}

let cards: ArtDeckCard[] = [];
let runId = 0;
async function run(): Promise<void> {
  const mine = ++runId;
  statusEl.textContent = "Loading from Scryfall…";
  const result = await loadDeckArt(cards, {
    client: new ScryfallClient(fetch.bind(globalThis)),
    caches,
    includeBasics: basicsEl.checked,
    onUpdate: (s) => {
      if (mine === runId) render(s);
    },
  });
  if (mine !== runId) return;
  render(result);
  if (!result.error) statusEl.textContent = "";
}

async function main(): Promise<void> {
  const deckId = new URLSearchParams(location.search).get("deck");
  const key = ARTISTS_KEY_PREFIX + (deckId ?? "");
  const deck = deckId ? ((await store.get(key)) as ArtistsDeck | undefined) : undefined;
  if (!deck) {
    statusEl.textContent = "Open a deck on Moxfield and use Artists ↗ in the Card Finder panel.";
    return;
  }
  $("title").textContent = `Artists in ${deck.name}`;
  cards = deck.cards;
  basicsEl.addEventListener("change", () => void run());
  await run();
}

void main();
