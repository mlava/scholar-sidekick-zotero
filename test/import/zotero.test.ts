// test/import/zotero.test.ts
//
// Asserts the import layer: resolved-metadata fields populate first-class
// Zotero fields (not Extra), retracted rows get the `retracted` tag, and
// the verification note records caveats + provenance.

import { beforeEach, describe, expect, it, vi } from "vitest";

import { __test, importSelected } from "../../src/import/zotero";
import type { VerifyRow } from "../../src/types";

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
    resolved: { title: "Resolved", identifiers: [{ type: "doi", value: "10.1000/x" }] },
    provenance: { requestId: "req-1", transformVersion: "t1", verifyVersion: "v1", caveats: [] },
    ...over,
  };
}

describe("import/zotero — buildVerificationNote", () => {
  it("includes verdict, confidence, and provenance ids", () => {
    const html = __test.buildVerificationNote(row());
    expect(html).toContain("matched");
    expect(html).toContain("confidence: high");
    expect(html).toContain("req-1");
    expect(html).toContain("t1");
    expect(html).toContain("v1");
  });

  it("renders claimed-vs-resolved mismatch list", () => {
    const html = __test.buildVerificationNote(
      row({
        verdict: "mismatch",
        mismatches: [
          { field: "title", claimed: "wrong", resolved: "right", similarity: 0.1 },
          { field: "first_author", claimed: "Smith", resolved: "Polack", similarity: 0.0 },
        ],
      }),
    );
    expect(html).toContain("title");
    expect(html).toContain("wrong");
    expect(html).toContain("first_author");
    expect(html).toContain("Polack");
  });

  it("renders retraction notice when isRetracted=true", () => {
    const html = __test.buildVerificationNote(
      row({
        retraction: {
          isRetracted: true,
          hasCorrections: false,
          hasConcern: false,
          notices: [
            { type: "retraction", label: "Retracted 2010", date: "2010-02-02", source: "rw" },
          ],
        },
      }),
    );
    expect(html).toContain("retracted");
    expect(html).toContain("Retracted 2010");
  });

  it("renders OA link when isOa=true", () => {
    const html = __test.buildVerificationNote(
      row({
        openAccess: {
          isOa: true,
          oaStatus: "gold",
          bestUrl: "https://example.org/pdf",
          license: "cc-by",
          version: "publishedVersion",
        },
      }),
    );
    expect(html).toContain("https://example.org/pdf");
    expect(html).toContain("cc-by");
    expect(html).toContain("gold");
  });
});

describe("import/zotero — applyResolvedFields (slim shape)", () => {
  it("maps slim BiblioItem fields into first-class Zotero fields", () => {
    const setField = vi.fn();
    const setCreators = vi.fn();
    const item = { setField, setCreators };
    __test.applyResolvedFields(item as never, {
      title: "Resolved",
      container: { title: "New England Journal of Medicine", volume: "383" },
      issued: { year: 2020 },
      pages: { first: "2603", last: "2615" },
      identifiers: [{ type: "doi", value: "10.1000/x" }],
      authors: [{ family: "Polack", given: "Fernando" }],
    });
    expect(setField).toHaveBeenCalledWith("title", "Resolved");
    expect(setField).toHaveBeenCalledWith("publicationTitle", "New England Journal of Medicine");
    expect(setField).toHaveBeenCalledWith("volume", "383");
    expect(setField).toHaveBeenCalledWith("date", "2020");
    expect(setField).toHaveBeenCalledWith("pages", "2603-2615");
    expect(setField).toHaveBeenCalledWith("DOI", "10.1000/x");
    expect(setCreators).toHaveBeenCalledWith([
      { creatorType: "author", lastName: "Polack", firstName: "Fernando", name: undefined },
    ]);
  });

  it("maps ISBN/ISSN from the identifiers array", () => {
    const setField = vi.fn();
    const item = { setField, setCreators: vi.fn() };
    __test.applyResolvedFields(item as never, {
      identifiers: [
        { type: "isbn", value: "9780000000000" },
        { type: "issn", value: "1234-5678" },
      ],
    });
    expect(setField).toHaveBeenCalledWith("ISBN", "9780000000000");
    expect(setField).toHaveBeenCalledWith("ISSN", "1234-5678");
  });

  it("skips empty/missing fields silently", () => {
    const setField = vi.fn();
    const setCreators = vi.fn();
    const item = { setField, setCreators };
    __test.applyResolvedFields(item as never, {});
    expect(setField).not.toHaveBeenCalled();
    expect(setCreators).not.toHaveBeenCalled();
  });
});

