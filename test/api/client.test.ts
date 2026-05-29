// test/api/client.test.ts
//
// Asserts the API client against a mocked Zotero.HTTP.request: request
// shape, X-Scholar-Client handshake, conditional auth header, error
// normalization, header surfacing. Mirrors the obsidian-plugin test
// style — semantic assertions only, no brittle snapshots.

import { afterEach, describe, expect, it, vi } from "vitest";

const zoteroHttp = vi.hoisted(() => ({ request: vi.fn() }));
const zoteroPrefs = vi.hoisted(() => ({
  get: vi.fn(),
  set: vi.fn(),
  clear: vi.fn(),
}));

beforeAll();

function beforeAll(): void {
  (globalThis as { Zotero: unknown }).Zotero = {
    debug: vi.fn(),
    HTTP: zoteroHttp,
    Prefs: zoteroPrefs,
  };
}

function mockOk(body: unknown, headers: Record<string, string> = {}): void {
  zoteroHttp.request.mockResolvedValueOnce({
    status: 200,
    response: JSON.stringify(body),
    getResponseHeader: (name: string) => headers[name.toLowerCase()] ?? null,
  });
}

afterEach(() => {
  zoteroHttp.request.mockReset();
  zoteroPrefs.get.mockReset();
});

describe("api/client", () => {
  it("sends X-Scholar-Client handshake on every call", async () => {
    zoteroPrefs.get.mockImplementation((name: string) => {
      if (name.endsWith(".baseUrl")) return "https://scholar-sidekick.com";
      return "";
    });
    mockOk({ ok: true, identifiers: [] });

    const { detectIdentifiers } = await import("../../src/api/client");
    await detectIdentifiers("any text");

    expect(zoteroHttp.request).toHaveBeenCalledTimes(1);
    const [, , opts] = zoteroHttp.request.mock.calls[0];
    expect(opts.headers["X-Scholar-Client"]).toMatch(/^scholar-sidekick-zotero\//);
    expect(opts.headers["X-Scholar-API-Key"]).toBeUndefined();
  });

  it("omits auth header when the apiKey pref is empty", async () => {
    zoteroPrefs.get.mockImplementation((name: string) =>
      name.endsWith(".baseUrl") ? "https://scholar-sidekick.com" : "",
    );
    mockOk({ ok: true, identifiers: [] });

    const { detectIdentifiers } = await import("../../src/api/client");
    await detectIdentifiers("x");
    const [, , opts] = zoteroHttp.request.mock.calls[0];
    expect(opts.headers).not.toHaveProperty("X-Scholar-API-Key");
  });

  it("attaches X-Scholar-API-Key when the apiKey pref is set", async () => {
    zoteroPrefs.get.mockImplementation((name: string) => {
      if (name.endsWith(".apiKey")) return "secret-123";
      if (name.endsWith(".baseUrl")) return "https://scholar-sidekick.com";
      return "";
    });
    mockOk({ ok: true, identifiers: [] });

    const { detectIdentifiers } = await import("../../src/api/client");
    await detectIdentifiers("x");
    const [, , opts] = zoteroHttp.request.mock.calls[0];
    expect(opts.headers["X-Scholar-API-Key"]).toBe("secret-123");
  });

  it("normalises 4xx errors with a human-readable message", async () => {
    zoteroPrefs.get.mockImplementation((name: string) =>
      name.endsWith(".baseUrl") ? "https://scholar-sidekick.com" : "",
    );
    zoteroHttp.request.mockResolvedValueOnce({
      status: 404,
      response: JSON.stringify({ error: { message: "not found" } }),
      getResponseHeader: () => null,
    });
    const { checkRetraction } = await import("../../src/api/client");
    const res = await checkRetraction("10.1000/x");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.message).toMatch(/couldn't find/i);
  });

  it("surfaces 429 retry-after seconds", async () => {
    zoteroPrefs.get.mockImplementation((name: string) =>
      name.endsWith(".baseUrl") ? "https://scholar-sidekick.com" : "",
    );
    zoteroHttp.request.mockResolvedValueOnce({
      status: 429,
      response: "",
      getResponseHeader: (name: string) => (name.toLowerCase() === "retry-after" ? "42" : null),
    });
    const { checkOpenAccess } = await import("../../src/api/client");
    const res = await checkOpenAccess("10.1000/x");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.retryAfterSec).toBe(42);
  });

  it("converts a thrown timeout into a status-0 error (does not propagate)", async () => {
    zoteroPrefs.get.mockImplementation((name: string) =>
      name.endsWith(".baseUrl") ? "https://scholar-sidekick.com" : "",
    );
    zoteroHttp.request.mockRejectedValueOnce(new Error("Request timed out after 15000 ms"));
    const { lookupIdentifier } = await import("../../src/api/client");
    // Must resolve (not reject) so the orchestrator's per-row error path works.
    const res = await lookupIdentifier("10.1000/x");
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.status).toBe(0);
      expect(res.message).toMatch(/timed out/i);
    }
  });

  it("converts a thrown network error into a status-0 connection error", async () => {
    zoteroPrefs.get.mockImplementation((name: string) =>
      name.endsWith(".baseUrl") ? "https://scholar-sidekick.com" : "",
    );
    zoteroHttp.request.mockRejectedValueOnce(new Error("NS_ERROR_CONNECTION_REFUSED"));
    const { detectIdentifiers } = await import("../../src/api/client");
    const res = await detectIdentifiers("x");
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.status).toBe(0);
      expect(res.message).toMatch(/check your connection/i);
    }
  });
});
