// zotero-plugin/src/import/zotero.ts
//
// Materialise selected verify rows into the user's Zotero library. Per
// the plan, v0.1 imports the RESOLVED (canonical) metadata and attaches
// a child note documenting:
//   - what was claimed vs what resolved
//   - the verdict + confidence
//   - retraction notices (if any) and OA URL/license/version (if any)
//   - x-request-id, transform_version, verify_version for reproducibility
//
// Retracted items also get an auto-applied `retracted` tag.
//
// All item creation is wrapped in a single executeTransaction so a
// failure mid-batch rolls back cleanly.

import type { SlimItem } from "../api/types";
import type { VerifyRow } from "../types";

declare const Zotero: {
  Item: new (itemType: string) => ZoteroItem;
  Items: {
    getAsync: (id: number) => Promise<ZoteroItem | undefined>;
  };
  DB: {
    executeTransaction: <T>(fn: () => Promise<T>) => Promise<T>;
  };
  Libraries: { userLibraryID: number };
  Tags: {
    getColor: (libraryID: number, name: string) => { color: string; position: number } | false;
    getColors: (libraryID: number) => Map<string, unknown>;
    setColor: (libraryID: number, name: string, color: string, position: number) => Promise<void>;
  };
  debug: (msg: string) => void;
};

interface ZoteroItem {
  setField(field: string, value: string): void;
  setCreators(
    creators: Array<{ creatorType: string; firstName?: string; lastName?: string; name?: string }>,
  ): void;
  addTag(tag: string): void;
  addToCollection(collectionID: number): void;
  setNote(html: string): void;
  parentItemID: number | null;
  parentKey?: string;
  itemTypeID?: number;
  save(): Promise<number>;
  saveTx(): Promise<number>;
  id: number;
}

// Retraction Watch red, matching Zotero's own retraction indicator hue.
const RETRACTED_TAG = "retracted";
const RETRACTED_COLOR = "#CC2936";

/**
 * Give the `retracted` tag a red color so items carrying it show a colored
 * swatch in the items list (the closest a plugin-applied tag gets to
 * Zotero's native retraction ⊗). Idempotent and non-destructive: if the
 * user already colored this tag, we leave their choice alone. The color is
 * a library-wide setting, so this only runs when we actually tag something.
 */
async function ensureRetractedTagColor(libraryID: number): Promise<void> {
  try {
    if (Zotero.Tags.getColor(libraryID, RETRACTED_TAG)) return;
    const position = Zotero.Tags.getColors(libraryID)?.size ?? 0;
    await Zotero.Tags.setColor(libraryID, RETRACTED_TAG, RETRACTED_COLOR, position);
  } catch (err) {
    Zotero.debug(`[scholar-sidekick] ensureRetractedTagColor failed: ${String(err)}`);
  }
}

function setFieldSafe(item: ZoteroItem, field: string, value: string | undefined): void {
  if (typeof value !== "string" || !value.length) return;
  try {
    item.setField(field, value);
  } catch {
    // Field isn't valid for this item type — skip silently.
  }
}

/**
 * Populate a Zotero item from the slim BiblioItem shape returned by
 * /api/verify (matched) and /api/lookup (result). Note the nested
 * container + identifiers array — first-class DOI/ISBN/ISSN come from
 * `identifiers`, NOT flat top-level keys.
 */
