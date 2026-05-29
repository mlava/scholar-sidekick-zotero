// test/setup.ts
//
// Shared Vitest setup. The Zotero plugin runs in a chrome-privileged
// Firefox sandbox in production; under Vitest we provide minimal mocks
// for the globals each test touches. Individual test files extend these
// with vi.mock() factories — keep this file lean.
//
// zotero-types provides ambient `Zotero`/`Services` globals for source
// files; here we assign partial mocks through `any` so we don't have to
// satisfy the full ambient interface in test scaffolding.

import { vi } from "vitest";

const g = globalThis as unknown as Record<string, unknown>;

g.Zotero = {
  debug: vi.fn(),
  Prefs: {
    get: vi.fn().mockReturnValue(""),
    set: vi.fn(),
    clear: vi.fn(),
  },
  HTTP: {
    request: vi.fn(),
  },
  Translate: {
    Import: vi.fn(),
  },
  Item: vi.fn(),
  Items: { getAsync: vi.fn() },
  DB: {
    executeTransaction: vi.fn(async (fn: () => Promise<unknown>) => fn()),
  },
  Libraries: { userLibraryID: 1 },
  Collections: { getByLibrary: vi.fn().mockReturnValue([]) },
  Tags: {
    getColor: vi.fn().mockReturnValue(false),
    getColors: vi.fn().mockReturnValue(new Map()),
    setColor: vi.fn().mockResolvedValue(undefined),
  },
};

g.Services = {
  wm: {
    getEnumerator: vi.fn().mockReturnValue({ hasMoreElements: () => false, getNext: () => null }),
    addListener: vi.fn(),
    removeListener: vi.fn(),
  },
  scriptloader: {
    loadSubScript: vi.fn(),
  },
};
