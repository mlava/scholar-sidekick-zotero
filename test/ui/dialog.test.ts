// test/ui/dialog.test.ts
//
// Asserts the dialog controller surface — the object the XHTML view
// calls into. The view itself isn't unit-tested here (it's a thin shell
// over these methods); end-to-end coverage of the modal lives in the
// manual smoke checklist in BUILD.md.

import { afterEach, describe, expect, it, vi } from "vitest";

const ingestMocks = vi.hoisted(() => ({ ingest: vi.fn() }));
const orchestrateMocks = vi.hoisted(() => ({ orchestrate: vi.fn() }));
const importMocks = vi.hoisted(() => ({ importSelected: vi.fn() }));
const previewMocks = vi.hoisted(() => ({ renderPreview: vi.fn() }));
const collectionsMocks = vi.hoisted(() => ({
  enumerateCollections: vi.fn(),
  pickBibliographyFile: vi.fn(),
}));
const prefsMocks = vi.hoisted(() => ({ getPref: vi.fn() }));

vi.mock("../../src/ingest/translate", () => ingestMocks);
vi.mock("../../src/verify/orchestrator", () => orchestrateMocks);
vi.mock("../../src/import/zotero", () => importMocks);
vi.mock("../../src/ui/preview", () => previewMocks);
vi.mock("../../src/ui/collections", () => collectionsMocks);
vi.mock("../../src/prefs", () => prefsMocks);

afterEach(() => {
  ingestMocks.ingest.mockReset();
  orchestrateMocks.orchestrate.mockReset();
  importMocks.importSelected.mockReset();
  previewMocks.renderPreview.mockReset();
  collectionsMocks.enumerateCollections.mockReset();
  collectionsMocks.pickBibliographyFile.mockReset();
  prefsMocks.getPref.mockReset();
});

describe("ui/dialog — buildController", () => {
  it("runVerify wires ingest → orchestrate → renderPreview", async () => {
    ingestMocks.ingest.mockResolvedValue([
      { rowId: "r1", itemType: "journalArticle", claimed: {} },
    ]);
    orchestrateMocks.orchestrate.mockResolvedValue([
      {
        candidate: { rowId: "r1", itemType: "journalArticle", claimed: {} },
        verdict: "matched",
        mismatches: [],
        provenance: { requestId: null, transformVersion: null, verifyVersion: null, caveats: [] },
      },
    ]);
    previewMocks.renderPreview.mockReturnValue([{ rowId: "r1" }]);

    const { buildController } = await import("../../src/ui/dialog");
    const controller = buildController({} as Window);
    const result = await controller.runVerify("some text");

    expect(ingestMocks.ingest).toHaveBeenCalledWith("some text");
    expect(orchestrateMocks.orchestrate).toHaveBeenCalledTimes(1);
    expect(previewMocks.renderPreview).toHaveBeenCalledTimes(1);
    expect(result.rows).toEqual([{ rowId: "r1" }]);
  });

  it("runVerify short-circuits when ingest produces nothing", async () => {
    ingestMocks.ingest.mockResolvedValue([]);

    const { buildController } = await import("../../src/ui/dialog");
    const controller = buildController({} as Window);
    const result = await controller.runVerify("garbage");

    expect(result.rows).toEqual([]);
    expect(orchestrateMocks.orchestrate).not.toHaveBeenCalled();
    expect(previewMocks.renderPreview).not.toHaveBeenCalled();
  });

  it("importSelected reuses the rows from the last verify call", async () => {
    const lastRow = {
      candidate: { rowId: "r1", itemType: "journalArticle", claimed: {} },
      verdict: "matched",
      mismatches: [],
      provenance: { requestId: null, transformVersion: null, verifyVersion: null, caveats: [] },
    };
    ingestMocks.ingest.mockResolvedValue([lastRow.candidate]);
    orchestrateMocks.orchestrate.mockResolvedValue([lastRow]);
    previewMocks.renderPreview.mockReturnValue([{ rowId: "r1" }]);
    importMocks.importSelected.mockResolvedValue({ importedIds: [99], skipped: [] });

    const { buildController } = await import("../../src/ui/dialog");
    const controller = buildController({} as Window);
    await controller.runVerify("x");
    const result = await controller.importSelected(["r1"], 17);

    expect(importMocks.importSelected).toHaveBeenCalledWith([lastRow], { collectionId: 17 });
    expect(result.importedIds).toEqual([99]);
  });

  it("importSelected filters to the selected rows only", async () => {
    const rows = [
      {
        candidate: { rowId: "r1", itemType: "journalArticle", claimed: {} },
        verdict: "matched",
        mismatches: [],
        provenance: { requestId: null, transformVersion: null, verifyVersion: null, caveats: [] },
      },
      {
        candidate: { rowId: "r2", itemType: "journalArticle", claimed: {} },
        verdict: "mismatch",
        mismatches: [],
        provenance: { requestId: null, transformVersion: null, verifyVersion: null, caveats: [] },
      },
    ];
    ingestMocks.ingest.mockResolvedValue(rows.map((r) => r.candidate));
    orchestrateMocks.orchestrate.mockResolvedValue(rows);
    previewMocks.renderPreview.mockReturnValue([{ rowId: "r1" }, { rowId: "r2" }]);
    importMocks.importSelected.mockResolvedValue({ importedIds: [1], skipped: [] });

    const { buildController } = await import("../../src/ui/dialog");
    const controller = buildController({} as Window);
    await controller.runVerify("x");
    await controller.importSelected(["r2"], null);

    const passedRows = importMocks.importSelected.mock.calls[0][0];
    expect(passedRows).toHaveLength(1);
    expect(passedRows[0].candidate.rowId).toBe("r2");
  });

  it("getApiKeyStatus reflects the prefs store", async () => {
    prefsMocks.getPref.mockReturnValueOnce("");
    prefsMocks.getPref.mockReturnValueOnce("secret-123");

    const { buildController } = await import("../../src/ui/dialog");
    const controller = buildController({} as Window);
    expect(controller.getApiKeyStatus()).toEqual({ hasKey: false });
    expect(controller.getApiKeyStatus()).toEqual({ hasKey: true });
  });
});
