// zotero-plugin/src/verify/orchestrator.ts
//
// For each candidate row: build a VerifyClaim, hit /api/verify, then fan
// out /api/retraction-check + /api/oa-check in parallel for any item
// where an identifier resolved. Runs with bounded concurrency so the UI
// stays responsive on large bibliographies.
//
// The orchestrator deliberately does not stop on per-row errors — the
// preview table renders error rows alongside successes so the user can
// decide what to import. Network failure for one entry doesn't poison
// the batch.

import { checkOpenAccess, checkRetraction, lookupIdentifier, verifyCitation } from "../api/client";
import type {
  ApiResult,
  OaPayload,
  RetractionPayload,
  SlimItem,
  VerifyClaim,
  VerifyPayload,
} from "../api/types";
import type { BiblioCandidate, VerifyRow } from "../types";

const DEFAULT_CONCURRENCY = 4;

export interface OrchestrateOptions {
  concurrency?: number;
  onProgress?: (done: number, total: number) => void;
  signal?: { aborted: boolean };
}

// /api/verify caps `claimed.authors` at 50 (consortium papers can list
// hundreds). The verifier only compares the first author, so truncating
// is lossless for the verdict and avoids a 400 "Too big" rejection.
const MAX_CLAIM_AUTHORS = 50;

function toClaim(candidate: BiblioCandidate): VerifyClaim {
  const authors = candidate.claimed.authors;
  const claim: VerifyClaim = {
    title: candidate.claimed.title,
    authors:
      authors && authors.length > MAX_CLAIM_AUTHORS ? authors.slice(0, MAX_CLAIM_AUTHORS) : authors,
    year: candidate.claimed.year,
    container: candidate.claimed.container,
  };
  if (candidate.identifier) {
    claim[candidate.identifier.type] = candidate.identifier.value;
  }
  return claim;
}

function rowWithoutIdentifier(candidate: BiblioCandidate): VerifyRow {
  return {
    candidate,
    verdict: "no_identifier",
    mismatches: [],
    provenance: {
      requestId: null,
      transformVersion: null,
      verifyVersion: null,
      caveats: [],
    },
  };
}

function rowFromError(
  candidate: BiblioCandidate,
  res: Extract<ApiResult<unknown>, { ok: false }>,
): VerifyRow {
  return {
    candidate,
    verdict: "not_found",
    mismatches: [],
    provenance: {
      requestId: null,
      transformVersion: null,
      verifyVersion: null,
      caveats: [],
    },
    error: { status: res.status, message: res.message },
  };
}

function doiFromIdentifiers(item: SlimItem | null | undefined): string | undefined {
  const hit = item?.identifiers?.find((i) => i.type === "doi");
  return typeof hit?.value === "string" ? hit.value : undefined;
}

/**
 * Format an identifier so the server's detect engine re-recognizes it.
 * /api/lookup, /api/retraction-check and /api/oa-check all re-detect the
 * `id` they receive — and a BARE value isn't always detectable (notably a
 * bare PMID, which collides with any 6–9 digit number). Send the labeled
 * form for the ambiguous types; DOI/ISBN/ADS/URL are self-identifying.
 */
function detectableId(id: { type: string; value: string }): string {
  switch (id.type) {
    case "pmid":
      return `PMID: ${id.value}`;
    case "pmcid":
      return /^pmc/i.test(id.value) ? id.value : `PMCID: ${id.value}`;
    case "arxiv":
      return `arXiv:${id.value}`;
    case "issn":
      return `ISSN ${id.value}`;
    default:
      return id.value;
  }
}

/**
 * Run retraction + OA checks for an identifier. Both endpoints require one,
 * so callers pass the best available id (resolved DOI preferred, else the
 * user-supplied identifier). Returns undefined snapshots when there's no id
 * or the upstream check failed — never throws.
 */
async function enrichChecks(
  idForChecks: string | undefined,
): Promise<{ retraction: VerifyRow["retraction"]; openAccess: VerifyRow["openAccess"] }> {
  if (!idForChecks) return { retraction: undefined, openAccess: undefined };

  const [r, oa] = await Promise.all([checkRetraction(idForChecks), checkOpenAccess(idForChecks)]);

  let retraction: VerifyRow["retraction"];
  let openAccess: VerifyRow["openAccess"];

  if (r.ok && r.data.result) {
    retraction = {
      isRetracted: r.data.result.isRetracted,
      hasCorrections: r.data.result.hasCorrections,
      hasConcern: r.data.result.hasConcern,
      notices: r.data.result.notices.map((n) => ({
        type: n.type,
        label: n.label,
        date: n.date,
        source: n.source,
      })),
    };
  }
  if (oa.ok && oa.data.result) {
    openAccess = {
      isOa: oa.data.result.isOa,
      oaStatus: oa.data.result.oaStatus,
      bestUrl: oa.data.result.bestLocation?.url,
      license: oa.data.result.bestLocation?.license ?? null,
      version: oa.data.result.bestLocation?.version ?? null,
    };
  }
  return { retraction, openAccess };
}

