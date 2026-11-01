# Plugin Manager Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Plugins module to Studio HQ that inventories audio plugins, finds every file each one owns, uninstalls them safely to the Trash, and diagnoses/fixes plugins that crash FL Studio or show "not found".

**Architecture:** Pure, unit-tested logic (matching, confidence, allowlist, crash-report parsing) sits in focused `src/main/plugin-*.ts` files; thin functions shell out to `pkgutil`, `lipo`, `codesign`, `xattr`, `plutil` via `execFile` with argument arrays. Results are cached in SQLite and exposed over IPC following the `cleanup:*` pattern. One new renderer view, `Plugins.tsx`, wired into the sidebar.

**Tech Stack:** Electron, React, better-sqlite3, vitest (existing). No new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-01-plugin-manager-design.md`

## Global Constraints

- macOS only. Deletion is **only** `Trash` (never `rm`/`unlink`); admin-owned paths use the macOS admin prompt.
- Confidence tiers are exactly `exact | likely | maybe`; `maybe` is never pre-checked.
- Removal paths must pass `isRemovable()` (Task 1); anything under `/System`, `/usr`, `/bin`, `/private`, or not under an allowlisted root is refused.
- Shell calls use `execFile` with argument arrays and a timeout; never string-interpolated shell commands.
- Every fix is previewed, logged in `plugin_actions`, and reversible (disable/restore, DB backup).
- The working tree has **uncommitted user changes** in `src/main/{content,db,index,store,watcher}.ts`, `src/preload/index.ts`, `src/renderer/src/{App,Detail,Icons,Settings}.tsx`, `src/shared/types.ts`, `README.md`. Add to them without overwriting, and commit only this task's hunks (`git add -p`). Never `git add -A`, never revert their changes.
- Follow `cleanup.ts` style: header comment, `type Row = Record<string, any>`, kebab-case files, IPC names `plugins:*`.

## Review Focus

- Plugin named with a generic word ("Pro", "Delay", "Free") must not pull in other plugins' files.
- Symlink inside an allowed root pointing outside it must be refused.
- Plugin installed in VST3 + AU + AAX merges to one entry, and uninstalling removes all formats.
- Unreadable/corrupt `Info.plist` or empty bundle must not abort the whole scan.
- No FL Studio install / no DiagnosticReports / no FL plugin database must yield an empty health result, not an error.
- Path with spaces, quotes or unicode (e.g. `Soundtoys 5 "Beta".vst3`) must survive trash and admin-prompt paths.
- User declines the admin prompt: user-owned files still removed, protected ones reported as skipped.

---

### Task 1: Shared types, DB tables, removal safety

**Files:**
- Create: `src/main/plugin-remove.ts`, `src/main/plugin-remove.test.ts`
- Modify: `src/shared/types.ts` (append plugin types), `src/main/db.ts` (append tables)

**Interfaces:**
- Produces (in `types.ts`): `PluginFormat = 'vst2'|'vst3'|'au'|'aax'`; `Confidence = 'exact'|'likely'|'maybe'`; `PluginBundle {path, format, size, archs: string[], bundleId: string, version: string}`; `PluginInfo {id: number, name, vendor, bundles: PluginBundle[], totalSize: number, health: 'ok'|'warn'|'bad'|'disabled'}`; `PluginFile {path, size, confidence: Confidence, location: string}`; `HealthFinding {id: number, pluginId: number, kind: HealthKind, severity: 'warn'|'bad', detail: string, certainty: 'confirmed'|'likely', fix: FixKind|null}`; `HealthKind = 'crash'|'arch'|'quarantine'|'signature'|'broken-bundle'|'duplicate'|'stale-fl-db'|'missing-content'`; `FixKind = 'disable'|'unquarantine'|'resign'|'remove-bundle'|'clear-fl-entry'`; `RemoveResult {removed: number, bytes: number, skipped: string[], failed: string[]}`.
- Produces (`plugin-remove.ts`): `isRemovable(path: string, home: string): boolean`; `pluginRoots(home: string): string[]`.
- Tables: `plugins(id, key UNIQUE, name, vendor, total_size, scanned_at)`, `plugin_bundles(id, plugin_id, path UNIQUE, format, size, archs, bundle_id, version)`, `plugin_files(id, plugin_id, path, size, confidence, location)`, `plugin_findings(id, plugin_id, kind, severity, detail, certainty, fix)`, `plugin_actions(id, at, kind, plugin_name, original_path, new_path, note)`.

- [ ] **Step 1: Write failing tests** in `plugin-remove.test.ts`, using a temp dir as `home`: `isRemovable` true for `<home>/Library/Audio/Plug-Ins/VST3/X.vst3`, `/Library/Audio/Plug-Ins/Components/X.component`, `<home>/Library/Application Support/Xfer/Serum`; false for `/System/Library/x`, `/usr/bin/x`, `/Applications/Safari.app`, `<home>/Documents` (the directory itself), `<home>/Library/Audio/Plug-Ins/VST3` (a root itself), and a symlink at `<home>/Library/Application Support/evil` pointing to `/usr`; false for relative paths and paths containing `..`.
- [ ] **Step 2: Run** `npx vitest run src/main/plugin-remove.test.ts` — expect FAIL (module missing).
- [ ] **Step 3: Implement `isRemovable` and `pluginRoots`** in `plugin-remove.ts`: realpath the target (or its parent if missing) and require it be strictly inside an allowlisted root (the plugin dirs, `~/Library/{Application Support,Preferences,Caches,Logs,Saved Application State}`, `/Library/Application Support`, `/Users/Shared`, `/Applications`, user sample folders passed separately) and not equal to a root.
- [ ] **Step 4: Add the types and `CREATE TABLE IF NOT EXISTS` statements** to `types.ts` and `db.ts` (append, don't reformat).
- [ ] **Step 5: Run** the test file — expect PASS; run `npm run typecheck`.
- [ ] **Step 6: Commit** only this task's hunks: `git add src/main/plugin-remove.ts src/main/plugin-remove.test.ts && git add -p src/shared/types.ts src/main/db.ts && git commit -m "feat(plugins): shared types, tables, removal allowlist"`.

### Task 2: Inventory scanner

**Files:**
- Create: `src/main/plugins.ts`, `src/main/plugins.test.ts`, `src/main/fixtures/plugins/` (small fake bundles: `Serum.vst3`, `Serum.component`, `Serum.aaxplugin` with `Contents/Info.plist` JSON-convertible fixtures plus one corrupt bundle)

**Interfaces:**
- Consumes: Task 1 types and tables, `pluginRoots`.
- Produces: `parseBundleMeta(plistJson: Record<string, unknown>, path: string): {name: string; vendor: string; bundleId: string; version: string} | null`; `groupBundles(bundles: (PluginBundle & {name: string; vendor: string})[]): {key: string; name: string; vendor: string; bundles: PluginBundle[]}[]`; `scanPlugins(db: Database.Database, home: string): Promise<PluginInfo[]>` (persists and returns); `listPlugins(db): PluginInfo[]`.

- [ ] **Step 1: Failing tests:** `parseBundleMeta` reads `CFBundleName`/`CFBundleIdentifier`/`CFBundleShortVersionString`, derives vendor from bundle ID (`com.xferrecords.Serum` → `xferrecords` fallback when no `NSHumanReadableCopyright` vendor), returns null for empty input; `groupBundles` merges VST3+AU+AAX of "Serum" (same vendor + name ignoring case/extension) into one entry and keeps different plugins apart; a corrupt bundle in the fixtures does not throw from `scanPlugins` and is recorded as skipped.
- [ ] **Step 2: Run** — expect FAIL.
- [ ] **Step 3: Implement** `scanPlugins`: list bundle dirs (`.vst`, `.vst3`, `.component`, `.aaxplugin`) per root, `plutil -convert json -o - <Info.plist>` via `execFile`, `lipo -archs` on `Contents/MacOS/<CFBundleExecutable>`, folder size via recursive stat; per-bundle try/catch; upsert into tables.
- [ ] **Step 4: Run** tests + typecheck — expect PASS.
- [ ] **Step 5: Commit** `feat(plugins): inventory scanner`.

### Task 3: Leftover finder

**Files:**
- Create: `src/main/plugin-files.ts`, `src/main/plugin-files.test.ts`

**Interfaces:**
- Consumes: `PluginInfo`, `PluginFile`, `isRemovable`.
- Produces: `matchConfidence(plugin: {name: string; vendor: string; bundleId: string}, candidateName: string): Confidence | null`; `parseReceiptFiles(pkgutilFilesOutput: string, installLocation: string): string[]`; `findPluginFiles(plugin: PluginInfo, home: string, extraRoots: string[]): Promise<PluginFile[]>` (always includes the plugin's own bundles as `exact`, filters through `isRemovable`, dedupes nested paths keeping the outermost).

- [ ] **Step 1: Failing tests:** `matchConfidence` → `likely` for folder `Xfer` / `Serum` when plugin is Serum by Xfer; `likely` for `com.xferrecords.serum.plist`; `null` for `Serum2` vs `Serum`? (decide: `null` — exact token match required); a plugin named `Pro` or `Delay` or `Free` (generic list: pro, free, delay, reverb, comp, eq, synth, lite, one, plus) matches **only** on vendor+name together, never on name alone; vendor-only match (`Xfer`) is `maybe`; `parseReceiptFiles` joins relative receipt paths to the install location and drops directories ending in `/` and entries outside an absolute root; nested candidate dedupe keeps `~/Library/Application Support/Xfer` and drops `.../Xfer/Serum/Presets`.
- [ ] **Step 2: Run** — expect FAIL.
- [ ] **Step 3: Implement** matching as token-based (split on non-alphanumerics, lowercase); search the roots named in the spec with one `readdir` level (two for `Application Support/<Vendor>/<Product>`); receipts via `pkgutil --pkgs` filtered by vendor/bundleId tokens, then `pkgutil --files` and `pkgutil --pkg-info` for the install location. Folder sizes via the helper from Task 2 (import, don't duplicate).
- [ ] **Step 4: Run** tests + typecheck — expect PASS.
- [ ] **Step 5: Commit** `feat(plugins): leftover finder with confidence tiers`.

### Task 4: Uninstall (Trash + admin elevation + log)

**Files:**
- Modify: `src/main/cleanup.ts` (export `toTrash` — one-word change), `src/main/plugin-remove.ts`
- Test: `src/main/plugin-remove.test.ts`

**Interfaces:**
- Consumes: `toTrash` from `cleanup.ts`; `isRemovable`.
- Produces: `removePluginFiles(db, plugin: {id: number; name: string}, paths: string[], home: string, extraRoots: string[]): Promise<RemoveResult>`; `needsAdmin(path: string): boolean` (true when the path is not writable by the current user); `adminTrash(path: string): Promise<void>` (moves into `~/.Trash` via `osascript` `do shell script … with administrator privileges`, quoting with `quoted form of`).

- [ ] **Step 1: Failing tests** (temp-dir home, `toTrash` and `adminTrash` injected as parameters of an inner `removeWith(deps, …)` so no real Trash is touched): path outside allowlist → `skipped` and never passed to either function; user-owned path → `toTrash` called; non-writable path → `adminTrash` called; `adminTrash` rejecting (user cancels) → path in `skipped`, others still removed; a name containing spaces, `"` and unicode passes through unchanged; every successful removal writes a `plugin_actions` row with kind `'remove'`.
- [ ] **Step 2: Run** — expect FAIL.
- [ ] **Step 3: Implement** `removeWith` and the production `removePluginFiles` that binds the real deps; sum sizes from the files table; trash children before parents is unnecessary since nested paths are deduped upstream.
- [ ] **Step 4: Run** tests + typecheck — expect PASS.
- [ ] **Step 5: Commit** `feat(plugins): trash-based uninstall with admin fallback`.

