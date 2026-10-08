import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
// @ts-expect-error plain .mjs build script without types
import { manifestFor, TARGETS } from "../scripts/manifest.mjs";

const base = JSON.parse(readFileSync("static/manifest.json", "utf8")) as Record<string, unknown>;
type Manifest = {
  background: { service_worker?: string; scripts?: string[] };
  browser_specific_settings?: { gecko: { id: string; strict_min_version: string } };
};

describe("manifestFor", () => {
  it("keeps the service worker for Safari and Chrome", () => {
    for (const target of ["safari", "chrome"]) {
      const m = manifestFor(base, target) as Manifest;
      expect(m.background).toEqual({ service_worker: "background.js" });
      expect(m.browser_specific_settings).toBeUndefined();
    }
  });

  it("uses background scripts and a gecko id for Firefox", () => {
    const m = manifestFor(base, "firefox") as Manifest;
    expect(m.background).toEqual({ scripts: ["background.js"] });
    expect(m.browser_specific_settings?.gecko.id).toBe("card-finder@kylebolin.com");
    expect(m.browser_specific_settings?.gecko.strict_min_version).toBeTruthy();
  });

  it("does not modify the base manifest", () => {
    for (const target of TARGETS as string[]) manifestFor(base, target);
    expect(base).not.toHaveProperty("browser_specific_settings");
  });
});
