# Lead Finder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Leads view that finds small artists from public sources, stores the contact emails they published, ranks them by fit, and hands them to the existing Pitch CRM, with an opt-out line and a suppression list.

**Architecture:** Pure logic (types, scoring, parsing) in `src/shared/leads.ts`. A `Leads` store class in `src/main/leads/index.ts` owns two new tables and promotes leads into existing CRM `contacts`. Each source is a module exporting `search()` with injected `fetch`. IPC handlers go in `ipc/business.ts`; the UI is a lazy `Leads.tsx` view.

**Tech Stack:** Electron, better-sqlite3, React 19, vitest (`npm test`, node environment), `@shared` alias.

**Spec:** `docs/superpowers/specs/2026-11-07-lead-finder-design.md`

## Global Constraints

- Never scrape Instagram. Instagram leads enter only by paste or CSV.
- Only store emails the artist published; every stored email keeps `email_source_url`. Never guess an address.
- Contact lookup runs only on leads the user triggers, one at a time, minimum 3000 ms between fetches, honouring `robots.txt`.
- Suppressed addresses can never be pitched. Every email pitch carries the opt-out line.
- Schema changes are a NEW entry appended to `MIGRATIONS` in `src/main/db.ts`; never edit an old entry.
- API keys use `setSecret`/`getSecret` from `src/main/ytkv.ts`; keys are never sent to the renderer.
- The working tree has unrelated uncommitted changes (`App.tsx`, `styles.css`, `Icons.tsx`, `themes.ts` and others). Commit only your own hunks (`git add -p`, or list exact files); never `git add -A`.
- No restyling: use existing theme classes. The Leads layout mockup must be approved by the user before Task 5's UI step.
- Run `npm test` and `npm run typecheck` before every commit; both must pass.

## Review Focus

- Email in different case or with whitespace/`mailto:` prefix is the same address for dedupe and suppression (`"  Foo@X.com "` equals `"foo@x.com"`).
- A lead with unknown follower count (`null`) must not score as "small account".
- CSV with a BOM, quoted commas, blank lines and CRLF imports cleanly; a malformed row is skipped, not fatal.
- A pasted profile URL with query string, trailing slash or `@` prefix resolves to one canonical `(source, sourceId)`.
- Contact lookup on a non-HTML, huge, redirecting-offsite or timing-out page returns `null` and never throws; junk matches (`name@2x.png`, `example.com`, `sentry.io`) are rejected.

---

### Task 1: Shared types, scoring and parsing

**Files:**
- Create: `src/shared/leads.ts`
- Test: `src/shared/leads.test.ts`

**Interfaces:**
- Produces:
  - `type LeadSource = 'youtube' | 'soundcloud' | 'audiomack' | 'reddit' | 'x' | 'manual'`
  - `type LeadStatus = 'new' | 'saved' | 'in_crm' | 'skipped'`
  - `interface LeadCandidate { source: LeadSource; sourceId: string; name: string; url: string; followers: number | null; lastActiveAt: number | null; genre: string; bio: string; signals: string[]; email: string; emailSourceUrl: string }`
  - `interface Lead extends LeadCandidate { id: number; score: number; reasons: string[]; status: LeadStatus; contactId: number | null; createdAt: number }`
  - `normalizeEmail(s: string): string | null`
  - `extractEmails(text: string): string[]` (normalised, deduped, junk removed)
  - `scoreLead(c: LeadCandidate, o: { producerGenres: string[]; now: number }): { score: number; reasons: string[] }`
  - `parseHandles(text: string): Pick<LeadCandidate, 'source' | 'sourceId' | 'url'>[]`
  - `parseCsv(text: string): LeadCandidate[]` (columns `name,url,email,genre,followers`, header row optional)
  - `withOptOut(body: string): string`
  - `OPT_OUT_LINE = 'Not interested? Reply "stop" and I won\'t email you again.'`