### Task 5: Health detection

**Files:**
- Create: `src/main/plugin-health.ts`, `src/main/plugin-health.test.ts`, fixtures `src/main/fixtures/crash/fl-crash.ips` (sample macOS `.ips` crash report with a plugin in the crashed thread) and `fl-crash-bystander.ips` (plugin only among loaded images)

**Interfaces:**
- Consumes: `PluginInfo`, `HealthFinding`.
- Produces: `parseCrashReport(ipsText: string): {app: string; crashedFrames: string[]; images: string[]} | null`; `attributeCrash(report, plugins: PluginInfo[]): {pluginId: number; certainty: 'confirmed'|'likely'}[]` (crashed-thread frame match → confirmed; image-list only → likely); `checkArch(plugin, flArchs: string[]): HealthFinding | null`; `findDuplicates(plugins: PluginInfo[]): HealthFinding[]`; `checkBundle(bundle): Promise<HealthFinding[]>` (missing executable, bad plist, dangling symlink, quarantine xattr, `codesign --verify` failure); `compareFlDatabase(entries: {name: string; path: string; failed: boolean}[], plugins: PluginInfo[]): HealthFinding[]` (listed-but-gone and installed-but-flagged-failed); `runHealthChecks(db, home): Promise<HealthFinding[]>` (persists to `plugin_findings`; returns `[]` when no FL install, no DiagnosticReports, or no FL database).

