# Build and development

## Prerequisites

- Node.js >= 20.19.0 (matches the main repo).
- npm (the Scholar Sidekick repo does not use pnpm or yarn).
- Zotero 7 installed locally for end-to-end smoke testing.

## Install

```bash
cd zotero-plugin
npm install
```

## Common scripts

```bash
npm run dev             # esbuild watch — rebuilds addon/chrome/content/main.js on save
npm run build           # typecheck + production bundle + package xpi
npm run check           # tsc --noEmit
npm run typecheck       # alias for check
npm test                # vitest watch
npm run test:run        # vitest run (single pass)
npm run test:coverage   # vitest run with coverage thresholds
```

## Loading the dev build into Zotero

1. `npm run dev` — esbuild bundles `src/index.ts` into `addon/chrome/content/main.js` and re-bundles on save.
2. In Zotero: `Tools → Plugins → Install Plugin From File…` and select `addon/` packaged as a `.xpi`, or use the proxy-file approach below.

### Proxy file (recommended for dev — no repackaging)

Create a file at `<Zotero profile>/extensions/scholar-sidekick@scholar-sidekick.com` containing the **absolute path to `addon/`** in this repo. Restart Zotero. Subsequent code changes only require a Zotero restart (or a `Tools → Plugins → Reload`) — no re-install.

## Layout

```
zotero-plugin/
├── addon/
│   ├── manifest.json           # Zotero 7 manifest (applications.zotero block)
│   ├── bootstrap.js            # lifecycle hooks (startup/shutdown/install/uninstall)
│   └── chrome/content/
│       └── main.js             # esbuild output — DO NOT EDIT
├── src/
│   ├── index.ts                # plugin entry (registered as globalThis.ScholarSidekick)
│   ├── prefs.ts                # Zotero.Prefs wrapper (apiKey, baseUrl)
│   ├── types.ts                # plugin-internal types (BiblioCandidate, VerifyRow)
│   ├── api/
│   │   ├── client.ts           # HTTP client over Zotero.HTTP.request
│   │   └── types.ts            # wire types (mirrors obsidian-plugin/src/lib/api.ts)
│   ├── ingest/
│   │   └── translate.ts        # Zotero.Translate.Import wrapper + /api/detect fallback
│   ├── verify/
│   │   └── orchestrator.ts     # per-row verify + retraction + OA fan-out
│   ├── ui/
│   │   ├── menu.ts             # Tools-menu registration
│   │   ├── dialog.ts           # modal flow controller
│   │   └── preview.ts          # pure rendering helpers
│   └── import/
│       └── zotero.ts           # Zotero.Item creation + verification notes
├── test/
│   ├── setup.ts                # Vitest global mocks for Zotero / Services
│   ├── fixtures/               # .bib / .txt fixtures for smoke testing
│   ├── api/                    # client.test.ts
│   ├── ingest/                 # translate.test.ts
│   ├── verify/                 # orchestrator.test.ts
│   ├── ui/                     # preview.test.ts
│   └── import/                 # zotero.test.ts
├── scripts/
│   └── package-xpi.mjs         # `zip -r` the addon/ tree into a .xpi
├── esbuild.config.mjs
├── vitest.config.mts
├── tsconfig.json
├── package.json
├── update.json                 # auto-update manifest (hosted on scholar-sidekick.com)
├── README.md
└── BUILD.md (this file)
```

## Distribution

Zotero 7 does not (yet) have an official plugin directory. The release flow is:

1. `npm run build` — produces `scholar-sidekick-<version>.xpi` at the repo root.
2. Upload the `.xpi` to a GitHub release on the Scholar Sidekick repo.
3. Bump `update.json` to point at the new `update_link` and host the updated manifest at `https://scholar-sidekick.com/zotero-plugin/update.json` (referenced from `addon/manifest.json`). Installed copies auto-update on Zotero restart.
4. Post an announcement on the [Zotero forums](https://forums.zotero.org/) under Community Plugins.

## Manual smoke fixtures

Under `test/fixtures/`:

- `verified.bib` — three known-good DOIs → all rows verified.
- `topaz.bib` — real DOI + fabricated title/authors → `mismatch` with title + first_author diffs.
- `retracted.bib` — Wakefield Lancet 1998 → retraction banner, `retracted` tag on import.
- `oa.bib` — PLOS ONE article → OA link rendered.
- `mixed.txt` — pasted manuscript reference list with no `.bib` structure → exercises the `/api/detect` fallback.
- `no-id.bib` — entries lacking any identifier → "No identifier — cannot verify".

## Conventions

- Match the obsidian-plugin's style: `X-Scholar-Client` handshake on every request, semantic test assertions, hoist-safe Vitest mocks.
- Update `src/api/types.ts` and `obsidian-plugin/src/lib/api.ts` together when the server contract changes.
- All DOM mutation gets a `data-scholar-sidekick="1"` attribute so teardown can clean every artifact.
