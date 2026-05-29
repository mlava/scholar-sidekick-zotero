// scripts/sync-to-public.mjs
//
// Publish the built .xpi for Zotero auto-update. Run AFTER `npm run build`
// (which produces scholar-sidekick-<version>.xpi). This:
//   1. computes the .xpi's sha256
//   2. rewrites update.json (version, update_link, update_hash)
//   3. copies the .xpi + update.json into the app's public/zotero-plugin/,
//      which Vercel serves at https://scholar-sidekick.com/zotero-plugin/*
//      — the exact URLs addon/manifest.json's update_url points to.
//
// Per-release flow: bump version in package.json + addon/manifest.json,
// then `npm run release`.

import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const ADDON_ID = "scholar-sidekick@scholar-sidekick.com";
const BASE_URL = "https://scholar-sidekick.com/zotero-plugin";

const version = JSON.parse(readFileSync("package.json", "utf8")).version;
const xpiName = `scholar-sidekick-${version}.xpi`;
const xpiPath = resolve(xpiName);

let xpiBytes;
try {
  xpiBytes = readFileSync(xpiPath);
} catch {
  console.error(`[scholar-sidekick] ${xpiName} not found — run \`npm run build\` first.`);
  process.exit(1);
}

const sha256 = createHash("sha256").update(xpiBytes).digest("hex");

const updateManifest = {
  addons: {
    [ADDON_ID]: {
      updates: [
        {
          version,
          update_link: `${BASE_URL}/${xpiName}`,
          update_hash: `sha256:${sha256}`,
          applications: {
            zotero: { strict_min_version: "7.0", strict_max_version: "9.*" },
          },
        },
      ],
    },
  },
};

const updateJson = JSON.stringify(updateManifest, null, 2) + "\n";
writeFileSync(resolve("update.json"), updateJson);

// public/ lives at the repo root, one level up from zotero-plugin/.
const publicDir = resolve("..", "public", "zotero-plugin");
mkdirSync(publicDir, { recursive: true });
copyFileSync(xpiPath, resolve(publicDir, xpiName));
writeFileSync(resolve(publicDir, "update.json"), updateJson);

console.log(`[scholar-sidekick] published ${xpiName} (sha256:${sha256.slice(0, 12)}…)`);
console.log(`[scholar-sidekick] → ${publicDir}`);