- [ ] **Step 1: Failing tests:** both crash fixtures (confirmed vs likely; non-FL crash reports return no attribution), malformed text returns `null`; x86_64-only plugin vs `['arm64']` → `arch` finding with fix `'disable'`; universal binary → none; two bundles with the same bundle ID in `/Library` and `~/Library` → `duplicate`; `compareFlDatabase` produces `stale-fl-db` for a listed entry whose path is gone; `runHealthChecks` with an empty temp home returns `[]` without throwing.
- [ ] **Step 2: Run** — expect FAIL.
- [ ] **Step 3: Implement.** Determine FL's architecture by `lipo -archs` on the FL Studio app binary (`/Applications/FL Studio*.app`). Read FL's plugin database from `~/Documents/Image-Line/FL Studio/Presets/Plugin database/` — **inspect the real layout first** (read-only `ls`/`head`) and adjust the parser; record what you found as a comment in the file. Crash reports: `~/Library/Logs/DiagnosticReports/*FL*Studio*.ips` newest 20.
- [ ] **Step 4: Run** tests + typecheck — expect PASS.
- [ ] **Step 5: Commit** `feat(plugins): crash, arch, signature, duplicate and stale-database detection`.

### Task 6: Fixes (disable/restore, unquarantine, re-sign, FL database)

