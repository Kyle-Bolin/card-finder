/**
 * A hand-curated catalog of card interactions whose math is hard to do at the table.
 * Adding one means adding an entry to `INTERACTIONS` and a test; the page renders any entry.
 */

export interface InteractionRole {
  id: string;
  label: string;
  /** Card names that can fill this role. */
  cards: string[];
}

export interface InteractionInput {
  id: string;
  label: string;
  help?: string;
  default: bigint;
  min: bigint;
  max: bigint;
}

export interface InteractionOutput {
  id: string;
  label: string;
}

export interface SimulationResult {
  /** One row per step, matching the entry's `columns`. */
  rows: bigint[][];
  /** The step-by-step total of every output id. */
  totals: Record<string, bigint>;
}

export interface Interaction {
  id: string;
  name: string;
  summary: string;
  roles: InteractionRole[];
  inputs: InteractionInput[];
  outputs: InteractionOutput[];
  /** Column headings of the trigger-by-trigger table. */
  columns: string[];
  /** Counts the interaction one step at a time. */
  simulate(values: Values): SimulationResult;
  /** The same totals from the closed-form formulas. */
  closedForm(values: Values): Record<string, bigint>;
  formulas: string[];
  rules: { cite: string; text: string }[];
  assumptions: string[];
}

export type Values = Record<string, bigint>;

/** Lowercased face names, so "Delver of Secrets // Insectile Aberration" matches either face. */
function faceNames(name: string): string[] {
  return name.split("//").map((face) => face.trim().toLowerCase());
}

export interface InteractionMatch {
  interaction: Interaction;
  /** For each role, the deck cards filling it. */
  matched: { role: InteractionRole; cards: string[] }[];
}

/** The catalog entries whose roles are all filled by cards in the deck. */
export function findInteractions(
  deckCards: string[],
  catalog: Interaction[] = INTERACTIONS,
): InteractionMatch[] {
  const matches: InteractionMatch[] = [];
  for (const interaction of catalog) {
    const matched = interaction.roles.map((role) => {
      const wanted = new Set(role.cards.map((c) => c.toLowerCase()));
      const cards = [
        ...new Set(deckCards.filter((card) => faceNames(card).some((face) => wanted.has(face)))),
      ];
      return { role, cards };
    });
    if (matched.every((m) => m.cards.length)) matches.push({ interaction, matched });
  }
  return matches;
}

/** Reads an input field's text, falling back to the default and clamping to its range. */
export function parseInput(input: InteractionInput, text: string): bigint {
  const trimmed = text.trim();
  if (!/^\d+$/.test(trimmed)) return input.default;
  const value = BigInt(trimmed);
  return value < input.min ? input.min : value > input.max ? input.max : value;
}

export function defaultValues(interaction: Interaction): Values {
  return Object.fromEntries(interaction.inputs.map((i) => [i.id, i.default]));
}

export interface Evaluation extends SimulationResult {
  closed: Record<string, bigint>;
  /** Whether the closed form equals the step-by-step count for every output. */
  agrees: boolean;
}

export function evaluate(interaction: Interaction, values: Values): Evaluation {
  const simulated = interaction.simulate(values);
  const closed = interaction.closedForm(values);
  const agrees = interaction.outputs.every((o) => simulated.totals[o.id] === closed[o.id]);
  return { ...simulated, closed, agrees };
}

const MAX_TRIGGERS = 40n;
const MAX_COUNT = 1_000_000_000n;

/** Soul Warden × Ocelot Pride: each end-step trigger copies every token that entered this turn. */
export const SOUL_WARDEN_OCELOT_PRIDE: Interaction = {
  id: "soul-warden-ocelot-pride",
  name: "Soul Warden × Ocelot Pride",
  summary:
    "Ocelot Pride's end-step trigger copies every token that entered this turn, the copies trigger each other, and life gained grows like 4ⁿ.",
  roles: [
    {
      id: "lifegain",
      label: "Lifegain-on-enter",
      cards: ["Soul Warden", "Soul's Attendant", "Essence Warden"],
    },
    { id: "copier", label: "Token copier", cards: ["Ocelot Pride"] },
  ],
  inputs: [
    {
      id: "n",
      label: "n: Ocelot Pride triggers",
      help: "Capped at 40.",
      default: 3n,
      min: 0n,
      max: MAX_TRIGGERS,
    },
    {
      id: "R",
      label: "R: nontoken Wardens",
      default: 1n,
      min: 0n,
      max: MAX_COUNT,
    },
    {
      id: "T",
      label: "T: Warden tokens that entered this turn",
      default: 1n,
      min: 0n,
      max: MAX_COUNT,
    },
    {
      id: "O",
      label: "O: other creature tokens that entered this turn",
      default: 0n,
      min: 0n,
      max: MAX_COUNT,
    },
  ],
  outputs: [
    { id: "life", label: "Life gained" },
    { id: "tokens", label: "New tokens" },
    { id: "wardens", label: "Wardens at end" },
  ],
  columns: ["Trigger", "Wardens (W)", "Tokens entering (N)", "Life gained", "New tokens"],
  simulate({ n = 0n, R = 0n, T = 0n, O = 0n }) {
    const rows: bigint[][] = [];
    let life = 0n;
    let tokens = 0n;
    let t = T;
    let c = O;
    for (let k = 1n; k <= n; k++) {
      const w = R + t;
      const entering = t + c + 1n;
      const gain = w + w * entering + t * (entering - 1n);
      const created = t + c + 2n;
      life += gain;
      tokens += created;
      rows.push([k, w, entering, gain, created]);
      t *= 2n;
      c = 2n * (c + 1n);
    }
    return { rows, totals: { life, tokens, wardens: R + t } };
  },
  closedForm({ n = 0n, R = 0n, T = 0n, O = 0n }) {
    const m = 2n ** n;
    const s = T + O + 2n;
    // (2/3)·T·S·(M² − 1): M² − 1 = 4ⁿ − 1 is always divisible by 3, so this stays exact.
    const life = (m - 1n) * (R * s - 2n * T) + 2n * T * s * ((m * m - 1n) / 3n);
    return { life, tokens: (m - 1n) * s, wardens: R + m * T };
  },
  formulas: [
    "M = 2ⁿ, S = T + O + 2",
    "Life gained = (M − 1)·[R·S − 2T] + (2/3)·T·S·(M² − 1)",
    "New tokens = (M − 1)·S",
    "Wardens at end = R + M·T",
    "Per trigger: W = R + Tₖ, N = Tₖ + Cₖ + 1; gain W + W·N + Tₖ·(N − 1); then T → 2T, C → 2(C + 1)",
  ],
  rules: [
    {
      cite: "608.2c",
      text: "A resolving ability follows its instructions in the order written, so the copies are made as part of one resolution.",
    },
    {
      cite: "Glossary: Enter the battlefield (tokens)",
      text: "A token is created and then enters, so each token copy counts as a creature entering.",
    },
    {
      cite: "603.6a",
      text: "Enters-the-battlefield abilities trigger as the permanent enters, so each Warden sees the creatures that enter with or after it.",
    },
    {
      cite: "603.10",
      text: "Some triggers look back in time, which is how Wardens that enter together trigger off each other.",
    },
  ],
  assumptions: [
    "The city's blessing is gained from the first trigger.",
    "Ocelot Pride's lifelink is ignored.",
  ],
};

export const INTERACTIONS: Interaction[] = [SOUL_WARDEN_OCELOT_PRIDE];