- [ ] **Step 1: Write failing tests** in `leads.test.ts`: `normalizeEmail('  Foo@X.com ')` → `'foo@x.com'`, `'mailto:a@b.co?subject=hi'` → `'a@b.co'`, `'not an email'` → `null`; `extractEmails` rejects `logo@2x.png`, `x@example.com`, `a@sentry.io`; `scoreLead` pins: base 50, followers `<1000` +25, `<5000` +15, `<20000` +5, `>=20000` −20, `>=100000` −40 (replaces the −20), `null` followers +0; `lastActiveAt` within 30 days +15, within 90 days +5, older than 180 days −15; genre in `producerGenres` (case-insensitive) +10; signal `'asks_for_beats'` +30 once; clamped 0–100; each rule appends a human-readable string to `reasons`; `parseHandles('@foo\nhttps://www.instagram.com/bar/?hl=en\nhttps://soundcloud.com/baz')` → three entries with sources `manual`/`manual`/`soundcloud`... (bare `@foo` and Instagram → `manual` with `sourceId` lowercase handle); `parseCsv` handles BOM, CRLF, quoted comma, blank line, bad row skipped; `withOptOut` appends `OPT_OUT_LINE` once (idempotent).
- [ ] **Step 2: Run** `npx vitest run src/shared/leads.test.ts` → FAIL (module missing).
- [ ] **Step 3: Implement** `src/shared/leads.ts` with the signatures above. Pure; no Node imports. Score rules exactly as pinned in Step 1.
- [ ] **Step 4: Run** the same command → PASS.
- [ ] **Step 5: Commit** `git add src/shared/leads.ts src/shared/leads.test.ts && git commit -m "feat(leads): shared types, scoring and parsing"`

### Task 2: Tables and the Leads store

**Files:**
- Modify: `src/main/db.ts` (append migration to `MIGRATIONS`, line 18)
- Create: `src/main/leads/index.ts`
- Test: `src/main/leads/leads.test.ts`, extend `src/main/db-migrate.test.ts`

**Interfaces:**
- Consumes: `Lead`, `LeadCandidate`, `LeadStatus`, `scoreLead`, `normalizeEmail` (Task 1); `Crm.saveContact` (`src/main/crm.ts:55`).
- Produces: `class Leads { constructor(db: Database.Database, crm: Crm, genres: () => string[], now?: () => number) }` with
  - `list(f?: { source?: LeadSource; minScore?: number; hasEmail?: boolean; status?: LeadStatus }): Lead[]` (score descending)
  - `addCandidates(cs: LeadCandidate[]): { added: number; duplicates: number }` (scores on insert; unique on `(source, sourceId)`; also skips candidates whose normalised email already exists on another lead)
  - `setStatus(id: number, s: 'saved' | 'skipped'): void`
  - `setEmail(id: number, email: string, sourceUrl: string): void`
  - `promote(id: number): number` returns contact id; links to an existing non-archived contact with the same normalised email instead of creating one; sets status `in_crm` and `contact_id`
  - `suppress(email: string, reason: string): void`, `isSuppressed(email: string): boolean`, `suppressedList(): { email: string; reason: string; createdAt: number }[]`
- Tables per spec: `leads(id, source, source_id, name, url, followers, last_active_at, genre, bio, signals, score, reasons, email, email_source_url, status, contact_id, created_at, UNIQUE(source, source_id))`, `suppressed(email PRIMARY KEY, reason, created_at)`.

- [ ] **Step 1: Write failing tests** against an in-memory `better-sqlite3` DB created via `openDb` on a temp dir (pattern in `db-migrate.test.ts`): dedupe on `(source, sourceId)`; dedupe on same email in different case; `list` sorts by score and filters; `promote` creates a contact with `role: 'artist'`, copies email/url into `links`, and a second lead with the same email links to the same contact; `suppress` then `isSuppressed('  FOO@x.com')` is true; a migration test that an old DB (user_version at the previous latest) upgrades and has both tables.
- [ ] **Step 2: Run** `npx vitest run src/main/leads src/main/db-migrate.test.ts` → FAIL.
- [ ] **Step 3: Implement** the migration function `addLeadTables` (CREATE TABLE IF NOT EXISTS plus an index on `leads(score)`), then `Leads`. `signals` and `reasons` are JSON text; use the `Row` + `toLead` pattern from `crm.ts`.
- [ ] **Step 4: Run** the same command → PASS.
- [ ] **Step 5: Commit** `git add src/main/db.ts src/main/leads src/main/db-migrate.test.ts && git commit -m "feat(leads): tables, store, suppression"`