**Files:**
- Modify: `src/main/plugin-health.ts` (or create `src/main/plugin-fix.ts` if it passes ~300 lines)
- Test: `src/main/plugin-fix.test.ts`

**Interfaces:**
- Consumes: `isRemovable`, tables from Task 1.
- Produces: `disablePlugin(db, plugin: PluginInfo, home: string): Promise<void>` (moves each bundle into `~/Library/Application Support/Studio HQ/Disabled Plugins/<format>/…`, logs original path in `plugin_actions` kind `'disable'`); `restorePlugin(db, actionIds: number[]): Promise<{restored: number; failed: string[]}>` (refuses if the original location now exists); `listDisabled(db): {actionId: number; name: string; originalPath: string; at: number}[]`; `applyFix(db, finding: HealthFinding, home: string): Promise<void>` dispatching on `FixKind`; `previewFix(finding): string` (human-readable description of exactly what will change).

- [ ] **Step 1: Failing tests** (temp dirs, real `fs` moves, injected command runner for `xattr`/`codesign`): disable then restore round-trips a bundle byte-for-byte; restore refuses to overwrite an existing path; `unquarantine` calls `xattr -dr com.apple.quarantine <path>` with an argument array; `clear-fl-entry` copies the FL database file to a timestamped backup before writing, and a failed write leaves the original untouched; `previewFix` returns non-empty text for every `FixKind`.
- [ ] **Step 2: Run** — expect FAIL.
- [ ] **Step 3: Implement** with the command runner injected like Task 4's deps. Re-sign is `codesign --force --deep --sign - <bundle>`.
- [ ] **Step 4: Run** tests + typecheck — expect PASS.
- [ ] **Step 5: Commit** `feat(plugins): reversible fixes and disabled-plugin restore`.

### Task 7: IPC, worker, preload

**Files:**
- Modify: `src/main/index.ts` (add handlers beside `cleanup:*`, near line 223), `src/preload/index.ts` (beside `cleanupList`), `src/shared/types.ts` (add methods to the API interface beside `cleanupList`)
- Create: `src/main/plugins.worker.ts` only if scanning blocks the main process during manual timing (measure first with the real scan from Task 9; otherwise `await` in main as `cleanup` does)

