# Scholar Sidekick — Zotero plugin

> Verify a bibliography before importing it.

Most Zotero users already trust the items their library has — they were added via Zotero's own identifier lookup, so the metadata is authoritative. The risky moment isn't the existing library; it's the **import boundary**: a `.bib`/`.ris` file from a collaborator, a manuscript reference list pasted from a draft, or an AI-generated bibliography dumped into a colleague's notes. Those items carry **claimed** metadata that may not match what the identifier actually resolves to.

Scholar Sidekick's Zotero plugin steps in before that bad data becomes a trusted library item.

## What it does

Tools → **Verify & import bibliography…** opens a modal where you can paste a bibliography or pick a `.bib`/`.ris` file. The plugin:

1. Parses entries with Zotero's existing translator (no committing to the library yet).
2. For each entry, calls the Scholar Sidekick API to **verify** the claimed citation against authoritative metadata.
3. Cross-checks every resolvable identifier for **retraction** (Crossref + Retraction Watch) and **open-access** status (Unpaywall).
4. Shows you a preview table with one verdict per row:
   - **Verified** — claimed metadata matches the resolved record.
   - **Mismatch** — title, first author, year, or container differ from the resolved record. The Topaz et al. (Lancet, 2026) fabrication pattern lands here.
   - **Not found** — the identifier didn't resolve.
   - **Ambiguous** — multiple candidates; review before importing.
   - **No identifier** — nothing to verify.
5. You tick the rows you want. The plugin imports the **resolved** (canonical) metadata into the collection you choose, and attaches a child note recording what was claimed, what verified, and the request/version ids.
6. Retracted items are auto-tagged `retracted`.

## Why it's a separate plugin

Zotero already does identifier→metadata, CSL formatting, exports, and even Retraction Watch warnings natively. This plugin doesn't duplicate any of that — it lives in the narrow gap where items enter Zotero via paths other than identifier lookup, and the user has no signal whether the claimed metadata matches what the identifier resolves to.

## Anonymous-first auth

The plugin works with no setup, hitting the Scholar Sidekick anonymous tier (rate-limited per IP). If you need higher limits, paste a first-party API key or RapidAPI key into `Edit → Preferences → Scholar Sidekick → API key`.

## Status

v0.1 scaffold. The verifier and check pipelines are wired; the dialog XUL host is still in progress (see `src/ui/dialog.ts`). Tests in `test/` exercise the API client, ingest, orchestrator, preview, and import layers under mocked Zotero globals.

## Development

See [BUILD.md](./BUILD.md).