### Task 3: Suppression and opt-out in the pitch flow

**Files:**
- Modify: `src/main/ipc/business.ts:57` (`crm:logPitch` handler), `src/renderer/src/PitchDialog.tsx:~82` (body), `src/renderer/src/Crm.tsx` (contact detail)
- Test: `src/main/leads/pitchguard.test.ts`

**Interfaces:**
- Consumes: `Leads.isSuppressed`, `withOptOut`, `normalizeEmail`.
- Produces: `assertNotSuppressed(leads: Pick<Leads,'isSuppressed'>, email: string): void` exported from `src/main/leads/index.ts`; throws `Error('<email> opted out and cannot be pitched.')`.

- [ ] **Step 1: Write failing test** for `assertNotSuppressed`: suppressed address (any case) throws that exact message; unsuppressed and empty email do not.
- [ ] **Step 2: Run** `npx vitest run src/main/leads/pitchguard.test.ts` → FAIL.
- [ ] **Step 3: Implement** `assertNotSuppressed`. In the `crm:logPitch` handler, look up the contact's email and call it before `c.crm.logPitch` when `channel === 'email'`. In `PitchDialog`, pass `withOptOut(renderTemplate(...))` as the body and disable the draft with a visible notice when the contact is suppressed (via `window.api.leadsIsSuppressed`, added in Task 4). In `Crm.tsx` add a "Mark opted out" button on the contact that calls `window.api.leadsSuppress(email, 'opted out')`.
- [ ] **Step 4: Run** `npm test && npm run typecheck` → PASS (the renderer wiring is typechecked once Task 4 adds the API methods; do Task 4 Step 3 first if typecheck fails on `leadsIsSuppressed`).
- [ ] **Step 5: Commit** the touched files with `-m "feat(leads): suppression guard and opt-out line in pitches"`.

### Task 4: IPC, preload, services wiring

**Files:**
- Modify: `src/main/ipc/context.ts` (add `readonly leads: Leads`), `src/main/index.ts` (construct `leads = new Leads(db, crm, () => <producer genres from settings or []>)` after `crm` at line 245; register in `ctx` getter block near line 211), `src/main/ipc/business.ts`, `src/preload/index.ts`, `src/shared/types.ts` (API interface near line 424)

**Interfaces:**
- Produces IPC/API: `leads:list(filter)`, `leads:import(text: string, kind: 'handles' | 'csv')` → `{ added: number; duplicates: number }`, `leads:promote(id)`, `leads:skip(ids: number[])`, `leads:save(ids: number[])`, `leads:suppress(email, reason)`, `leads:isSuppressed(email)`. Preload names: `leadsList`, `leadsImport`, `leadsPromote`, `leadsSkip`, `leadsSave`, `leadsSuppress`, `leadsIsSuppressed`. Later tasks add `leads:search` and `leads:lookupContact`.
- Mutating handlers call `c.sendCrm()` (same `mut` wrapper as the CRM).

- [ ] **Step 1: Add** the interface methods to `types.ts`, preload entries, `IpcCtx.leads`, construction in `index.ts`, and handlers. `leads:import` runs `parseHandles` or `parseCsv` then `addCandidates`.
- [ ] **Step 2: Run** `npm run typecheck` → PASS.
- [ ] **Step 3: Run** `npm test` → PASS.
- [ ] **Step 4: Commit** with `-m "feat(leads): IPC and services wiring"`.

### Task 5: Leads view

**Files:**
- Create: `src/renderer/src/Leads.tsx`
- Modify: `src/renderer/src/App.tsx` (add `'leads'` to the `view` union at line 73, a lazy import beside `KitMaker` at line 31, a nav entry beside line 417, a render branch), `src/renderer/src/Icons.tsx` (a `leads` icon)

