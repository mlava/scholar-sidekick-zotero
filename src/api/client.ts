// zotero-plugin/src/api/client.ts
//
// HTTP client for the Scholar Sidekick API, modelled on
// obsidian-plugin/src/lib/api.ts. Differences:
//   1. Transport is Zotero.HTTP.request (chrome-privileged, CORS-free).
//   2. Anonymous-first auth — the X-Scholar-API-Key header is only sent
//      when the user has set extensions.scholar-sidekick.apiKey.
//   3. Surface includes /api/detect (raw-text identifier extraction),
//      which the Obsidian plugin mirrors client-side instead.
//
// Endpoints used by the import-boundary verifier flow:
//   POST /api/detect             — extract identifiers from free text
//   POST /api/verify             — per-claim verdict
//   POST /api/retraction-check   — Crossref + Retraction Watch
//   POST /api/oa-check           — Unpaywall

import { getPref } from "../prefs";
import type {
  ApiResult,
  DetectPayload,
  LookupPayload,
  OaPayload,
  RetractionPayload,
  VerifyClaim,
  VerifyPayload,
} from "./types";

declare const Zotero: {
  HTTP: {
    request: (
      method: string,
      url: string,
      options: {
        headers?: Record<string, string>;
        body?: string;
        responseType?: "text" | "json" | "document";
        timeout?: number;
        successCodes?: number[] | false;
      },
    ) => Promise<{
      status: number;
      response: string;
      responseText?: string;
      getResponseHeader?: (name: string) => string | null;
    }>;
  };
};

const PLUGIN_VERSION = (process.env.PLUGIN_VERSION as string | undefined) ?? "0.0.0-dev";
export const CLIENT_TAG = `scholar-sidekick-zotero/${PLUGIN_VERSION}`;

const DEFAULT_TIMEOUT_MS = 15_000;
const VERIFY_TIMEOUT_MS = 30_000;
const MAX_INPUT_BYTES = 64_000;

interface RawRequest {
  method: "GET" | "POST";
  path: string;
  body?: unknown;
  timeoutMs?: number;
}

interface RawResponse<T> {
  status: number;
  data: T | null;
  retryAfterSec?: number;
  /** True when the request threw on timeout (status 0). */
  timedOut?: boolean;
  headers: {
    requestId: string | null;
    transformVersion: string | null;
    verifyVersion: string | null;
  };
}

function authHeader(): Record<string, string> {
  const key = getPref("apiKey").trim();
  return key ? { "X-Scholar-API-Key": key } : {};
}

function trimToBytes(text: string): string {
  return text.length > MAX_INPUT_BYTES ? text.slice(0, MAX_INPUT_BYTES) : text;
}

function parseRetryAfter(headerVal: string | null): number {
  const n = Number(headerVal ?? "30");
  return Number.isFinite(n) && n > 0 ? n : 30;
}

const NO_HEADERS = { requestId: null, transformVersion: null, verifyVersion: null };

