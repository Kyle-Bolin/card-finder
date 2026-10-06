import { describe, expect, it } from "vitest";
import {
  isWelcomeQuery,
  onboardingState,
  shouldShowWelcomeOnInstall,
  welcomeSteps,
} from "../src/lib/onboarding";

describe("onboarding", () => {
  it("needs stores only when none are saved", () => {
    expect(onboardingState({ stores: [] }).needsStores).toBe(true);
    expect(
      onboardingState({ stores: [{ url: "https://a.tcgplayerpro.com", name: "A" }] }).needsStores,
    ).toBe(false);
  });

  it("opens the welcome page on install but not on update", () => {
    expect(shouldShowWelcomeOnInstall({ reason: "install" })).toBe(true);
    expect(shouldShowWelcomeOnInstall({ reason: "update" })).toBe(false);
    expect(shouldShowWelcomeOnInstall({ reason: "browser_update" })).toBe(false);
  });

  it("detects welcome=1 in the query", () => {
    expect(isWelcomeQuery("?welcome=1")).toBe(true);
    expect(isWelcomeQuery("?welcome=0")).toBe(false);
    expect(isWelcomeQuery("")).toBe(false);
  });

  it("uses the configured tag in the steps", () => {
    expect(welcomeSteps("need")[1]).toContain("“need”");
    expect(welcomeSteps("need")).toHaveLength(3);
  });
});
