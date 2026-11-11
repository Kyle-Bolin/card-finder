import { describe, expect, it } from "vitest";
import {
  defaultValues,
  evaluate,
  findInteractions,
  INTERACTIONS,
  parseInput,
  SOUL_WARDEN_OCELOT_PRIDE as entry,
} from "../src/lib/interactions";

describe("findInteractions", () => {
  it.each(["Soul Warden", "Soul's Attendant", "Essence Warden"])(
    "matches %s with Ocelot Pride",
    (w) => {
      const found = findInteractions(["Sol Ring", w, "Ocelot Pride"]);
      expect(found.map((m) => m.interaction.id)).toEqual([entry.id]);
      expect(found[0]?.matched.map((m) => m.cards)).toEqual([[w], ["Ocelot Pride"]]);
    },
  );

  it("needs both roles", () => {
    expect(findInteractions(["Soul Warden", "Sol Ring"])).toEqual([]);
    expect(findInteractions(["Ocelot Pride"])).toEqual([]);
    expect(findInteractions([])).toEqual([]);
  });

  it("ignores case and matches either face of a double-faced card", () => {
    expect(findInteractions(["soul warden", "Ocelot Pride // Something"])).toHaveLength(1);
  });

  it("is registered in the catalog", () => {
    expect(INTERACTIONS).toContain(entry);
  });
});

describe("Soul Warden × Ocelot Pride", () => {
  const values = (n: bigint, R = 1n, T = 1n, O = 0n) => ({ n, R, T, O });

  it("counts a single trigger by hand", () => {
    // W = 2, N = 2: 2 + 4 + 1·1 = 7 life; 3 new tokens; Wardens 1 + 2.
    expect(evaluate(entry, values(1n)).totals).toEqual({ life: 7n, tokens: 3n, wardens: 3n });
  });

  it("does nothing with no triggers", () => {
    expect(evaluate(entry, values(0n)).totals).toEqual({ life: 0n, tokens: 0n, wardens: 2n });
  });

  it("closed form equals the step-by-step count for every n from 0 to 40", () => {
    for (const [R, T, O] of [
      [1n, 1n, 0n],
      [0n, 2n, 3n],
      [3n, 0n, 5n],
      [2n, 4n, 1n],
    ] as const) {
      for (let n = 0n; n <= 40n; n++) {
        const result = evaluate(entry, values(n, R, T, O));
        expect(result.agrees).toBe(true);
        expect(result.closed).toEqual(result.totals);
        expect(result.rows).toHaveLength(Number(n));
      }
    }
  });

  it("stays exact for large counts", () => {
    const result = evaluate(entry, values(40n, 1_000_000_000n, 1_000_000_000n, 1_000_000_000n));
    expect(result.agrees).toBe(true);
    expect(result.totals.life).toBeGreaterThan(2n ** 80n);
  });
});

describe("parseInput", () => {
  const n = entry.inputs[0]!;
  it("clamps and falls back to the default", () => {
    expect(parseInput(n, "11")).toBe(11n);
    expect(parseInput(n, "99")).toBe(40n);
    expect(parseInput(n, "")).toBe(n.default);
    expect(parseInput(n, "-3")).toBe(n.default);
    expect(parseInput(n, "1.5")).toBe(n.default);
  });

  it("provides defaults for every input", () => {
    expect(Object.keys(defaultValues(entry))).toEqual(["n", "R", "T", "O"]);
  });
});
