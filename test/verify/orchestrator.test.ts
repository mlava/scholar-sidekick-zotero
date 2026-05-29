// test/verify/orchestrator.test.ts
//
// Mocks the API client and asserts the orchestrator's batch behaviour:
// concurrency cap honoured, retraction + OA only requested when an
// identifier is present, errors surface on individual rows rather than
// aborting the batch.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const apiMocks = vi.hoisted(() => ({
  verifyCitation: vi.fn(),
  lookupIdentifier: vi.fn(),
  checkRetraction: vi.fn(),
  checkOpenAccess: vi.fn(),
  detectIdentifiers: vi.fn(),
}));

vi.mock("../../src/api/client", () => apiMocks);

beforeEach(() => {
  // Default: retraction + OA checks return "no result" so the shared
  // enrichChecks path never crashes. Individual tests override as needed.
  apiMocks.checkRetraction.mockResolvedValue({ ok: false, status: 0, message: "no check" });
  apiMocks.checkOpenAccess.mockResolvedValue({ ok: false, status: 0, message: "no check" });
});

afterEach(() => {
  apiMocks.verifyCitation.mockReset();
  apiMocks.lookupIdentifier.mockReset();
  apiMocks.checkRetraction.mockReset();
  apiMocks.checkOpenAccess.mockReset();
});

function makeCandidate(rowId: string, withId: boolean, withTitle = true) {
  return {
    rowId,
    itemType: "journalArticle",
    claimed: withTitle ? { title: "Sample Title", year: 2024 } : {},
    identifier: withId ? ({ type: "doi", value: "10.1000/x" } as const) : undefined,
  };
}

