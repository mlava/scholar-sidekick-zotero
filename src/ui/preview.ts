// zotero-plugin/src/ui/preview.ts
//
// Pure rendering helpers for the preview table — kept framework-free so
// they're easy to unit-test and easy to drop into either a XUL or an
// HTML host document. The dialog passes a host element and a row set;
// preview.ts returns the rendered DOM and a selection api.

import type { VerifyMismatch } from "../api/types";
import type { VerifyRow } from "../types";

export type VerdictBadge =
  | { kind: "verified"; label: "Verified" }
  | { kind: "mismatch"; label: "Mismatch"; fields: VerifyMismatch["field"][] }
  | { kind: "resolved"; label: "Resolved" }
  | { kind: "not_found"; label: "Not found" }
  | { kind: "ambiguous"; label: "Ambiguous" }
  | { kind: "no_identifier"; label: "No identifier" }
  | { kind: "error"; label: "Check failed" };

export function badgeFor(row: VerifyRow): VerdictBadge {
  if (row.error) return { kind: "error", label: "Check failed" };
  switch (row.verdict) {
    case "matched":
      return { kind: "verified", label: "Verified" };
    case "mismatch":
      return { kind: "mismatch", label: "Mismatch", fields: row.mismatches.map((m) => m.field) };
    case "resolved":
      return { kind: "resolved", label: "Resolved" };
    case "not_found":
      return { kind: "not_found", label: "Not found" };
    case "ambiguous":
      return { kind: "ambiguous", label: "Ambiguous" };
    case "no_identifier":
      return { kind: "no_identifier", label: "No identifier" };
  }
}

export interface PreviewRowSummary {
  rowId: string;
  badge: VerdictBadge;
  title: string;
  identifier: string | null;
  confidence: VerifyRow["confidence"];
  retractionBanner: { tone: "red" | "amber"; label: string } | null;
  oaLink: { url: string; label: string } | null;
  errorMessage: string | null;
}

function retractionBanner(row: VerifyRow): PreviewRowSummary["retractionBanner"] {
  const r = row.retraction;
  if (!r) return null;
  if (r.isRetracted) return { tone: "red", label: "Retracted" };
  if (r.hasConcern) return { tone: "amber", label: "Expression of concern" };
  if (r.hasCorrections) return { tone: "amber", label: "Correction" };
  return null;
}

function oaLink(row: VerifyRow): PreviewRowSummary["oaLink"] {
  const oa = row.openAccess;
  if (!oa?.isOa || !oa.bestUrl) return null;
  return { url: oa.bestUrl, label: oa.oaStatus };
}

function identifierLabel(row: VerifyRow): string | null {
  const id = row.candidate.identifier;
  if (!id) return null;
  return `${id.type.toUpperCase()}: ${id.value}`;
}

export function summarize(row: VerifyRow): PreviewRowSummary {
  const claimedTitle = row.candidate.claimed.title;
  const resolvedTitle = typeof row.resolved?.title === "string" ? row.resolved.title : undefined;
  return {
    rowId: row.candidate.rowId,
    badge: badgeFor(row),
    title: claimedTitle ?? resolvedTitle ?? "(untitled)",
    identifier: identifierLabel(row),
    confidence: row.confidence,
    retractionBanner: retractionBanner(row),
    oaLink: oaLink(row),
    errorMessage: row.error?.message ?? null,
  };
}

/**
 * Build the preview model for a batch. Caller renders it into whatever
 * host element makes sense (XUL listbox, HTML table, devtools console).
 */
export function renderPreview(rows: VerifyRow[]): PreviewRowSummary[] {
  return rows.map(summarize);
}

/**
 * Default selection: verified, resolved, and ambiguous rows (all safe to
 * import — resolved/verified carry clean metadata, ambiguous prompts review).
 * Mismatch, not_found, no_identifier, and errored rows are NOT auto-selected;
 * the user opts in explicitly.
 */
export function defaultSelection(rows: VerifyRow[]): Set<string> {
  const selected = new Set<string>();
  for (const row of rows) {
    if (row.error) continue;
    if (row.verdict === "matched" || row.verdict === "resolved" || row.verdict === "ambiguous") {
      selected.add(row.candidate.rowId);
    }
  }
  return selected;
}