/** Verify path: claim has a title, so compare claimed vs resolved. */
async function enrichVerify(candidate: BiblioCandidate, verify: VerifyPayload): Promise<VerifyRow> {
  const idForChecks =
    doiFromIdentifiers(verify.matched) ??
    (candidate.identifier ? detectableId(candidate.identifier) : undefined);
  const { retraction, openAccess } = await enrichChecks(idForChecks);
  return {
    candidate,
    verdict: verify.verdict,
    confidence: verify.confidence,
    mismatches: verify.mismatches,
    resolved: verify.matched ?? undefined,
    retraction,
    openAccess,
    provenance: {
      requestId: verify.requestId ?? null,
      transformVersion: verify.transformVersion ?? null,
      verifyVersion: verify.verifyVersion ?? null,
      caveats: verify._provenance?.caveats ?? [],
    },
  };
}

/**
 * Lookup path: no claimed title, so there's nothing to verify — resolve the
 * identifier to metadata instead. Verdict is "resolved" (a neutral state),
 * not a verifier verdict. Retraction + OA still run.
 */
async function enrichLookup(
  candidate: BiblioCandidate,
  resolved: SlimItem | null,
  requestId: string | null,
  transformVersion: string | null,
  reason?: "not_found",
): Promise<VerifyRow> {
  const idForChecks =
    doiFromIdentifiers(resolved) ??
    (candidate.identifier ? detectableId(candidate.identifier) : undefined);
  const { retraction, openAccess } = await enrichChecks(idForChecks);
  return {
    candidate,
    // A resolved item → "resolved"; a not_found from lookup → "not_found".
    verdict: resolved ? "resolved" : "not_found",
    mismatches: [],
    resolved: resolved ?? undefined,
    retraction,
    openAccess,
    provenance: {
      requestId,
      transformVersion,
      verifyVersion: null,
      caveats: reason === "not_found" ? ["Identifier did not resolve."] : [],
    },
  };
}

async function processOne(
  candidate: BiblioCandidate,
  signal?: { aborted: boolean },
): Promise<VerifyRow> {
  if (signal?.aborted) return rowWithoutIdentifier(candidate);

  const hasTitle = !!candidate.claimed.title;
  const hasIdentifier = !!candidate.identifier;

  // Nothing to verify and nothing to resolve.
  if (!hasTitle && !hasIdentifier) return rowWithoutIdentifier(candidate);

  // No claimed title → the verifier can't compare (it requires a title).
  // Resolve the identifier to metadata instead.
  if (!hasTitle) {
    const lookup = await lookupIdentifier(detectableId(candidate.identifier!));
    if (!lookup.ok) return rowFromError(candidate, lookup);
    return enrichLookup(
      candidate,
      lookup.data.result,
      lookup.data.requestId ?? null,
      lookup.data.transformVersion ?? null,
      lookup.data.reason,
    );
  }

  // Claimed title present → real verification.
  const verify = await verifyCitation(toClaim(candidate));
  if (!verify.ok) return rowFromError(candidate, verify);
  return enrichVerify(candidate, verify.data);
}

/**
 * Verify a batch of candidates with bounded concurrency. Returns one
 * VerifyRow per candidate in input order. Errors are surfaced on
 * individual rows rather than thrown.
 */
export async function orchestrate(
  candidates: BiblioCandidate[],
  opts: OrchestrateOptions = {},
): Promise<VerifyRow[]> {
  const cap = Math.max(1, opts.concurrency ?? DEFAULT_CONCURRENCY);
  const rows = new Array<VerifyRow | undefined>(candidates.length);
  let nextIndex = 0;
  let done = 0;

  async function worker(): Promise<void> {
    while (true) {
      const i = nextIndex++;
      if (i >= candidates.length) return;
      if (opts.signal?.aborted) {
        rows[i] = rowWithoutIdentifier(candidates[i]);
      } else {
        rows[i] = await processOne(candidates[i], opts.signal);
      }
      done += 1;
      opts.onProgress?.(done, candidates.length);
    }
  }

  const pool = Array.from({ length: Math.min(cap, candidates.length) }, () => worker());
  await Promise.all(pool);
  return rows.map((r, i) => r ?? rowWithoutIdentifier(candidates[i]));
}

// Internal exports for tests — keep this list narrow.
export const __test = {
  toClaim,
  rowWithoutIdentifier,
  rowFromError,
  enrichVerify,
  enrichLookup,
  doiFromIdentifiers,
  detectableId,
};

// Silence unused-import lint when the type-only imports aren't referenced
// in this exact frame (RetractionPayload/OaPayload are referenced via
// generic instantiation in client.ts return types — re-exported here so
// future contributors can import the type surface from one place).
export type { OaPayload, RetractionPayload };
