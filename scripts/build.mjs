// scripts/build.mjs
//
// Bundles lib/index.js into dist/ as ESM and IIFE, dev + minified.
// IIFE bundles expose the public API at window.FairsquareForm so they can be
// dropped into Framer/Webflow/plain HTML via a single <script src> tag.

import { build, context } from "esbuild";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const entry = path.join(root, "lib/index.js");
const outDir = path.join(root, "dist");

const isWatch = process.argv.includes("--watch");
const pkg = JSON.parse(await fs.readFile(path.join(root, "package.json"), "utf8"));

await fs.mkdir(outDir, { recursive: true });

const banner = {
  js: `/*! @fairsquare/libform v${pkg.version} | https://github.com/jhilton-fairsquare/fairsquare-libform */`,
};

const targets = [
  { format: "iife", file: "fairsquare-form.iife.js",     minify: false, sourcemap: true,  globalName: "FairsquareForm" },
  { format: "iife", file: "fairsquare-form.iife.min.js", minify: true,  sourcemap: false, globalName: "FairsquareForm" },
  { format: "esm",  file: "fairsquare-form.esm.js",      minify: false, sourcemap: true },
  { format: "esm",  file: "fairsquare-form.esm.min.js",  minify: true,  sourcemap: false },
];

const opts = (t) => ({
  entryPoints: [entry],
  bundle: true,
  format: t.format,
  outfile: path.join(outDir, t.file),
  minify: t.minify,
  sourcemap: t.sourcemap,
  globalName: t.globalName,
  banner,
  // ES2020 covers Framer (Chromium-based), modern Webflow, and any browser
  // released after 2020. Drop to es2017 if older support becomes a need.
  target: ["es2020"],
  platform: "browser",
  logLevel: "warning",
  legalComments: "none",
});

const sizeReport = async () => {
  console.log("\n  Build artifacts:");
  for (const t of targets) {
    const fp = path.join(outDir, t.file);
    try {
      const stat = await fs.stat(fp);
      console.log(`    ${t.file.padEnd(34)} ${(stat.size / 1024).toFixed(2)} KB`);
    } catch { /* output not present yet */ }
  }
  console.log();
};

if (isWatch) {
  // Watch the unminified bundles only — fast iteration, no need for the
  // minifier in dev.
  const ctxs = await Promise.all(targets.filter((t) => !t.minify).map((t) => context(opts(t))));
  await Promise.all(ctxs.map((c) => c.watch()));
  console.log(`[libform] watching… (${ctxs.length} bundles, ctrl-c to stop)`);
} else {
  const start = Date.now();
  await Promise.all(targets.map((t) => build(opts(t))));
  console.log(`[libform] built ${targets.length} bundles in ${Date.now() - start}ms`);
  await sizeReport();
}
