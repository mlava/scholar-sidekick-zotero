// test/ingest/translate.test.ts
//
// Asserts the ingest layer: Zotero.Translate.Import wrapper produces the
// expected BiblioCandidate shape from a canned translator output, and
// falls back to /api/detect when no translator matches.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const apiMocks = vi.hoisted(() => ({
  verifyCitation: vi.fn(),
  lookupIdentifier: vi.fn(),
  checkRetraction: vi.fn(),
  checkOpenAccess: vi.fn(),
  detectIdentifiers: vi.fn(),
}));

vi.mock("../../src/api/client", () => apiMocks);

const translateMocks = vi.hoisted(() => {
  const setString = vi.fn();
  const setTranslator = vi.fn();
  const getTranslators = vi.fn();
  const translate = vi.fn();
  return { setString, setTranslator, getTranslators, translate };
});

// Re-establish the Translate.Import constructor mock before every test so
// the global test/setup.ts (which sets a bare Import stub) can't clobber it.
beforeEach(() => {
  // Must be a real (non-arrow) function — vitest 4 constructs the mock impl
  // via Reflect.construct, and arrow functions are not constructable.
  function ImportCtor(this: unknown) {
    return {
      setString: translateMocks.setString,
      setLocation: vi.fn(),
      getTranslators: translateMocks.getTranslators,
      setTranslator: translateMocks.setTranslator,
      translate: translateMocks.translate,
    };
  }
  (globalThis as { Zotero: unknown }).Zotero = {
    debug: vi.fn(),
    Translate: { Import: ImportCtor },
  };
});

afterEach(() => {
  translateMocks.setString.mockReset();
  translateMocks.setTranslator.mockReset();
  translateMocks.getTranslators.mockReset();
  translateMocks.translate.mockReset();
  apiMocks.detectIdentifiers.mockReset();
});

describe("ingest/translate", () => {
  it("converts translator output into BiblioCandidate rows", async () => {
    translateMocks.getTranslators.mockResolvedValue([{ id: "bibtex" }]);
    translateMocks.translate.mockResolvedValue([
      {
        itemType: "journalArticle",
        title: "Safety and Efficacy of the BNT162b2 mRNA Covid-19 Vaccine",
        date: "2020",
        publicationTitle: "New England Journal of Medicine",
        DOI: "10.1056/NEJMoa2034577",
        creators: [
          { creatorType: "author", firstName: "Fernando", lastName: "Polack" },
          { creatorType: "author", firstName: "Stephen", lastName: "Thomas" },
        ],
      },
    ]);

    const { translateString } = await import("../../src/ingest/translate");
    const rows = await translateString("@article{...}");
    expect(rows).toHaveLength(1);
    expect(rows[0].claimed.title).toMatch(/BNT162b2/);
    expect(rows[0].claimed.year).toBe(2020);
    expect(rows[0].claimed.container).toBe("New England Journal of Medicine");
    expect(rows[0].claimed.authors?.[0]).toEqual({ family: "Polack", given: "Fernando" });
    expect(rows[0].identifier).toEqual({ type: "doi", value: "10.1056/NEJMoa2034577" });
  });

  it("returns [] when no translator matches", async () => {
    translateMocks.getTranslators.mockResolvedValue([]);
    const { translateString } = await import("../../src/ingest/translate");
    const rows = await translateString("not a bib file");
    expect(rows).toEqual([]);
  });

  it("ingest() falls back to /api/detect when translation yields nothing", async () => {
    translateMocks.getTranslators.mockResolvedValue([]);
    apiMocks.detectIdentifiers.mockResolvedValue({
      ok: true,
      data: { identifiers: [{ type: "doi", value: "10.1056/NEJMoa2034577" }] },
    });
    const { ingest } = await import("../../src/ingest/translate");
    const rows = await ingest("see doi:10.1056/NEJMoa2034577 for details");
    expect(rows).toHaveLength(1);
    expect(rows[0].identifier).toEqual({ type: "doi", value: "10.1056/NEJMoa2034577" });
    expect(rows[0].claimed).toEqual({});
  });
});