describe("import/zotero — importSelected", () => {
  // Track created items so assertions can inspect addToCollection / addTag.
  let created: Array<Record<string, unknown> & { calls: Record<string, unknown[][]> }>;
  let setColor: ReturnType<typeof vi.fn>;
  let getColor: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    created = [];
    setColor = vi.fn().mockResolvedValue(undefined);
    getColor = vi.fn().mockReturnValue(false);

    function ItemCtor(this: Record<string, unknown>, itemType: string) {
      const calls: Record<string, unknown[][]> = {
        setField: [],
        setCreators: [],
        addTag: [],
        addToCollection: [],
        setNote: [],
      };
      const self = {
        itemType,
        calls,
        setField: (...a: unknown[]) => calls.setField.push(a),
        setCreators: (...a: unknown[]) => calls.setCreators.push(a),
        addTag: (...a: unknown[]) => calls.addTag.push(a),
        addToCollection: (...a: unknown[]) => calls.addToCollection.push(a),
        setNote: (...a: unknown[]) => calls.setNote.push(a),
        parentItemID: null,
        save: vi.fn().mockResolvedValue(created.length + 1),
      };
      created.push(self);
      return self;
    }

    (globalThis as { Zotero: unknown }).Zotero = {
      debug: vi.fn(),
      Item: ItemCtor,
      DB: { executeTransaction: async (fn: () => Promise<unknown>) => fn() },
      Libraries: { userLibraryID: 1 },
      Tags: { getColor, getColors: () => new Map(), setColor },
    };
  });

  it("adds items to the chosen collection", async () => {
    await importSelected([row({ verdict: "resolved" })], { collectionId: 42 });
    const article = created[0];
    expect(article.calls.addToCollection).toEqual([[42]]);
  });

  it("leaves items unfiled when collectionId is null", async () => {
    await importSelected([row({ verdict: "resolved" })], { collectionId: null });
    expect(created[0].calls.addToCollection).toEqual([]);
  });

  it("tags retracted items and colors the tag red (once)", async () => {
    await importSelected(
      [
        row({
          verdict: "matched",
          retraction: { isRetracted: true, hasCorrections: false, hasConcern: false, notices: [] },
        }),
      ],
      {},
    );
    expect(created[0].calls.addTag).toEqual([["retracted"]]);
    expect(setColor).toHaveBeenCalledWith(1, "retracted", "#CC2936", 0);
  });

  it("does not recolor the tag if the user already colored it", async () => {
    getColor.mockReturnValue({ color: "#000000", position: 3 });
    await importSelected(
      [
        row({
          retraction: { isRetracted: true, hasCorrections: false, hasConcern: false, notices: [] },
        }),
      ],
      {},
    );
    expect(setColor).not.toHaveBeenCalled();
  });

  it("skips rows with no resolved metadata and no rawCsl", async () => {
    const r = row({ verdict: "not_found" });
    r.resolved = undefined;
    r.candidate.rawCsl = undefined;
    const result = await importSelected([r], {});
    expect(result.importedIds).toEqual([]);
    expect(result.skipped).toHaveLength(1);
  });
});

describe("import/zotero — applyRawCslFields (translator fallback)", () => {
  it("maps Zotero-translator shape for unresolved rows the user opts to import", () => {
    const setField = vi.fn();
    const setCreators = vi.fn();
    const item = { setField, setCreators };
    __test.applyRawCslFields(item as never, {
      title: "Claimed",
      publicationTitle: "Imaginary Journal",
      DOI: "10.1000/x",
      creators: [{ creatorType: "author", firstName: "John", lastName: "Smith" }],
    });
    expect(setField).toHaveBeenCalledWith("title", "Claimed");
    expect(setField).toHaveBeenCalledWith("publicationTitle", "Imaginary Journal");
    expect(setField).toHaveBeenCalledWith("DOI", "10.1000/x");
    expect(setCreators).toHaveBeenCalledWith([
      { creatorType: "author", lastName: "Smith", firstName: "John", name: undefined },
    ]);
  });
});