function applyResolvedFields(item: ZoteroItem, resolved: SlimItem): void {
  setFieldSafe(item, "title", resolved.title);
  setFieldSafe(item, "publicationTitle", resolved.container?.title);
  setFieldSafe(item, "journalAbbreviation", resolved.container?.abbreviated);
  setFieldSafe(item, "volume", resolved.container?.volume);
  setFieldSafe(item, "issue", resolved.container?.issue);
  setFieldSafe(item, "url", resolved.url);

  if (resolved.issued?.year != null) {
    setFieldSafe(item, "date", String(resolved.issued.year));
  }

  const first = resolved.pages?.first;
  const last = resolved.pages?.last;
  if (first || last) {
    setFieldSafe(item, "pages", first && last ? `${first}-${last}` : (first ?? last ?? ""));
  }

  // Identifiers → first-class Zotero fields (not Extra).
  for (const id of resolved.identifiers ?? []) {
    if (id.type === "doi") setFieldSafe(item, "DOI", id.value);
    else if (id.type === "isbn") setFieldSafe(item, "ISBN", id.value);
    else if (id.type === "issn") setFieldSafe(item, "ISSN", id.value);
  }

  if (Array.isArray(resolved.authors) && resolved.authors.length) {
    item.setCreators(
      resolved.authors.map((a) => ({
        creatorType: "author",
        lastName: a.family,
        firstName: a.given,
        name: !a.family && a.literal ? a.literal : undefined,
      })),
    );
  }
}

/**
 * Fallback mapper for the Zotero-translator shape (row.candidate.rawCsl),
 * used when no resolved/lookup metadata is available but the user chose to
 * import anyway (e.g. a mismatch or not_found row parsed from a .bib).
 * This imports the CLAIMED metadata as supplied — the verification note
 * documents that it didn't verify.
 */
