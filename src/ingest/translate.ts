// zotero-plugin/src/ingest/translate.ts
//
// Parses a pasted bibliographic block or imported .bib/.ris into in-memory
// BiblioCandidate rows using Zotero's existing translator infrastructure.
//
// Key flag: translate({ libraryID: false }) returns parsed items WITHOUT
// committing them to the library. That's what makes the import-boundary
// verifier non-destructive — we look at the metadata and only call into
// src/import/zotero.ts once the user picks the rows to keep.
//
// Fallback path: when Zotero's translators return nothing (e.g. a raw
// manuscript reference list with no .bib structure), the orchestrator
// calls /api/detect to extract identifiers server-side. See
// src/api/client.ts -> detectIdentifiers().

import { detectIdentifiers } from "../api/client";
import type { BiblioCandidate } from "../types";

declare const Zotero: {
  Translate: {
    Import: new () => ZoteroTranslateImport;
  };
  debug: (msg: string) => void;
};

interface ZoteroTranslateImport {
  setString(text: string): void;
  setLocation(file: unknown): void;
  getTranslators(): Promise<unknown[]>;
  setTranslator(translator: unknown): void;
  translate(opts: { libraryID: false | number }): Promise<ZoteroCslItem[]>;
}

interface ZoteroCslItem {
  itemType?: string;
  title?: string;
  shortTitle?: string;
  date?: string;
  publicationTitle?: string;
  journalAbbreviation?: string;
  bookTitle?: string;
  creators?: Array<{ creatorType?: string; firstName?: string; lastName?: string; name?: string }>;
  DOI?: string;
  ISBN?: string;
  ISSN?: string;
  extra?: string;
  url?: string;
  [k: string]: unknown;
}

const ID_TYPES: BiblioCandidate["identifier"] extends infer T
  ? T extends { type: infer U }
    ? U
    : never
  : never = "doi" as never;
void ID_TYPES; // silence unused — kept for future per-type narrowing

let rowSeq = 0;
function nextRowId(): string {
  rowSeq += 1;
  return `row-${rowSeq}`;
}

function pickYear(date: string | undefined): number | undefined {
  if (!date) return undefined;
  const m = /\b(1[5-9]\d{2}|20\d{2}|21\d{2})\b/.exec(date);
  return m ? Number(m[1]) : undefined;
}

function pickContainer(item: ZoteroCslItem): string | undefined {
  return item.publicationTitle ?? item.bookTitle ?? item.journalAbbreviation ?? undefined;
}

function pickAuthors(item: ZoteroCslItem): BiblioCandidate["claimed"]["authors"] {
  if (!Array.isArray(item.creators)) return undefined;
  const authors = item.creators
    .filter((c) => !c.creatorType || c.creatorType === "author")
    .map((c) => {
      if (c.lastName) return { family: c.lastName, given: c.firstName };
      if (c.name) return { family: c.name };
      return null;
    })
    .filter((a): a is { family: string; given?: string } => a !== null);
  return authors.length ? authors : undefined;
}

function extractIdentifier(item: ZoteroCslItem): BiblioCandidate["identifier"] | undefined {
  if (item.DOI) return { type: "doi", value: String(item.DOI).trim() };
  if (item.ISBN) return { type: "isbn", value: String(item.ISBN).replace(/[^0-9X]/gi, "") };
  if (item.ISSN) return { type: "issn", value: String(item.ISSN).trim() };
  const extra = typeof item.extra === "string" ? item.extra : "";
  const pmid = /PMID:\s*(\d+)/i.exec(extra);
  if (pmid) return { type: "pmid", value: pmid[1] };
  const pmcid = /PMCID:\s*(PMC\d+)/i.exec(extra);
  if (pmcid) return { type: "pmcid", value: pmcid[1] };
  const arxiv = /ar[Xx]iv:\s*([\w./-]+)/.exec(extra);
  if (arxiv) return { type: "arxiv", value: arxiv[1] };
  if (typeof item.url === "string") {
    const doiUrl = /doi\.org\/(10\.[^\s]+)/i.exec(item.url);
    if (doiUrl) return { type: "doi", value: doiUrl[1] };
  }
  return undefined;
}

function cslItemToCandidate(item: ZoteroCslItem): BiblioCandidate {
  return {
    rowId: nextRowId(),
    itemType: item.itemType ?? "journalArticle",
    claimed: {
      title: item.title?.trim(),
      authors: pickAuthors(item),
      year: pickYear(item.date),
      container: pickContainer(item),
    },
    identifier: extractIdentifier(item),
    rawCsl: { ...item },
  };
}

/**
 * Run Zotero's translator pipeline against the given raw text. Returns
 * an empty array if no translator matches (caller should fall back to
 * detectIdentifiers).
 */
export async function translateString(raw: string): Promise<BiblioCandidate[]> {
  const trimmed = raw.trim();
  if (!trimmed) return [];
  const translator = new Zotero.Translate.Import();
  translator.setString(trimmed);
  const matches = await translator.getTranslators();
  if (!matches.length) return [];
  translator.setTranslator(matches[0]);
  try {
    const items = await translator.translate({ libraryID: false });
    return items.map(cslItemToCandidate);
  } catch (err) {
    Zotero.debug(`[scholar-sidekick] translateString failed: ${String(err)}`);
    return [];
  }
}

/**
 * Fallback: ask the server to extract identifiers from raw text and
 * return one bare-bones candidate per identifier (no claimed metadata).
 * Used when paste input has no .bib/.ris structure for Zotero to parse.
 */
export async function detectFromText(text: string): Promise<BiblioCandidate[]> {
  const res = await detectIdentifiers(text);
  if (!res.ok) return [];
  return res.data.identifiers.map((id) => ({
    rowId: nextRowId(),
    itemType: "journalArticle",
    claimed: {},
    identifier: id,
  }));
}

/**
 * Top-level ingest entry. Tries Zotero's translators first; falls back to
 * /api/detect if the translator pipeline yielded nothing.
 */
export async function ingest(raw: string): Promise<BiblioCandidate[]> {
  const translated = await translateString(raw);
  if (translated.length) return translated;
  return detectFromText(raw);
}
