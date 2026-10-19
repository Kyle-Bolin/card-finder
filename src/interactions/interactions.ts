import browser from "webextension-polyfill";
import {
  defaultValues,
  evaluate,
  findInteractions,
  INTERACTIONS,
  parseInput,
  type Interaction,
  type InteractionMatch,
} from "../lib/interactions";
import { INTERACTIONS_KEY_PREFIX, type InteractionsDeck } from "../lib/interactionsDeck";

function $<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`#${id} missing`);
  return node as T;
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

const format = (n: bigint) => n.toLocaleString("en-US");

function section({ interaction, matched }: InteractionMatch): HTMLElement {
  const values = defaultValues(interaction);
  const results = el("div");

  const fields = interaction.inputs.map((input) => {
    const field = el("input", {
      type: "number",
      value: String(input.default),
      min: String(input.min),
      max: String(input.max),
      step: "1",
    });
    field.addEventListener("input", () => {
      values[input.id] = parseInput(input, field.value);
      renderResults();
    });
    field.addEventListener("change", () => {
      values[input.id] = parseInput(input, field.value);
      field.value = String(values[input.id]);
      renderResults();
    });
    const label = el("label", {}, input.label, " ", field);
    return input.help ? [label, el("span", { className: "hint" }, ` ${input.help}`)] : [label];
  });

  function renderResults(): void {
    const result = evaluate(interaction, values);
    const table = el("table");
    table.append(
      el("thead", {}, el("tr", {}, ...interaction.columns.map((c) => el("th", {}, c)))),
      el(
        "tbody",
        {},
        ...result.rows.map((row) => el("tr", {}, ...row.map((cell) => el("td", {}, format(cell))))),
      ),
    );
    results.replaceChildren(
      el(
        "ul",
        { className: "cards" },
        ...interaction.outputs.map((o) =>
          el(
            "li",
            {},
            el("div", { className: "name" }, `${o.label}: ${format(result.closed[o.id] ?? 0n)}`),
          ),
        ),
      ),
      el(
        "p",
        { className: result.agrees ? "hint" : "status error" },
        result.agrees
          ? "The closed-form result matches the step-by-step count."
          : "The closed-form result does NOT match the step-by-step count.",
      ),
      el("h3", {}, "Trigger by trigger"),
      result.rows.length ? table : el("p", { className: "hint" }, "No triggers."),
    );
  }

  const node = el(
    "section",
    {},
    el("h2", {}, interaction.name),
    el("p", { className: "hint" }, interaction.summary),
    el(
      "p",
      {},
      el("strong", {}, "In your deck: "),
      matched.map((m) => `${m.cards.join(", ")} (${m.role.label.toLowerCase()})`).join("; "),
    ),
    el("h3", {}, "Calculator"),
    ...fields.flat().flatMap((n) => [n, el("br")]),
    results,
    el("h3", {}, "Formulas"),
    el("ul", {}, ...interaction.formulas.map((f) => el("li", {}, f))),
    el("h3", {}, "Rules"),
    el(
      "ul",
      {},
      ...interaction.rules.map((r) => el("li", {}, el("strong", {}, r.cite), `: ${r.text}`)),
    ),
    el("h3", {}, "Assumptions"),
    el("ul", {}, ...interaction.assumptions.map((a) => el("li", {}, a))),
  );
  renderResults();
  return node;
}

function describe(interaction: Interaction): HTMLLIElement {
  const needs = interaction.roles.map((r) => `${r.label}: ${r.cards.join(", ")}`).join("; ");
  return el(
    "li",
    {},
    el("div", { className: "name" }, interaction.name),
    el("div", { className: "meta" }, needs),
  );
}

async function main(): Promise<void> {
  const deckId = new URLSearchParams(location.search).get("deck");
  const key = INTERACTIONS_KEY_PREFIX + (deckId ?? "");
  const deck = deckId
    ? ((await browser.storage.local.get(key))[key] as InteractionsDeck | undefined)
    : undefined;
  if (!deck) {
    $("status").textContent =
      "Open a deck on Moxfield and use Interactions ↗ in the Card Finder panel.";
    return;
  }
  $("title").textContent = `Interactions in ${deck.name}`;
  const matches = findInteractions(deck.cards);
  if (matches.length) {
    $("sections").replaceChildren(...matches.map(section));
    return;
  }
  $("status").textContent = "No interactions found in this deck.";
  $("known").replaceChildren(...INTERACTIONS.map(describe));
  $("catalog").hidden = false;
}

void main();
