import browser from "webextension-polyfill";
import type { StoreResult } from "./check";
import type { WantedCard } from "./types";

/** Port name for running a store check in the background worker. */
export const CHECK_PORT = "check-stores";

export interface CheckRequest {
  type: "start";
  wanted: WantedCard[];
  /** Shown with saved results, e.g. the deck name. */
  label: string;
}

export type CheckEvent =
  | { type: "started"; totalStores: number }
  | { type: "result"; result: StoreResult }
  | { type: "done" }
  | { type: "no-stores" }
  | { type: "error"; message: string };

/** One-off requests to the background worker. */
export type BackgroundRequest =
  | { type: "fetchText"; url: string }
  | { type: "openOptions" }
  | { type: "openResults"; query?: string };

/**
 * Check the user's stores for `wanted` in the background, calling `onEvent` as
 * stores report in. Returns a function that stops listening.
 */
export function runCheck(
  wanted: WantedCard[],
  label: string,
  onEvent: (event: CheckEvent) => void,
): () => void {
  const port = browser.runtime.connect({ name: CHECK_PORT });
  port.onMessage.addListener((message: unknown) => onEvent(message as CheckEvent));
  port.onDisconnect.addListener(() => onEvent({ type: "done" }));
  const request: CheckRequest = { type: "start", wanted, label };
  port.postMessage(request);
  return () => port.disconnect();
}
