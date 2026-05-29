// zotero-plugin/src/api/types.ts
//
// Wire types for the Scholar Sidekick API. Mirrors the obsidian-plugin
// type surface in obsidian-plugin/src/lib/api.ts so the two plugins stay
// in sync against the same server contract. Update both when the contract
// changes (see app/api/verify/route.ts, app/api/retraction-check/route.ts,
// app/api/oa-check/route.ts).

export type VerifyVerdict = "matched" | "mismatch" | "not_found" | "ambiguous";
export type VerifyConfidence = "high" | "medium" | "low";

export interface VerifyAuthor {
  family: string;
  given?: string;
}

export interface VerifyClaim {
  title?: string;
  authors?: VerifyAuthor[];
  year?: number;
  container?: string;
  doi?: string;
  pmid?: string;
  pmcid?: string;
  isbn?: string;
  arxiv?: string;
  issn?: string;
  ads?: string;
  whoIrisUrl?: string;
}

export interface VerifyMismatch {
  field: "title" | "first_author" | "year" | "container";
  claimed: string | number | null;
  resolved: string | number | null;
  similarity: number;
}

export interface VerifyCandidateItem {
  title?: string;
  authors?: Array<{ family?: string; given?: string }>;
  issued?: { year?: number };
  container?: { title?: string };
  identifiers?: Array<{ type: string; value: string }>;
  [k: string]: unknown;
}

export interface VerifyCandidate {
  item: VerifyCandidateItem;
  registries: string[];
  score: number;
}

export interface VerifyProvenance {
  stages_run: Array<"compare" | "search" | "llm_screen">;
  resolved_via: string | null;
  registries_searched?: Array<{ registry: string; ok: boolean; count: number; reason?: string }>;
  caveats?: string[];
  skipped_reason?: "insufficient_claim";
}

export interface VerifyPayload {
  verdict: VerifyVerdict;
  confidence: VerifyConfidence;
  matched: VerifyCandidateItem | null;
  mismatches: VerifyMismatch[];
  candidates?: VerifyCandidate[];
  _provenance: VerifyProvenance;
  requestId?: string | null;
  transformVersion?: string | null;
  verifyVersion?: string | null;
}

export type CheckReason = "no_doi" | "timeout" | "upstream";

export interface RetractionPayload {
  doi: string | null;
  resolvedFrom?: { type: string; value: string };
  result: {
    isRetracted: boolean;
    hasCorrections: boolean;
    hasConcern: boolean;
    notices: Array<{
      type: string;
      label: string;
      doi: string | null;
      date: string | null;
      source: string | null;
    }>;
    title: string | null;
  } | null;
  reason?: CheckReason;
  requestId?: string | null;
}

export interface OaPayload {
  doi: string | null;
  resolvedFrom?: { type: string; value: string };
  result: {
    isOa: boolean;
    oaStatus: "gold" | "green" | "hybrid" | "bronze" | "closed";
    title: string | null;
    bestLocation: {
      url: string;
      hostType: string;
      license: string | null;
      version: string | null;
    } | null;
    locations: Array<{
      url: string;
      hostType: string;
      license: string | null;
      version: string | null;
    }>;
  } | null;
  reason?: CheckReason;
  requestId?: string | null;
}

export interface DetectedIdentifier {
  type: "doi" | "pmid" | "pmcid" | "isbn" | "issn" | "arxiv" | "ads" | "whoIrisUrl";
  value: string;
}

export interface DetectPayload {
  identifiers: DetectedIdentifier[];
  requestId?: string | null;
}

/**
 * Slim resolved item shape returned by /api/lookup and as /api/verify's
 * `matched`. Mirrors src/lib/biblio/normalize.ts -> toSlim(). This is the
 * authoritative metadata the plugin imports — note the nested container
 * and the identifiers array (NOT flat DOI/ISBN fields).
 */
export interface SlimItem {
  id?: string;
  type?: string;
  title?: string;
  authors?: Array<{ family?: string; given?: string; literal?: string }>;
  container?: {
    title?: string;
    abbreviated?: string;
    volume?: string;
    issue?: string;
  };
  issued?: { year?: number };
  pages?: { first?: string; last?: string };
  number?: string;
  url?: string;
  identifiers?: Array<{ type: string; value: string }>;
  [k: string]: unknown;
}

/**
 * /api/lookup response — resolve an identifier to metadata. `result` is
 * null when the identifier didn't resolve (with reason: "not_found").
 */
export interface LookupPayload {
  input: { type: string; value: string };
  result: SlimItem | null;
  reason?: "not_found";
  requestId?: string | null;
  transformVersion?: string | null;
}

export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; message: string; retryAfterSec?: number };
