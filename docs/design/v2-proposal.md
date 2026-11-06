# Studio HQ — v2 Proposal

Review lenses applied: full-audit (structure, frontend, security, a11y, perf, repo health), design-critique (Nielsen heuristics, UX laws, posture, excise, IA), code-review (security, correctness, maintainability).
Evidence base: `npm test` (385 passing, 35 files), `tsc --noEmit` clean, plus a read of `App.tsx`, `themes.ts`, `a11y.ts`, `main/index.ts`, `styles.css` and the file tree. Not yet done: running the app and walking each view, per-view contrast measurements, profiling.

> Naming note: `package.json` is already `2.0.0` and the What's New flag is `shq.seen = '2.0'`. Call this **v3** in the codebase, or "v2 direction" in conversation, so release notes don't collide.

---

## 1. Verdict

**Approve with changes.** The engine is solid: SQLite with WAL, foreign keys and versioned migrations; a hardened window (context isolation, navigation locked, popups denied, CSP); an approval gate on assistant write-tools; dialog a11y installed in one place; good test coverage of the risky main-process code (plugin removal, safe-path, migrations, assistant).

The product has outgrown its shell. Twelve views, 19 themes, an assistant, a plugin manager, a kit maker, a YouTube publisher and an FL plugin all hang off one 660-line `App.tsx` with 50 `useState` calls. Themes are a strength (and your stated taste), but at 19 themes and ~470 theme-scoped CSS rules in one 1,690-line stylesheet, every new feature must be styled 19 times. v2 should be about **structure and focus**, not more surface.

---

## 2. Findings

### Code review

| # | Sev | Finding | Where | Why it matters |
|---|-----|---------|-------|----------------|
| C1 | High | `App.tsx` is a god component: 50 `useState`, navigation, both vaults, player, collections, dialogs, localStorage persistence | `src/renderer/src/App.tsx` | Every state change re-evaluates a huge scope; hard to test; no deep links. Only one renderer test file exists. |
| C2 | High | `sandbox: false` on the main window | `src/main/index.ts:73` | Disables the Chromium renderer sandbox. Combined with an assistant that can run tools and a preload bridge, a renderer bug becomes a full-user-privilege bug. Likely set for the preload; move Node-needing work into main and re-enable. |
| C3 | Med | CSP allows `style-src 'unsafe-inline'`; 121 inline `style={{}}` uses | `index.html`, renderer | Weakens CSP; also the inline styles bypass the theme system. |
| C4 | Med | Shell-outs spread across 13 main files (`execFile`/`spawn`) with no single wrapper | `plugin-*.ts`, `video.ts`, `bounce.ts`, `cleanup.ts`, … | No shared timeout, logging, argument validation or kill-on-quit policy. |
| C5 | Med | IPC is split into 7 files under `main/ipc` but channel names and payload types aren't generated from one contract | `src/main/ipc`, `src/preload/index.ts`, `src/shared/types.ts` | Drift risk between main, preload and renderer; no runtime validation of renderer-supplied args. |
| C6 | Med | `shq.*` localStorage keys scattered in components with silent `catch {}` | `App.tsx`, `themes.ts` | Settings split between SQLite store and localStorage; unrecoverable corruption is invisible. |
| C7 | Low | `vizScene.ts` is 2,095 lines in `shared/` | `src/shared/vizScene.ts` | Renderer-only visual code living in `shared/`; should be split per preset and lazy-loaded. |
| C8 | Low | README header says "Planned next: Sound Library…" after listing it complete; milestone prose is stale | `README.md` | Onboarding friction. |

### Design critique

| # | Sev | Heuristic / law | Finding | Recommendation |
|---|-----|-----------------|---------|----------------|
| D1 | 3 | H8 minimalist, Hick's | Sidebar exposes 12 destinations at the same level (dashboard, stage, vault, loops, map, crm, sales, content, sounds, kits, plugins, feedback, themes) | Group into 4 jobs: **Make** (Vault, Loops, Sounds, Kits, Stage), **Send** (Pitch CRM, Feedback), **Sell** (Sales, Content), **Maintain** (Plugins, Cleanup). Dashboard is Home. Themes moves into Settings. |
| D2 | 3 | Posture | Product is *sovereign* (hours of use) but opens on a dashboard and treats the beat table as one view among many | Make the Vault the home surface; dashboard becomes a collapsible "Today" strip above it. |
| D3 | 3 | H4 consistency | 19 themes change layout language, icons, type and corner radius, so muscle memory resets per theme | Separate **skin** (colour, texture, type, ornament) from **structure** (layout, spacing, hit targets). Structure is fixed; only scenic ornament varies. |
| D4 | 2 | H1 status | Scanning, FL rescans, analysis and publishing progress are scattered | One persistent activity tray (bottom bar): scan, analyse, render, upload, with cancel. |
| D5 | 2 | H7 flexibility | ⌘K palette exists, but only 4 keydown listeners app-wide and no shortcut hints in menus | Add shortcut hints beside every command; make the palette the universal action surface. |
| D6 | 2 | H5/H3 | Destructive actions (plugin removal, cleanup, dupes) use dialogs | Prefer undo/trash with a toast where reversible; reserve confirms for irreversible. |
| D7 | 2 | Legibility | Decorative display fonts (Metal Mania, Monoton, Yusei Magic) on every text, per your "fonts apply everywhere" rule | Keep character fonts for titles, labels and chrome, but guarantee a legibility floor for dense tables: body-size numeric columns use a paired readable face. Verify contrast per theme. |

