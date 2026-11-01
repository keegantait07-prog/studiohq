# Plugin Manager — Design

Date: 2026-11-01
Status: draft, awaiting review

## Goal

A **Plugins** module in Studio HQ that (1) lists every audio plugin on the Mac, (2) shows every file each plugin has left anywhere on disk and its true size, (3) uninstalls a plugin completely and safely, and (4) finds and fixes plugins that crash FL Studio or show "not found"/error.

Success looks like:
- The user can open Plugins, see all plugins sorted by disk footprint, and remove one with every leftover file in one reviewed action.
- For a plugin that crashes FL or fails to load, the app says *why* (when it can) and offers a fix that is reversible.

## Non-goals (v1)

Windows, notes/ratings/license tracking, usage detection from FL projects, auto-updating plugins, fixing plugins whose own code is buggy (we can only identify and quarantine those).

## Architecture

New units, each with one purpose, following the existing one-file-per-module pattern in `src/main` and one view per module in the renderer. Types go in `src/shared/types.ts`, IPC in `src/preload/index.ts` / `src/main/index.ts`, tables in `src/main/db.ts`.

| Unit | Responsibility |
|---|---|
| `src/main/plugins.ts` | Scan standard plugin folders, read `Info.plist`, merge formats into one plugin entry, persist to SQLite |
| `src/main/plugin-files.ts` | Find all files belonging to a plugin, each with a confidence (Exact/Likely/Maybe) and size |
| `src/main/plugin-health.ts` | Detect broken/crashing plugins and propose fixes |
| `src/main/plugin-remove.ts` | Safety allowlist, move-to-Trash, admin elevation, removal log |
| `src/renderer/src/Plugins.tsx` | List, detail panel, uninstall and fix dialogs |

Heavy scans run in a worker (as `analyze.worker.ts` does); results are cached in SQLite so the view opens instantly and a rescan runs in the background.

## 1. Inventory

Scan `/Library/Audio/Plug-Ins/{VST,VST3,Components}`, `/Library/Application Support/Avid/Audio/Plug-Ins` (AAX), and the same folders under `~/Library`. Per bundle read name, vendor, version, bundle ID, architectures (`lipo -archs` on the binary), and format. Bundles of the same product in different formats merge into one plugin with a formats list. Also read FL Studio's plugin database (under `~/Documents/Image-Line/FL Studio/Presets/Plugin database`, exact layout verified on the real machine during implementation) to catch plugins in custom folders and to learn which ones FL has flagged as failing.

## 2. Leftover finder

For each plugin:
- **Exact** — files listed by installer receipts (`pkgutil --pkgs` matched on vendor/bundle ID, then `pkgutil --files`).
- **Likely / Maybe** — name/vendor matches in `~/Library/{Application Support,Preferences,Caches,Logs,Saved Application State}`, `/Library/Application Support`, `/Users/Shared`, `/Applications`, `~/Documents`, and user-configured sample-library folders. Strong vendor+product match = Likely; single generic word = Maybe. Generic names never match on their own.
- Folder sizes computed so each plugin shows real total footprint.

## 3. Plugins view

Sortable, searchable table: name, vendor, formats, health badge, total size (largest first). Header shows total reclaimable space. Clicking a plugin opens a detail panel: files grouped by location with confidence label and size, Reveal in Finder per file, and any health findings.

## 4. Uninstall

Exact and Likely pre-checked, Maybe unchecked. User confirms the final list. Files move to the **Trash** (never `rm`). Paths outside the allowlist (known plugin/library locations) and any Apple/system path are refused. `/Library` paths need admin rights via the macOS admin prompt; if declined they are skipped and reported. After removal: rescan, show space freed and failures. Each removal is logged in SQLite (what, when, Trash location).

## 5. Health: crashes and "not found" errors

Goal: explain and fix, not just list. Checks, each producing a finding with a severity and (where possible) a fix:

| Finding | How detected | Fix offered |
|---|---|---|
| **Crashes FL Studio** | Parse `~/Library/Logs/DiagnosticReports` FL Studio crash reports; match plugin names/paths in the crashed thread's frames and loaded images | Move the plugin's bundles to a Disabled folder (reversible), so FL stops loading it |
| **Wrong architecture** (e.g. x86_64-only plugin in an arm64 FL) | `lipo -archs` vs FL's architecture | Explain; offer disable. (Cannot convert the plugin.) |
| **Blocked / quarantined or bad signature** | `xattr` for `com.apple.quarantine`; `codesign --verify` | Remove quarantine flag; ad-hoc re-sign when the signature is broken |
| **Missing or broken bundle** (no executable, bad `Info.plist`, dangling symlink) | Bundle structure check | Offer to remove the dead bundle |
| **Duplicate / conflicting copies** (same plugin in `/Library` and `~/Library`, or two versions) | Group by bundle ID | Disable or remove the older/duplicate copy |
| **Stale FL plugin database** ("not found" for a plugin that is installed, or listed but gone) | Compare FL's database entries to what exists on disk | Clear the affected database entries and prompt a rescan in FL (backup taken first) |
| **Missing content** (plugin present, its library/data folder gone) | Compare the plugin's expected support folders | Report only |

Principles: every fix is previewed first, reversible (disabled plugins live in a managed folder and can be restored from the UI; FL database edits are backed up), and none run silently. When the cause can't be determined we say so rather than guessing; crash attribution is labeled "likely" or "confirmed" based on whether the plugin appears in the crashed thread vs. only among loaded images.

A **Disabled** list in the view shows quarantined plugins with a Restore button.

## Data

New SQLite tables (via `db.ts` migrations): `plugins`, `plugin_files`, `plugin_findings`, `plugin_actions` (removal/disable/fix log with enough info to undo).

## Error handling

Scan failures per bundle are recorded and skipped, not fatal. Permission errors on protected folders are reported with a hint to grant Full Disk Access. All shell calls (`pkgutil`, `lipo`, `codesign`, `xattr`) use argument arrays, never string interpolation, with timeouts.

## Testing

Vitest with fixture directory trees: matching and confidence scoring, generic-name guard, allowlist refusal (system paths, symlink escapes), receipt parsing, crash-report parsing from sample `.ips` files, duplicate grouping. Manual verification against the real machine is read-only until the user reviews a specific action; nothing is deleted or modified without the user watching.

## Risks

- Heuristic matching can over-match: mitigated by confidence tiers, unchecked Maybes, Trash-only deletion and the allowlist.
- FL's database format and crash-report layout may differ from assumptions: verified against the real machine before building on them.
- Some crashes originate inside the plugin and can only be worked around by disabling it.
