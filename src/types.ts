// zotero-plugin/src/types.ts
//
// Plugin-internal types for the import-boundary verifier flow. Wire types
// shared with the SS API surface live in src/api/types.ts.

import type { SlimItem, VerifyConfidence, VerifyMismatch, VerifyVerdict } from "./api/types";

/**
 * A single entry parsed from a pasted bibliography or imported .bib/.ris
 * file. The claimed fields come straight from what the user supplied; the
 * verifier compares them against the metadata resolved from `identifier`.
 */
export interface BiblioCandidate {
  /** Stable client-side id for table rendering / selection state. */
  rowId: string;
  /** CSL item type ("article-journal", "book", etc.). */
  itemType: string;
  /** Claimed citation metadata as supplied by the user. */
  claimed: {
    title?: string;
    authors?: Array<{ family: string; given?: string }>;
    year?: number;
    container?: string;
  };
  /** First identifier found in the entry — DOI, PMID, PMCID, ISBN, arXiv, etc. */
  identifier?: {
    type: "doi" | "pmid" | "pmcid" | "isbn" | "issn" | "arxiv" | "ads" | "whoIrisUrl";
    value: string;
  };
  /** Raw CSL-ish object from Zotero's translator, kept for the import step. */
  rawCsl?: Record<string, unknown>;
}

export interface RetractionSnapshot {
  isRetracted: boolean;
  hasCorrections: boolean;
  hasConcern: boolean;
  notices: Array<{ type: string; label: string; date: string | null; source: string | null }>;
}

export interface OpenAccessSnapshot {
  isOa: boolean;
  oaStatus: "gold" | "green" | "hybrid" | "bronze" | "closed";
  bestUrl?: string;
  license?: string | null;
  version?: string | null;
}

/**
 * Per-row verifier result, including retraction and OA enrichment for
 * items where an identifier resolved. UI renders one row per candidate.
 */
export interface VerifyRow {
  candidate: BiblioCandidate;
  /**
   * Verifier verdicts plus two plugin-only states:
   *   - "resolved"      — no claim to verify; identifier resolved to metadata
   *   - "no_identifier" — nothing to verify and nothing to resolve
   */
  verdict: VerifyVerdict | "resolved" | "no_identifier";
  confidence?: VerifyConfidence;
  mismatches: VerifyMismatch[];
  /** Canonical resolved metadata (slim BiblioItem) from verify or lookup. */
  resolved?: SlimItem;
  retraction?: RetractionSnapshot;
  openAccess?: OpenAccessSnapshot;
  /** Provenance metadata for the import note (request id, versions, caveats). */
  provenance: {
    requestId: string | null;
    transformVersion: string | null;
    verifyVersion: string | null;
    caveats: string[];
  };
  /** Set when the per-row verifier call failed; the row is still displayed. */
  error?: { status: number; message: string };
}
