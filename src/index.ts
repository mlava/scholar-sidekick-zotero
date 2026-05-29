// zotero-plugin/src/index.ts
//
// Plugin entry. esbuild bundles this into addon/chrome/content/main.js as
// an IIFE that exposes globalThis.ScholarSidekick. bootstrap.js then calls
// ScholarSidekick.startup({ id, version, rootURI }) on plugin load and
// ScholarSidekick.shutdown() on unload.

import { registerToolsMenu, unregisterToolsMenu } from "./ui/menu";

declare const Zotero: {
  debug: (msg: string) => void;
};

export interface StartupContext {
  id: string;
  version: string;
  rootURI: string;
}

let started = false;

export async function startup(ctx: StartupContext): Promise<void> {
  if (started) return;
  started = true;
  Zotero.debug(`[scholar-sidekick] startup v${ctx.version} (${ctx.id})`);
  registerToolsMenu(ctx);
}

export async function shutdown(): Promise<void> {
  if (!started) return;
  started = false;
  unregisterToolsMenu();
  Zotero.debug("[scholar-sidekick] shutdown");
}
