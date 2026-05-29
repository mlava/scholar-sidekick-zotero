// zotero-plugin/esbuild.config.mjs
//
// Bundle src/index.ts into addon/chrome/content/main.js. Targets a
// Firefox-flavored ES env (Zotero 7 ships Firefox ESR 115 internals) and
// emits a single IIFE that exposes globalThis.ScholarSidekick.
//
// `node esbuild.config.mjs`            — watch mode for dev
// `node esbuild.config.mjs production` — single-pass minified build

import esbuild from "esbuild";

const prod = process.argv.includes("production");

const options = {
  entryPoints: ["src/index.ts"],
  outfile: "addon/chrome/content/main.js",
  bundle: true,
  format: "iife",
  globalName: "ScholarSidekick",
  target: ["firefox115"],
  platform: "browser",
  minify: prod,
  sourcemap: prod ? false : "inline",
  treeShaking: true,
  logLevel: "info",
  // Zotero injects these as ambient globals at script-load time.
  external: [],
  define: {
    "process.env.NODE_ENV": prod ? '"production"' : '"development"',
    "process.env.PLUGIN_VERSION": JSON.stringify(
      JSON.parse((await import("node:fs")).readFileSync("package.json", "utf8")).version,
    ),
  },
  // esbuild's globalName emits `var ScholarSidekick = (() => {...})();`,
  // which doesn't reliably land on globalThis inside a Services.scriptloader
  // .loadSubScript sandbox. Pin the assignment explicitly so bootstrap.js
  // can always read `globalThis.ScholarSidekick`.
  footer: {
    js: "globalThis.ScholarSidekick = ScholarSidekick;",
  },
};

if (prod) {
  await esbuild.build(options);
  console.log("[scholar-sidekick] production build complete");
} else {
  const ctx = await esbuild.context(options);
  await ctx.watch();
  console.log("[scholar-sidekick] watching src/ for changes…");
}