- [ ] **Step 1: Show the user a layout mockup** of the Leads view (ranked list, filters, import box, bulk bar) using the project's current theme, and wait for approval. Do not build the UI before approval.
- [ ] **Step 2: Implement** the view: list rows with name, source, link, followers, last active, score with reasons on hover/expand, email with its source URL, status; filters (source, min score, has-email, status); paste/CSV import box; bulk Add to CRM and Skip; per-row "Pitch" that promotes then opens `PitchDialog`. Keyboard-operable rows via `a11y.ts` helpers like other views.
- [ ] **Step 3: Verify in the app** with `preview_start` using the dev server config: import a pasted list, see ranked rows, promote one, confirm it appears in Pitch CRM; check console for errors.
- [ ] **Step 4: Run** `npm test && npm run typecheck` → PASS.
- [ ] **Step 5: Commit** only `Leads.tsx`, `Icons.tsx` and the specific `App.tsx` hunks (`git add -p src/renderer/src/App.tsx`) with `-m "feat(leads): Leads view"`.

### Task 6: Contact lookup

**Files:**
- Create: `src/main/leads/contact-lookup.ts`
- Test: `src/main/leads/contact-lookup.test.ts`
- Modify: `src/main/ipc/business.ts` (`leads:lookupContact`), `src/preload/index.ts`, `src/shared/types.ts` (`leadsLookupContact(id: number)`), `Leads.tsx` (row action "Find email")

**Interfaces:**
- Consumes: `extractEmails` (Task 1), `Leads.setEmail`.
- Produces: `lookupContact(url: string, o: { fetchFn: typeof fetch; sleep?: (ms: number) => Promise<void>; minGapMs?: number }): Promise<{ email: string; sourceUrl: string } | null>`. Fetches the page (8 s timeout, only `text/html`, first 1 MB), reads `mailto:` links and visible text, then follows at most 2 same-host links whose href or text matches `/contact|about|booking|business/i`. Checks `/robots.txt` first and returns `null` if `User-agent: *` disallows the path. Waits `minGapMs` (default 3000) between fetches.

- [ ] **Step 1: Write failing tests** with stub `fetchFn`: finds `mailto:` on the page and returns `sourceUrl` of that page; follows a `/contact` link; returns `null` for non-HTML content type, for a robots disallow, for a thrown fetch, and for an off-site redirect; ignores `logo@2x.png` and `x@example.com`; a fake `sleep` records at least two gaps of `minGapMs` across three fetches.
- [ ] **Step 2: Run** `npx vitest run src/main/leads/contact-lookup.test.ts` → FAIL.
- [ ] **Step 3: Implement** `lookupContact`; the handler loads the lead, runs the lookup, and calls `setEmail` only when a result is returned.
- [ ] **Step 4: Run** `npm test && npm run typecheck` → PASS.
- [ ] **Step 5: Commit** with `-m "feat(leads): rate-limited contact lookup"` (Leads.tsx via `git add -p`).

### Task 7: Source interface, YouTube and Reddit

**Files:**
- Create: `src/main/leads/sources/types.ts`, `sources/youtube.ts`, `sources/reddit.ts`, `sources/youtube.test.ts`, `sources/reddit.test.ts`
- Modify: `src/main/ytresearch.ts` (add public `smallChannels`), `src/main/index.ts` (create `ytResearch` once and pass it to both `YtPublisher` and `Leads`, replacing the inline `new YtResearch(...)` at line 261), `src/main/ipc/business.ts` (`leads:search`), preload, `types.ts`, `Leads.tsx` (search box with source picker)
- Create fixtures: `sources/__fixtures__/youtube-search.json`, `reddit-search.json`

**Interfaces:**
- Produces in `types.ts`: `interface SourceCtx { fetchFn: typeof fetch; getKey(name: string): string | null; now: number }`; `interface LeadSourceModule { id: LeadSource; search(query: string, ctx: SourceCtx): Promise<LeadCandidate[]> }`; `class SourceError extends Error` (message shown verbatim in the UI, e.g. `Connect X in Settings`).
- `YtResearch.smallChannels(query: string, maxSubs: number, now?: number): Promise<{ channelId: string; title: string; subs: number | null; description: string; lastUploadAt: number | null; url: string }[]>`: one `search` call (type=channel, cost `COST.search`) then one `channels.list` call (`part=snippet,statistics`, cost `COST.list`), metered and cached like `discover`; keeps channels with `subs < maxSubs` or hidden subs.
- `youtubeSource(research: Pick<YtResearch,'smallChannels'>): LeadSourceModule`: maps channels to candidates (`source: 'youtube'`, `sourceId: channelId`), emails from `extractEmails(description)` with `emailSourceUrl` = channel URL, `signals: ['asks_for_beats']` when the description matches `/need(ing)? beats|looking for (a )?(producer|beats)/i`.
- `redditSource: LeadSourceModule`: searches `r/MusicProducers+makinghiphop+beatsforsale` posts (public JSON endpoint) for "looking for beats" / "need a producer"; candidate per post author (`sourceId` = username, `url` = post permalink, `followers: null`, `signals: ['asks_for_beats']`).