describe("verify/orchestrator", () => {
  it("returns no_identifier for rows with neither identifier nor title", async () => {
    const { orchestrate } = await import("../../src/verify/orchestrator");
    const rows = await orchestrate([{ rowId: "r1", itemType: "journalArticle", claimed: {} }]);
    expect(rows[0].verdict).toBe("no_identifier");
    expect(apiMocks.verifyCitation).not.toHaveBeenCalled();
  });

  it("fans out retraction + OA only when an identifier resolved", async () => {
    apiMocks.verifyCitation.mockResolvedValue({
      ok: true,
      data: {
        verdict: "matched",
        confidence: "high",
        matched: { title: "Sample Title", identifiers: [{ type: "doi", value: "10.1000/x" }] },
        mismatches: [],
        _provenance: { stages_run: ["compare"], resolved_via: "crossref", caveats: [] },
        requestId: "req-1",
        transformVersion: "t1",
        verifyVersion: "v1",
      },
    });
    apiMocks.checkRetraction.mockResolvedValue({
      ok: true,
      data: {
        doi: "10.1000/x",
        result: {
          isRetracted: false,
          hasCorrections: false,
          hasConcern: false,
          notices: [],
          title: null,
        },
      },
    });
    apiMocks.checkOpenAccess.mockResolvedValue({
      ok: true,
      data: {
        doi: "10.1000/x",
        result: {
          isOa: true,
          oaStatus: "gold",
          title: null,
          bestLocation: {
            url: "https://example.org/pdf",
            hostType: "publisher",
            license: "cc-by",
            version: "publishedVersion",
          },
          locations: [],
        },
      },
    });

    const { orchestrate } = await import("../../src/verify/orchestrator");
    const rows = await orchestrate([makeCandidate("r1", true)]);
    expect(rows[0].verdict).toBe("matched");
    expect(rows[0].retraction?.isRetracted).toBe(false);
    expect(rows[0].openAccess?.isOa).toBe(true);
    expect(apiMocks.checkRetraction).toHaveBeenCalledTimes(1);
    expect(apiMocks.checkOpenAccess).toHaveBeenCalledTimes(1);
  });

  it("caps claimed.authors at 50 before calling verify (consortium papers)", async () => {
    apiMocks.verifyCitation.mockResolvedValue({
      ok: true,
      data: {
        verdict: "matched",
        confidence: "high",
        matched: null,
        mismatches: [],
        _provenance: { stages_run: ["compare"], resolved_via: null, caveats: [] },
      },
    });
    const authors = Array.from({ length: 170 }, (_, i) => ({ family: `Author${i}` }));
    const { orchestrate } = await import("../../src/verify/orchestrator");
    await orchestrate([
      {
        rowId: "r1",
        itemType: "journalArticle",
        claimed: { title: "Big consortium paper", authors },
        identifier: { type: "doi", value: "10.1038/x" },
      },
    ]);
    const claim = apiMocks.verifyCitation.mock.calls[0][0];
    expect(claim.authors).toHaveLength(50);
    expect(claim.authors[0].family).toBe("Author0");
  });

  it("sends a re-detectable (labeled) id to lookup for a bare PMID", async () => {
    apiMocks.lookupIdentifier.mockResolvedValue({
      ok: true,
      data: { input: { type: "pmid", value: "31986264" }, result: { title: "X" } },
    });
    const { orchestrate } = await import("../../src/verify/orchestrator");
    await orchestrate([
      {
        rowId: "r1",
        itemType: "journalArticle",
        claimed: {},
        identifier: { type: "pmid", value: "31986264" },
      },
    ]);
    expect(apiMocks.lookupIdentifier).toHaveBeenCalledWith("PMID: 31986264");
  });

  it("detectableId labels ambiguous types and leaves DOI bare", async () => {
    const { __test } = await import("../../src/verify/orchestrator");
    expect(__test.detectableId({ type: "pmid", value: "31986264" })).toBe("PMID: 31986264");
    expect(__test.detectableId({ type: "arxiv", value: "2210.06886" })).toBe("arXiv:2210.06886");
    expect(__test.detectableId({ type: "issn", value: "1234-5678" })).toBe("ISSN 1234-5678");
    expect(__test.detectableId({ type: "doi", value: "10.1/x" })).toBe("10.1/x");
    expect(__test.detectableId({ type: "pmcid", value: "PMC123" })).toBe("PMC123");
  });

  it("uses the lookup path (not verify) when there's an identifier but no title", async () => {
    apiMocks.lookupIdentifier.mockResolvedValue({
      ok: true,
      data: {
        input: { type: "doi", value: "10.1000/x" },
        result: {
          title: "Resolved Title",
          identifiers: [{ type: "doi", value: "10.1000/x" }],
        },
        requestId: "req-lookup",
      },
    });
    apiMocks.checkRetraction.mockResolvedValue({ ok: false, status: 0, message: "x" });
    apiMocks.checkOpenAccess.mockResolvedValue({ ok: false, status: 0, message: "x" });

    const { orchestrate } = await import("../../src/verify/orchestrator");
    const rows = await orchestrate([makeCandidate("r1", true, false)]);

    expect(apiMocks.verifyCitation).not.toHaveBeenCalled();
    expect(apiMocks.lookupIdentifier).toHaveBeenCalledWith("10.1000/x");
    expect(rows[0].verdict).toBe("resolved");
    expect(rows[0].resolved?.title).toBe("Resolved Title");
  });

  it("marks a lookup with no result as not_found", async () => {
    apiMocks.lookupIdentifier.mockResolvedValue({
      ok: true,
      data: { input: { type: "doi", value: "10.1000/x" }, result: null, reason: "not_found" },
    });
    apiMocks.checkRetraction.mockResolvedValue({ ok: false, status: 0, message: "x" });
    apiMocks.checkOpenAccess.mockResolvedValue({ ok: false, status: 0, message: "x" });

    const { orchestrate } = await import("../../src/verify/orchestrator");
    const rows = await orchestrate([makeCandidate("r1", true, false)]);
    expect(rows[0].verdict).toBe("not_found");
    expect(rows[0].provenance.caveats).toContain("Identifier did not resolve.");
  });

  it("surfaces per-row API errors without aborting the batch", async () => {
    apiMocks.verifyCitation
      .mockResolvedValueOnce({ ok: false, status: 500, message: "boom" })
      .mockResolvedValueOnce({
        ok: true,
        data: {
          verdict: "not_found",
          confidence: "low",
          matched: null,
          mismatches: [],
          _provenance: { stages_run: ["search"], resolved_via: null, caveats: [] },
        },
      });

    const { orchestrate } = await import("../../src/verify/orchestrator");
    const rows = await orchestrate([makeCandidate("r1", true), makeCandidate("r2", true)]);
    expect(rows[0].error?.message).toBe("boom");
    expect(rows[1].verdict).toBe("not_found");
  });

  it("respects the concurrency cap", async () => {
    let inFlight = 0;
    let peak = 0;
    apiMocks.verifyCitation.mockImplementation(async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight -= 1;
      return {
        ok: true,
        data: {
          verdict: "matched",
          confidence: "high",
          matched: null,
          mismatches: [],
          _provenance: { stages_run: ["compare"], resolved_via: null, caveats: [] },
        },
      };
    });

    const { orchestrate } = await import("../../src/verify/orchestrator");
    const candidates = Array.from({ length: 10 }, (_, i) => makeCandidate(`r${i}`, false));
    // No identifier → orchestrator early-returns without hitting the API,
    // so use rows with claimed.title to force the verifier path.
    candidates.forEach((c) => (c.claimed.title = "Forced"));
    await orchestrate(candidates, { concurrency: 2 });
    expect(peak).toBeLessThanOrEqual(2);
  });
});