### Accessibility, performance, repo health

- **A11y (good start):** `clickable()` helper and `installDialogA11y()` are the right pattern. Gaps to check: `<a>` used as buttons (`SessionPill`), only ~121 inline styles vs. token-driven focus rings, and no per-theme contrast audit. Reduced-motion is handled in CSS in 8 places and in JS in 2; consolidate into one hook and one CSS block.
- **Perf:** lazy-loading of heavy views is already done well. Open questions: theme backdrops (~3 MB webp, fine) and the 19-theme stylesheet shipping in full; canvas waveforms redraw on every theme event. Profile before optimizing.
- **Repo health:** CI runs typecheck + tests on macOS, which is right. Missing: lint/format, renderer tests (1 file), an e2e smoke (Playwright-for-Electron), `npm audit`, release/notarization pipeline.

---

## 3. v2 Proposal

### Goal
One sentence: **"Open Studio HQ, see the next beat to finish or send, and do it in two actions."** Everything else is reachable through ⌘K.

### 3.1 Information architecture
```
Home (Vault + Today strip)
├─ Make      Vault · Loops · Sounds · Kit Maker · Stage
├─ Send      Pitch CRM · Feedback links
├─ Sell      Sales & splits · Content/YouTube
└─ Maintain  Plugins · Cleanup · Settings (incl. Themes)
```
Activity tray (bottom), ⌘K everywhere, assistant docked as a right-hand panel instead of a view.

### 3.2 Design system: skin vs. structure
- **Tokens first.** One `tokens.css` defines colour, radius, spacing, type scale, motion. Themes override tokens only.
- **Skin layer** carries each theme's painted world (backdrops, marks, ornaments, character fonts, ambient effects) via a `Theme` manifest (`id`, tokens, assets, fonts, ambient) instead of 468 hand-written selectors.
- **Tier themes:** *Flagship* (Console, Gilded Ruin, Thorn, Yatai, Koi, City Pop, Magma, Chrome) get full painted treatment; the 11 simpler themes become token-only variants, or are retired. This honours your taste for unique painted worlds without paying 19× per feature.
- **Contract test:** a script renders every view in every theme and fails on contrast < 4.5:1 for body text, missing font glyphs, or overflow.

### 3.3 Architecture
1. Split `App.tsx` into a router + providers: `VaultProvider`, `PlayerProvider`, `SelectionProvider`, `ActivityProvider`. Views own their state. Target: no file over ~250 lines.
2. Typed IPC contract in `shared/ipc.ts` (channel → args → result) with zod-style runtime validation in main; preload generated from it.
3. `main/run.ts`: single process wrapper (timeout, abort on quit, log, allow-listed binaries) used by all 13 shell-out sites.
4. One settings store in SQLite; localStorage only for ephemeral UI state, through a typed `useStored()` hook.
5. Re-enable the renderer sandbox; move anything needing Node behind IPC.
6. Move `vizScene` to `renderer/viz/` with one file per preset, lazy-loaded.

### 3.4 Quality bar
ESLint + Prettier, renderer tests (query parser, selection, player), Playwright smoke test (launch, scan fixture folder, play, search, switch theme), `npm audit` in CI, notarized release workflow.

---

## 4. Roadmap

| Phase | Scope | Size | Risk |
|-------|-------|------|------|
| 0 | Housekeeping: README, lint, `npm audit`, rename version to v3 | S | Low |
| 1 | Security: re-enable sandbox, typed/validated IPC, process wrapper | M | Med (preload breakage) |
| 2 | Split `App.tsx` into router + providers; behaviour unchanged, tests added | M | Med |
| 3 | New IA and sidebar, activity tray, Home = Vault + Today | M | Med (UX change) |
| 4 | Token/skin refactor; port flagship themes first, retire or tokenise the rest; contrast contract test | L | High (visual regressions) |
| 5 | Assistant docked panel; shortcut hints; undo over confirm | M | Low |

Phases 1 and 2 are independent and can run in parallel; 3 depends on 2; 4 can start once tokens exist.

## 5. Decisions I need from you
1. Are you willing to retire or flatten some of the 19 themes (recommended: keep 8 flagships)?
2. Is the Vault-first home acceptable, or do you want the dashboard to stay the landing page?
3. OK to re-enable the renderer sandbox (may require moving a few preload helpers into main)?
