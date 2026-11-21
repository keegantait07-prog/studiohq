# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Studio HQ: local-first, macOS-only (Apple Silicon) Electron + React + SQLite app for a music producer (beat vault, pitch CRM, sales, content, sound library, FL Studio project indexing). A separate JUCE audio plugin lives in `plugin/` (`cd plugin && ./build.sh`).

## Commands

- `npm install`: also runs `electron-rebuild` for `better-sqlite3`. If Electron fails with "Electron uninstall", run `node node_modules/electron/install.js` once.
- `npm run dev`: electron-vite with hot reload.
- `npm start`: build then run the production bundle.
- `npm run typecheck`: `tsc --noEmit -p tsconfig.json` (there is no `tsconfig.web.json`).
- `npm test`: `vitest run`. One file: `npx vitest run src/main/catalog.test.ts`. One test: add `-t "name"`.
- `npm run dist`: builds `release/mac-arm64/Studio HQ.app`. Then `./scripts/install-app.sh` copies it to `~/Applications` and ad-hoc signs it there (signing in-repo breaks when iCloud adds file attributes).
- CI (`.github/workflows/ci.yml`) runs `npm ci`, typecheck, test on `macos-latest` with Node 22, because tests exercise `osascript`/`codesign`. README says Node 20+.
- No linter configured.
- `.claude/launch.json` defines static preview servers: `store` (port 8099, `store/`) and `mockups` (port 8098, `docs/design/mockups`).

## Architecture

Three Electron processes, with path aliases `@shared` → `src/shared` and `@` → `src/renderer/src` (set in both `electron-vite.config.ts` and `vitest.config.mts`):

- **`src/main/`**: Node side. `index.ts` creates services at startup and calls `registerIpc()`, which wires `registerLibraryIpc`, `registerPluginsIpc`, `registerFeedbackIpc`, `registerContentIpc`, `registerBusinessIpc`, `registerAppIpc` from `src/main/ipc/`. Handlers get services through the `IpcCtx` interface in `src/main/ipc/context.ts` (lazy getters, because services don't exist until after startup). Domain logic lives in flat modules (`catalog.ts`, `sales.ts`, `crm.ts`, `plugins.ts`, `release.ts`, ...). `src/main/assistant/` is the in-app AI assistant (runner, tools, approvals, MCP server, threads).
- **`src/preload/index.ts`**: the only bridge. Exposes an `Api` object (typed in `src/shared/types.ts`) through `contextBridge`. Every method is `ipcRenderer.invoke('domain:action')` (e.g. `'beats:list'`); events use the `sub` helper (`'sounds:status'`). Adding a feature means: handler in `src/main/ipc/*`, method in preload, type in `src/shared/types.ts`.
- **`src/renderer/src/`**: React 19 UI. `App.tsx` is the large root that owns screen state and lazy-loads heavy screens. One `.tsx` per screen/dialog, paired CSS (`beats.css`, `crm.css`, `home.css`, `make.css`), plus `*Utils.ts`/`*Series.ts` for pure logic with tests. `components/` holds ~220 vendored visual components (Skiper UI, Magic UI, Aceternity, ReactBits ports); `components/lib/` is the shadcn-style set (`components.json`).
- **`src/shared/`**: pure, test-covered modules used by both sides (types, key/BPM compatibility, cleanup rules, kit maker, templates, YouTube quota, ...). Keep it free of Node and DOM APIs.

### Database

`src/main/db.ts` opens `studio-hq.db` (WAL, foreign keys on). Schema changes are an ordered `MIGRATIONS` array tracked by `PRAGMA user_version`: **append a new entry at the end, never edit an old one.** A `pre-migration-v*.db` snapshot is taken before upgrading (last 3 kept).

### Tests

Vitest, `environment: node`, `src/**/*.test.ts`, colocated with the code. Shared helpers are in `src/main/test-helpers.ts`.

## Redesign in progress (branch `redesign-v4`)

The 8 old themes are being replaced by one flagship "Deck" look; Home is approved and other screens are being rebuilt (Beats/Loops first; see `beats.css`, `Scene.tsx`, `deckUi`). Plans: `docs/design/v4/rollout-plan.md` and `component-list.md` (30–50 "life" components to port, rewritten to the app's own CSS tokens, theme font/accent, and disabled under `prefers-reduced-motion`). Static concept mockups go in `docs/design/mockups/`; get design approval on a mockup before changing screens.
