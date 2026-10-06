import type { Settings } from "./settings";

export const WELCOME_PARAM = "welcome";

export interface OnboardingState {
  /** No stores saved yet: setup is the next step, not a check. */
  needsStores: boolean;
}

export function onboardingState(settings: Pick<Settings, "stores">): OnboardingState {
  return { needsStores: settings.stores.length === 0 };
}

/** Only a fresh install opens the welcome page, not an update or browser update. */
export function shouldShowWelcomeOnInstall(details: { reason: string }): boolean {
  return details.reason === "install";
}

export function isWelcomeQuery(search: string): boolean {
  return new URLSearchParams(search).get(WELCOME_PARAM) === "1";
}

export function welcomeSteps(tag: string): string[] {
  return [
    "Find stores near you",
    `Tag the cards you don't own in Moxfield with “${tag}”`,
    "Open a deck and tap Card Finder",
  ];
}