async function rawRequest<T>(req: RawRequest): Promise<RawResponse<T>> {
  const base = getPref("baseUrl").replace(/\/+$/, "");
  const url = `${base}${req.path}`;
  const headers: Record<string, string> = {
    "X-Scholar-Client": CLIENT_TAG,
    ...authHeader(),
  };
  if (req.body !== undefined) headers["Content-Type"] = "application/json";

  // Zotero.HTTP.request THROWS on timeout / network failure / connection
  // refused (it doesn't resolve with a status). Catch it and return a
  // synthetic status-0 response so a single failed request degrades to a
  // per-row error instead of aborting the whole batch.
  let res;
  try {
    res = await Zotero.HTTP.request(req.method, url, {
      headers,
      body: req.body !== undefined ? JSON.stringify(req.body) : undefined,
      responseType: "text",
      timeout: req.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      successCodes: false,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const timedOut = /timed out|timeout/i.test(msg);
    return { status: 0, data: null, timedOut, headers: NO_HEADERS };
  }

  const text = res.response ?? res.responseText ?? "";
  let data: T | null = null;
  if (text) {
    try {
      data = JSON.parse(text) as T;
    } catch {
      data = null;
    }
  }

  const getHeader = (name: string): string | null => {
    if (typeof res.getResponseHeader === "function") {
      return res.getResponseHeader(name);
    }
    return null;
  };

  return {
    status: res.status,
    data,
    retryAfterSec: res.status === 429 ? parseRetryAfter(getHeader("Retry-After")) : undefined,
    headers: {
      requestId: getHeader("x-request-id"),
      transformVersion: getHeader("x-scholar-transform-version"),
      verifyVersion: getHeader("x-scholar-verify-version"),
    },
  };
}

function errorMessage(status: number, data: unknown, timedOut?: boolean): string {
  if (status === 0) {
    return timedOut
      ? "Timed out reaching scholar-sidekick.com — try again, or this identifier's source may be slow."
      : "Couldn't reach scholar-sidekick.com — check your connection.";
  }
  if (status === 404) return "We couldn't find a record for that identifier.";
  if (status === 401 || status === 403) {
    return "The Scholar Sidekick API rejected the request. Check your API key.";
  }
  if (status >= 500) return `Scholar Sidekick is having trouble (HTTP ${status}).`;
  if (data && typeof data === "object") {
    const err = (data as { error?: { message?: string } | string; message?: string }).error;
    if (typeof err === "string") return err;
    if (err && typeof err === "object" && err.message) return err.message;
    const msg = (data as { message?: string }).message;
    if (msg) return msg;
  }
  return `Request failed (HTTP ${status}).`;
}

function toOk<T>(payload: T, headers: RawResponse<T>["headers"]): ApiResult<T> {
  const augmented = {
    ...(payload as object),
    requestId: headers.requestId,
    transformVersion: headers.transformVersion,
    verifyVersion: headers.verifyVersion,
  } as T;
  return { ok: true, data: augmented };
}

function toErr<T>(res: RawResponse<unknown>): ApiResult<T> {
  return {
    ok: false,
    status: res.status,
    message: errorMessage(res.status, res.data, res.timedOut),
    retryAfterSec: res.retryAfterSec,
  };
}

/** Resolve identifiers from raw text. Used when paste input is unstructured. */
export async function detectIdentifiers(text: string): Promise<ApiResult<DetectPayload>> {
  const trimmed = trimToBytes(text);
  const res = await rawRequest<DetectPayload>({
    method: "POST",
    path: "/api/detect",
    body: { text: trimmed },
  });
  if (res.status < 200 || res.status >= 300 || !res.data) return toErr(res);
  return toOk(res.data, res.headers);
}

/** Verify a single claimed citation against authoritative metadata. */
export async function verifyCitation(claimed: VerifyClaim): Promise<ApiResult<VerifyPayload>> {
  const res = await rawRequest<VerifyPayload>({
    method: "POST",
    path: "/api/verify",
    body: { claimed },
    timeoutMs: VERIFY_TIMEOUT_MS,
  });
  if (res.status < 200 || res.status >= 300 || !res.data) return toErr(res);
  return toOk(res.data, res.headers);
}

/**
 * Resolve an identifier to metadata. Used for the no-claim path: a bare
 * identifier (or prose where only the identifier could be extracted) has
 * nothing to verify against, so we resolve it instead. Returns
 * result: null with reason "not_found" when the identifier doesn't resolve.
 */
export async function lookupIdentifier(id: string): Promise<ApiResult<LookupPayload>> {
  const trimmed = trimToBytes(id).slice(0, 500);
  const res = await rawRequest<LookupPayload>({
    method: "POST",
    path: "/api/lookup",
    body: { id: trimmed },
  });
  if (res.status < 200 || res.status >= 300 || !res.data) return toErr(res);
  return toOk(res.data, res.headers);
}

/** Check whether an identifier has been retracted, corrected, or flagged. */
export async function checkRetraction(id: string): Promise<ApiResult<RetractionPayload>> {
  const trimmed = trimToBytes(id).slice(0, 500);
  const res = await rawRequest<RetractionPayload>({
    method: "POST",
    path: "/api/retraction-check",
    body: { id: trimmed },
  });
  if (res.status < 200 || res.status >= 300 || !res.data) return toErr(res);
  return toOk(res.data, res.headers);
}

/** Check whether an identifier is openly accessible (Unpaywall). */
export async function checkOpenAccess(id: string): Promise<ApiResult<OaPayload>> {
  const trimmed = trimToBytes(id).slice(0, 500);
  const res = await rawRequest<OaPayload>({
    method: "POST",
    path: "/api/oa-check",
    body: { id: trimmed },
  });
  if (res.status < 200 || res.status >= 300 || !res.data) return toErr(res);
  return toOk(res.data, res.headers);
}
