// Bundles the extension into dist/, which the Xcode project references.
// Usage: node scripts/build.mjs [--watch]
import { context } from "esbuild";
import { cpSync, mkdirSync, rmSync, watch } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");
const isWatch = process.argv.includes("--watch");

const copyStatic = () => cpSync(join(root, "static"), dist, { recursive: true });

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });
copyStatic();

const ctx = await context({
  entryPoints: {
    background: "src/background/background.ts",
    "content/moxfield": "src/content/moxfield.ts",
    "options/options": "src/options/options.ts",
    "popup/popup": "src/popup/popup.ts",
    "results/results": "src/results/results.ts",
  },
  absWorkingDir: root,
  outdir: dist,
  bundle: true,
  format: "iife",
  target: ["safari16"],
  sourcemap: isWatch ? "inline" : false,
  logLevel: "info",
});

if (isWatch) {
  await ctx.watch();
  watch(join(root, "static"), { recursive: true }, copyStatic);
  console.log("Watching for changes…");
} else {
  await ctx.rebuild();
  await ctx.dispose();
}