function applyRawCslFields(item: ZoteroItem, raw: Record<string, unknown>): void {
  const str = (k: string): string | undefined =>
    typeof raw[k] === "string" ? (raw[k] as string) : undefined;
  setFieldSafe(item, "title", str("title"));
  setFieldSafe(item, "publicationTitle", str("publicationTitle") ?? str("bookTitle"));
  setFieldSafe(item, "journalAbbreviation", str("journalAbbreviation"));
  setFieldSafe(item, "volume", str("volume"));
  setFieldSafe(item, "issue", str("issue"));
  setFieldSafe(item, "pages", str("pages"));
  setFieldSafe(item, "date", str("date"));
  setFieldSafe(item, "DOI", str("DOI"));
  setFieldSafe(item, "ISBN", str("ISBN"));
  setFieldSafe(item, "ISSN", str("ISSN"));
  setFieldSafe(item, "url", str("url"));

  const creators = raw.creators as
    | Array<{ creatorType?: string; firstName?: string; lastName?: string; name?: string }>
    | undefined;
  if (Array.isArray(creators) && creators.length) {
    item.setCreators(
      creators
        .filter((c) => !c.creatorType || c.creatorType === "author")
        .map((c) => ({
          creatorType: "author",
          lastName: c.lastName,
          firstName: c.firstName,
          name: !c.lastName && c.name ? c.name : undefined,
        })),
    );
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function buildVerificationNote(row: VerifyRow): string {
  const lines: string[] = [];
  lines.push("<h3>Scholar Sidekick verification</h3>");
  lines.push(
    `<p><strong>Verdict:</strong> ${escapeHtml(row.verdict)}` +
      (row.confidence ? ` (confidence: ${escapeHtml(row.confidence)})` : "") +
      "</p>",
  );

  if (row.mismatches.length) {
    lines.push("<p><strong>Claimed vs resolved:</strong></p><ul>");
    for (const m of row.mismatches) {
      lines.push(
        `<li>${escapeHtml(m.field)}: claimed “${escapeHtml(String(m.claimed ?? ""))}” → resolved “${escapeHtml(
          String(m.resolved ?? ""),
        )}” (similarity ${m.similarity.toFixed(2)})</li>`,
      );
    }
    lines.push("</ul>");
  }

  if (row.retraction) {
    const r = row.retraction;
    const labels: string[] = [];
    if (r.isRetracted) labels.push("retracted");
    if (r.hasConcern) labels.push("expression of concern");
    if (r.hasCorrections) labels.push("correction");
    if (labels.length) {
      lines.push(`<p><strong>Retraction status:</strong> ${escapeHtml(labels.join(", "))}.</p>`);
      if (r.notices.length) {
        lines.push("<ul>");
        for (const n of r.notices) {
          lines.push(
            `<li>${escapeHtml(n.label)}${n.date ? ` (${escapeHtml(n.date)})` : ""}${
              n.source ? ` — ${escapeHtml(n.source)}` : ""
            }</li>`,
          );
        }
        lines.push("</ul>");
      }
    }
  }

  if (row.openAccess?.isOa && row.openAccess.bestUrl) {
    lines.push(
      `<p><strong>Open access:</strong> <a href="${escapeHtml(row.openAccess.bestUrl)}">${escapeHtml(
        row.openAccess.bestUrl,
      )}</a> (${escapeHtml(row.openAccess.oaStatus)}` +
        (row.openAccess.license ? `, ${escapeHtml(row.openAccess.license)}` : "") +
        (row.openAccess.version ? `, ${escapeHtml(row.openAccess.version)}` : "") +
        ")</p>",
    );
  }

  const p = row.provenance;
  const provBits: string[] = [];
  if (p.requestId) provBits.push(`request-id: ${escapeHtml(p.requestId)}`);
  if (p.transformVersion) provBits.push(`transform_version: ${escapeHtml(p.transformVersion)}`);
  if (p.verifyVersion) provBits.push(`verify_version: ${escapeHtml(p.verifyVersion)}`);
  if (provBits.length) {
    lines.push(`<p><em>${provBits.join(" · ")}</em></p>`);
  }
  if (p.caveats.length) {
    lines.push("<p><strong>Caveats:</strong></p><ul>");
    for (const c of p.caveats) lines.push(`<li>${escapeHtml(c)}</li>`);
    lines.push("</ul>");
  }

  return lines.join("\n");
}

export interface ImportOptions {
  /** Zotero collection id to add the items to. Null = unfiled. */
  collectionId?: number | null;
}

export interface ImportResult {
  importedIds: number[];
  skipped: Array<{ rowId: string; reason: string }>;
}

/**
 * Import the selected rows into the user's library. Caller has already
 * filtered to the rows the user ticked. Rows whose verifier never
 * produced canonical metadata are skipped (the import note has nothing
 * to attach to).
 */
export async function importSelected(
  rows: VerifyRow[],
  opts: ImportOptions = {},
): Promise<ImportResult> {
  const importedIds: number[] = [];
  const skipped: ImportResult["skipped"] = [];
  let taggedRetracted = false;

  await Zotero.DB.executeTransaction(async () => {
    for (const row of rows) {
      if (!row.resolved && !row.candidate.rawCsl) {
        skipped.push({ rowId: row.candidate.rowId, reason: "no resolved metadata" });
        continue;
      }
      const item = new Zotero.Item(row.candidate.itemType);
      if (row.resolved) {
        applyResolvedFields(item, row.resolved);
      } else if (row.candidate.rawCsl) {
        applyRawCslFields(item, row.candidate.rawCsl);
      }
      if (row.retraction?.isRetracted) {
        item.addTag(RETRACTED_TAG);
        taggedRetracted = true;
      }
      // Add to the chosen collection (null = leave unfiled in My Library).
      if (typeof opts.collectionId === "number") {
        item.addToCollection(opts.collectionId);
      }
      const id = await item.save();
      importedIds.push(id);

      const note = new Zotero.Item("note");
      note.setNote(buildVerificationNote(row));
      note.parentItemID = id;
      await note.save();
    }
  });

  // Color the retracted tag red (library-wide, idempotent). Outside the
  // item transaction — setColor manages its own DB write.
  if (taggedRetracted) {
    await ensureRetractedTagColor(Zotero.Libraries.userLibraryID);
  }

  Zotero.debug(`[scholar-sidekick] imported ${importedIds.length}, skipped ${skipped.length}`);
  return { importedIds, skipped };
}

export const __test = { applyResolvedFields, applyRawCslFields, buildVerificationNote };
