// Bundles the extension. Safari builds into dist/, which the Xcode project references;
// Chrome and Firefox build into build/<target>/.
// Usage: node scripts/build.mjs [--target safari|chrome|firefox|all] [--watch]
import { context } from "esbuild";
import { cpSync, mkdirSync, readFileSync, rmSync, watch, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { manifestFor, TARGETS } from "./manifest.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const isWatch = process.argv.includes("--watch");
const targetArg = process.argv.includes("--target")
  ? process.argv[process.argv.indexOf("--target") + 1]
  : "safari";
if (targetArg !== "all" && !TARGETS.includes(targetArg)) {
  throw new Error(`Unknown --target "${targetArg}". Use ${TARGETS.join(", ")} or all.`);
}
const targets = targetArg === "all" ? TARGETS : [targetArg];

const outDir = (target) => join(root, target === "safari" ? "dist" : join("build", target));
const esbuildTarget = { safari: "safari16", chrome: "chrome120", firefox: "firefox128" };

async function build(target) {
  const out = outDir(target);
  const copyStatic = () => {
    cpSync(join(root, "static"), out, { recursive: true });
    const base = JSON.parse(readFileSync(join(root, "static/manifest.json"), "utf8"));
    writeFileSync(
      join(out, "manifest.json"),
      `${JSON.stringify(manifestFor(base, target), null, 2)}\n`,
    );
  };

  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
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
    outdir: out,
    bundle: true,
    format: "iife",
    target: [esbuildTarget[target]],
    sourcemap: isWatch ? "inline" : false,
    logLevel: "info",
  });

  if (isWatch) {
    await ctx.watch();
    watch(join(root, "static"), { recursive: true }, copyStatic);
    console.log(`Watching ${target} for changes…`);
  } else {
    await ctx.rebuild();
    await ctx.dispose();
  }
}

for (const target of targets) await build(target);
