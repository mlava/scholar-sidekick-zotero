// scripts/package-xpi.mjs
//
// Zip the addon/ tree into scholar-sidekick-<version>.xpi at the repo root.
// Run after `npm run build` (which bundles main.js into addon/chrome/content).

import { createWriteStream, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";

const version = JSON.parse(readFileSync("package.json", "utf8")).version;
const outFile = resolve(`scholar-sidekick-${version}.xpi`);

// Use `zip` for deterministic ordering; available on macOS/Linux/CI runners.
execFileSync("zip", ["-r", "-X", outFile, "."], { cwd: resolve("addon"), stdio: "inherit" });

console.log(`[scholar-sidekick] packaged ${outFile}`);
// Silence unused import lint until we wire a logger.
void createWriteStream;
