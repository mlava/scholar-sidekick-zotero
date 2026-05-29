// zotero-plugin/src/ui/dialog.ts
//
// Owns the import-boundary verifier dialog. Splits cleanly into:
//   - buildController() — pure(ish) factory that returns the object the
//     XHTML view calls into. Easy to unit-test without a real window.
//   - openImportDialog() — opens the XHTML view (addon/chrome/content/
//     dialog.xhtml) and passes the controller via window.arguments.
//
// All Zotero/DOM coupling is in the controller methods; the view is a
// thin shell.

import { importSelected as runImport } from "../import/zotero";
import type { StartupContext } from "../index";
import { ingest } from "../ingest/translate";
import { getPref } from "../prefs";
import type { VerifyRow } from "../types";
import { orchestrate } from "../verify/orchestrator";
import { type CollectionOption, enumerateCollections, pickBibliographyFile } from "./collections";
import type { PreviewRowSummary } from "./preview";
import { renderPreview } from "./preview";

declare const Zotero: { debug: (msg: string) => void };

// chrome://scholar-sidekick/content/ is registered in bootstrap.js via
// aomStartup.registerChrome. file:// URLs are silently rejected by
// Zotero 9's openDialog (modal opens to about:blank).
const DIALOG_URL = "chrome://scholar-sidekick/content/dialog.xhtml";
const DIALOG_FEATURES = "chrome,centerscreen,resizable,dialog=no,scrollbars,width=820,height=620";

export interface DialogController {
  pickFile: () => Promise<string | null>;
  runVerify: (
    text: string,
    onProgress?: (done: number, total: number) => void,
  ) => Promise<{ rows: PreviewRowSummary[] }>;
  getCollections: () => Promise<CollectionOption[]>;
  importSelected: (
    rowIds: string[],
    collectionId: number | null,
  ) => Promise<{ importedIds: number[]; skipped: Array<{ rowId: string; reason: string }> }>;
  getApiKeyStatus: () => { hasKey: boolean };
}

/**
 * Build the controller exposed to the XHTML view. Stateful because the
 * view holds onto row ids — the controller is the only thing that knows
 * how to map an id back to its VerifyRow for the import step.
 */
export function buildController(win: Window): DialogController {
  let lastRows: VerifyRow[] = [];

  return {
    async pickFile() {
      return pickBibliographyFile(win);
    },

    async runVerify(text, onProgress) {
      const candidates = await ingest(text);
      if (!candidates.length) {
        lastRows = [];
        return { rows: [] };
      }
      lastRows = await orchestrate(candidates, { onProgress });
      return { rows: renderPreview(lastRows) };
    },

    async getCollections() {
      try {
        return enumerateCollections();
      } catch (err) {
        Zotero.debug(`[scholar-sidekick] enumerateCollections failed: ${String(err)}`);
        return [];
      }
    },

    async importSelected(rowIds, collectionId) {
      const idSet = new Set(rowIds);
      const rows = lastRows.filter((r) => idSet.has(r.candidate.rowId));
      return runImport(rows, { collectionId });
    },

    getApiKeyStatus() {
      return { hasKey: getPref("apiKey").trim().length > 0 };
    },
  };
}

/**
 * Open the verifier modal. The XHTML view reads `window.arguments[0]` to
 * get the controller and drives the flow from there.
 */
export async function openImportDialog(win: Window, _ctx: StartupContext): Promise<void> {
  const controller = buildController(win);
  Zotero.debug(`[scholar-sidekick] opening ${DIALOG_URL}`);

  // openDialog passes the trailing arguments through as window.arguments.
  // We wrap the controller in an object so the view sees a consistent
  // shape even when we add fields later.
  const openDialog = (
    win as unknown as {
      openDialog: (
        url: string,
        name: string,
        features: string,
        ...args: unknown[]
      ) => Window | null;
    }
  ).openDialog;
  openDialog.call(win, DIALOG_URL, "scholar-sidekick-import", DIALOG_FEATURES, controller);
}
