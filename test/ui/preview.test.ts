// test/ui/preview.test.ts
//
// Pure rendering helpers — no Zotero globals needed.

import { describe, expect, it } from "vitest";

import type { VerifyRow } from "../../src/types";
import { badgeFor, defaultSelection, summarize } from "../../src/ui/preview";

function row(over: Partial<VerifyRow> = {}): VerifyRow {
  return {
    candidate: {
      rowId: "r1",
      itemType: "journalArticle",
      claimed: { title: "Claimed" },
      identifier: { type: "doi", value: "10.1000/x" },
    },
    verdict: "matched",
    confidence: "high",
    mismatches: [],
    provenance: { requestId: null, transformVersion: null, verifyVersion: null, caveats: [] },
    ...over,
  };
}

describe("ui/preview — badgeFor", () => {
  it("maps verdicts to badge kinds", () => {
    expect(badgeFor(row({ verdict: "matched" })).kind).toBe("verified");
    expect(badgeFor(row({ verdict: "resolved" })).kind).toBe("resolved");
    expect(badgeFor(row({ verdict: "ambiguous" })).kind).toBe("ambiguous");
    expect(badgeFor(row({ verdict: "not_found" })).kind).toBe("not_found");
    expect(badgeFor(row({ verdict: "no_identifier" })).kind).toBe("no_identifier");
  });

  it("renders mismatch fields on the mismatch badge", () => {
    const b = badgeFor(
      row({
        verdict: "mismatch",
        mismatches: [{ field: "title", claimed: "a", resolved: "b", similarity: 0 }],
      }),
    );
    expect(b.kind).toBe("mismatch");
    if (b.kind === "mismatch") expect(b.fields).toEqual(["title"]);
  });

  it("returns error badge regardless of verdict when row.error is set", () => {
    expect(
      badgeFor(row({ verdict: "matched", error: { status: 500, message: "boom" } })).kind,
    ).toBe("error");
  });
});

describe("ui/preview — summarize", () => {
  it("surfaces retraction banner with red tone for retracted rows", () => {
    const s = summarize(
      row({
        retraction: {
          isRetracted: true,
          hasCorrections: false,
          hasConcern: false,
          notices: [],
        },
      }),
    );
    expect(s.retractionBanner).toEqual({ tone: "red", label: "Retracted" });
  });

  it("surfaces OA link when isOa=true and bestUrl is set", () => {
    const s = summarize(
      row({
        openAccess: {
          isOa: true,
          oaStatus: "gold",
          bestUrl: "https://example.org",
          license: "cc-by",
          version: "publishedVersion",
        },
      }),
    );
    expect(s.oaLink).toEqual({ url: "https://example.org", label: "gold" });
  });
});

describe("ui/preview — defaultSelection", () => {
  it("auto-selects matched, resolved, and ambiguous rows", () => {
    const rows = [
      row({ verdict: "matched" }),
      row({ candidate: { ...row().candidate, rowId: "r2" }, verdict: "ambiguous" }),
      row({ candidate: { ...row().candidate, rowId: "r3" }, verdict: "mismatch" }),
      row({ candidate: { ...row().candidate, rowId: "r4" }, verdict: "no_identifier" }),
      row({ candidate: { ...row().candidate, rowId: "r5" }, verdict: "resolved" }),
    ];
    const sel = defaultSelection(rows);
    expect(sel.has("r1")).toBe(true);
    expect(sel.has("r2")).toBe(true);
    expect(sel.has("r3")).toBe(false);
    expect(sel.has("r4")).toBe(false);
    expect(sel.has("r5")).toBe(true);
  });

  it("never auto-selects rows with errors", () => {
    const sel = defaultSelection([row({ verdict: "matched", error: { status: 0, message: "x" } })]);
    expect(sel.size).toBe(0);
  });
});