- [ ] **Step 1: Write failing tests** on recorded fixtures with injected `fetchFn`: YouTube maps fixture to expected candidates (email from description only, none invented); quota exhaustion surfaces `QUOTA_MESSAGE` as a `SourceError`; Reddit yields one candidate per distinct author, dedupes repeat authors, always sets the `asks_for_beats` signal; an empty result returns `[]`; HTTP 429 raises a `SourceError` with a retry message.
- [ ] **Step 2: Run** `npx vitest run src/main/leads/sources` → FAIL.
- [ ] **Step 3: Implement** the modules and `smallChannels`; `leads:search(source, query)` calls the module then `addCandidates` and returns `{ added, duplicates }` or `{ error }`.
- [ ] **Step 4: Run** `npm test && npm run typecheck` → PASS.
- [ ] **Step 5: Commit** with `-m "feat(leads): YouTube and Reddit sources"`.

### Task 8: Keyed sources (SoundCloud, Audiomack, X) and Settings cards

**Files:**
- Create: `src/main/leads/sources/soundcloud.ts`, `audiomack.ts`, `x.ts` with matching `*.test.ts` and fixtures
- Modify: `src/main/ipc/business.ts` (`leads:setKey(name, value)`, `leads:keyStatus()` returning booleans only), preload, `types.ts`, `src/renderer/src/Settings.tsx` (a "Lead sources" section with one connect card per source)

**Interfaces:**
- Consumes: `SourceCtx`, `SourceError` (Task 7); `setSecret`/`getSecret`.
- Produces: `soundcloudSource`, `audiomackSource`, `xSource: LeadSourceModule`. Key names: `lead_key_soundcloud`, `lead_key_audiomack`, `lead_key_x`. With no key, `search` throws `SourceError('Connect <Source> in Settings to search it.')`.
- SoundCloud: users with tag/track search, keep `followers_count < 5000`. Audiomack: trending/search artists, keep small follower counts. X: recent-search for `"need beats" OR "looking for a producer"`, `signals: ['asks_for_beats']`. Confirm each service's current API terms and endpoints when implementing; if a service no longer offers API access to new developers, leave its card showing "unavailable" rather than scraping.

- [ ] **Step 1: Write failing tests** per source on fixtures: no key → the exact `SourceError` message; with a key, fixture maps to candidates; follower cap filter applied; keys never appear in returned data.
- [ ] **Step 2: Run** `npx vitest run src/main/leads/sources` → FAIL on the new files.
- [ ] **Step 3: Implement** the three modules and the Settings cards (password-type inputs, "saved" indicator from `leads:keyStatus`, no key echoed back).
- [ ] **Step 4: Run** `npm test && npm run typecheck` → PASS; then verify the Settings cards in the running app.
- [ ] **Step 5: Commit** with `-m "feat(leads): SoundCloud, Audiomack and X sources with key cards"`.

---

## Self-Review

- **Spec coverage:** import (T1, T4, T5), sources (T7, T8), scoring (T1), contact lookup (T6), CRM promotion (T2, T5), opt-out and suppression (T3), tables and migration (T2), errors per source (T7, T8), mockup gate (T5), phase 2 Gmail send intentionally absent.
- **Type consistency:** `LeadCandidate`, `Lead`, `LeadSourceModule`, `SourceCtx`, `SourceError` and preload names `leads*` are defined once and reused unchanged.
- **Review Focus:** email normalisation (T1, T2), null followers (T1), CSV edge cases (T1), handle/URL canonicalisation (T1), lookup failure modes (T6) each have a named test.