**Interfaces:**
- Consumes: Tasks 2–6.
- Produces (IPC / preload API): `pluginsList(): Promise<PluginInfo[]>`; `pluginsScan(): Promise<PluginInfo[]>`; `pluginFiles(id: number): Promise<PluginFile[]>`; `pluginsRemove(id: number, paths: string[]): Promise<RemoveResult>`; `pluginsHealth(): Promise<HealthFinding[]>`; `pluginsFixPreview(findingId: number): Promise<string>`; `pluginsFixApply(findingId: number): Promise<void>`; `pluginsDisabled()` and `pluginsRestore(actionIds: number[])`.

- [ ] **Step 1: Write a failing typecheck** by adding the new methods to the API interface in `types.ts` — `npm run typecheck` fails in `preload` and `index`.
- [ ] **Step 2: Add the handlers and preload bridges**; `pluginFiles` runs `findPluginFiles` with the user's configured sample/projects folders from `store.getSettings()`; `pluginsRemove` re-validates every path server-side (renderer input is untrusted).
- [ ] **Step 3: Run** `npm run typecheck` and `npx vitest run` — expect PASS.
- [ ] **Step 4: Commit** only these hunks: `feat(plugins): IPC surface`.

### Task 8: Plugins view

**Files:**
- Create: `src/renderer/src/Plugins.tsx`
- Modify: `src/renderer/src/App.tsx` (add `'plugins'` to the `view` union at line 49, a sidebar `<a className="nav …">` beside Sound Library, and the render branch beside `view === 'sounds'`), `src/renderer/src/Icons.tsx` (add a `plugins` icon)

**Interfaces:**
- Consumes: Task 7 preload API.
- Produces: `export function Plugins(): JSX.Element` (self-loading; no props).

- [ ] **Step 1: Build the view** per the spec: header with total reclaimable size and Rescan; searchable, sortable table (name, vendor, formats, health badge, size; default largest first); detail panel with files grouped by `location`, confidence chips, per-file Reveal in Finder (`shell.showItemInFolder` through an existing preload helper — check how `Detail.tsx` does it), checkboxes (exact/likely pre-checked); Uninstall confirm dialog listing every checked path and total size; results toast with freed space, skipped, failed; a Health tab listing findings with `previewFix` text and an Apply button; a Disabled list with Restore. Reuse existing dialog/CSS classes from `Cleanup.tsx`.
- [ ] **Step 2: Run** `npm run typecheck`; `npm run dev`, open Plugins, and confirm via the browser/app pane: list loads, sorting works, detail panel opens, `maybe` rows start unchecked, Uninstall dialog shows the exact path list and does nothing until confirmed. Use a **harmless fixture plugin** (a copy placed under `~/Library/Audio/Plug-Ins/VST3/ZZ Test.vst3`) for the uninstall click-through and delete only that.
- [ ] **Step 3: Commit** only these hunks: `feat(plugins): Plugins view and sidebar entry`.

### Task 9: Real-machine verification and docs

**Files:**
- Modify: `README.md` (short Plugins section, appended)

- [ ] **Step 1: Read-only run on the real Mac:** run the scan; compare the plugin count with the folders on disk (`ls /Library/Audio/Plug-Ins/VST3 | wc -l` etc.); spot-check three plugins' file lists for sanity; confirm no `exact` entry sits outside the allowlist. Report anything surprising (FL database layout, crash-report format) and fix the parsers.
- [ ] **Step 2: Confirm health** against the user's real FL crash reports (if any exist) and report the findings to the user without applying any fix.
- [ ] **Step 3: Run** the full suite `npx vitest run` and `npm run typecheck` — expect all PASS.
- [ ] **Step 4: Commit** `docs(plugins): README section`. Do not run any real uninstall or fix; the user chooses those in the app.

---

## Self-review notes

Spec coverage: inventory (T2), leftover finder (T3), Plugins view (T8), uninstall (T1, T4), health table rows crash/arch/quarantine/signature/broken/duplicate/stale-db (T5), missing-content is report-only and included in `checkBundle` detail, fixes + Disabled list (T6, T8), data tables (T1), error handling and testing (per task). Review Focus lines map to: generic names (T3), symlinks (T1), format merge (T2), corrupt bundle (T2), no FL (T5), odd characters and admin decline (T4).
