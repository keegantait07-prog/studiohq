# Release Checklist Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a computed release checklist (Store, Video, Post, Pitch, Feedback, Splits, Sale) in the beat panel, each row with one button that opens the existing screen or dialog for that step.

**Architecture:** Pure per-step functions turn plain row data into a state and a one-line summary. `releaseFor(db, beatId)` gathers the rows for the beat's whole group and calls them. One IPC call returns the result; a new `ReleaseCard` renders it inside `Detail` for beats and calls the handlers `Detail` already receives. Nothing is stored.

**Tech Stack:** Electron 44, React 19, better-sqlite3, vitest (node environment, so renderer logic is tested as pure functions), TypeScript.

**Spec:** `docs/superpowers/specs/2026-11-10-release-checklist-design.md`

## Global Constraints

- No database changes, no new dependencies, no new automatic status changes.
- Everything is per song: all beats sharing `beats.group_id` count together.
- Step order is always `store, video, post, pitch, feedback, splits, sale`.
- States are exactly `todo | doing | done | na`. `total` counts steps that are not `na`; `done` counts steps that are `done`.
- Summary text is exactly as in the spec (reproduced in Task 1). Money: whole dollars without decimals, otherwise two decimals, with thousands separators (`$1,250`, `$29.99`).
- Loops and FL-project-only beats (`beat.ext === 'flp'`) keep today's panel; the card appears only for `kind === 'beat'` with audio.
- No restyle: new CSS appends a handful of rules that use existing tokens (`--line`, `--dim`, `--accent`, `--text`).
- `src/renderer/src/styles.css` has uncommitted user changes. Commit only this plan's lines: apply the same edit to the working file and to `git show HEAD:<file>`, then stage the HEAD-based result with `git hash-object -w --stdin` and `git update-index --cacheinfo`. Read a file fully before opening it for writing; take a copy of it first.
- Run `npm run typecheck && npm test` before every commit. Commit messages end with the attribution line from the current system reminder.

## Review Focus

1. **A different version of the beat holds the activity:** the selected file has no post, a sibling version does. Expected: the post counts. (Task 2)
2. **A database where `site_beats` does not exist yet** (Catalog never opened it). Expected: Store is `todo`, no error. (Task 2)
3. **A beat id that was deleted** while its panel was open. Expected: `releaseFor` throws `That beat no longer exists.`; the card shows its retry message. (Tasks 2, 5)
4. **A feedback comment whose `beat_index` is past the end of its link's beats** (link edited later). Expected: ignored, no crash, not counted. (Task 2)
5. **YouTube videos** (`videos.format = 'youtube'`). Expected: counted, and `youtube` appears in the summary's format list. (Task 2)

---

### Task 1: Release types and per-step functions

**Files:**
- Create: `src/main/release-steps.ts`, `src/main/release-steps.test.ts`
- Modify: `src/shared/types.ts` (add types after the `SplitGroup` line)

**Interfaces:**
- Produces, in `types.ts`: `type StepId = 'store' | 'video' | 'post' | 'pitch' | 'feedback' | 'splits' | 'sale'`; `type StepState = 'todo' | 'doing' | 'done' | 'na'`; `interface ReleaseStep { id: StepId; state: StepState; summary: string }`; `interface Release { beatId: number; groupId: number; steps: ReleaseStep[]; done: number; total: number }`.
- Produces, in `release-steps.ts` (no Electron/db imports), each returning a `ReleaseStep`:
  - `storeStep(r: { onSite: boolean; dirty: boolean; missing: boolean; soldExclusively: boolean; from: number | null })`
  - `videoStep(formats: string[])` — one entry per video record, oldest first
  - `postStep(posts: { status: 'planned' | 'private' | 'posted'; platform: Platform }[])`
  - `pitchStep(pitches: { contactId: number; status: PitchStatus }[])`
  - `feedbackStep(r: { links: number; unseen: number })`
  - `splitsStep(r: { hasCredits: boolean; parties: number; pub: number; master: number; sheetAt: number | null })`
  - `saleStep(sales: { price: number; exclusive: boolean }[])`
  - `buildRelease(beatId: number, groupId: number, steps: ReleaseStep[]): Release`
  - `money(n: number): string`

State and summary rules (exact):
- store: `soldExclusively` → `na`, `Sold exclusively`; else not `onSite` → `todo`, `Not on the store`; else `missing` → `doing`, `File missing`; else `dirty` → `doing`, `Changes not published`; else `done`, `Live · from $X` (`Live` when `from` is null).
- video: none → `todo`, `No video yet`; else `done`, `n video(s) · fmt1, fmt2` (distinct formats in first-seen order; `1 video`, `2 videos`).
- post: none → `todo`, `Nothing planned`; any `posted` → `done`, `n posted · TikTok, Instagram` (distinct platform labels from `PLATFORMS`, first-seen order); else `doing`, `n planned` (`planned` and `private` both count).
- pitch: none → `todo`, `Not pitched yet`; any status in `replied, liked, passed, placed` → `done`; else `doing`; summary `Pitched to n · m replied` where n = distinct contacts and m = distinct contacts with a responded status.
- feedback: `links` 0 → `todo`, `No feedback link`; `unseen` > 0 → `doing`; else `done`; summary `n link(s) · m new comment(s)` (`1 link`, `2 links`; `1 new comment`, `2 new comments`, `0 new comments`).
- splits: parties > 0 and both totals within 0.01 of 100 → `done`; parties > 0 otherwise → `doing`; summary `Publishing p% · Master m%` plus ` · sheet Mon D` when `sheetAt` is set (`toLocaleDateString('en-US', { month: 'short', day: 'numeric' })`). No parties and `hasCredits` → `todo`, `Not recorded`. No parties and no credits → `na`, `You own 100%`.
- sale: none → `todo`, `No sales yet`; else `done`, `n sale(s) · $total` plus ` · exclusive` when any is exclusive.

- [ ] **Step 1: Write failing tests** in `release-steps.test.ts`, one `test` per rule above with the exact summary strings, including: `videoStep(['vertical','vertical','youtube'])` → `3 videos · vertical, youtube`; `postStep([{status:'planned',platform:'tiktok'}])` → `doing`, `1 planned`; `postStep` with a posted tiktok and a posted instagram → `2 posted · TikTok, Instagram`; `pitchStep([{contactId:1,status:'sent'},{contactId:1,status:'listened'},{contactId:2,status:'passed'}])` → `done`, `Pitched to 2 · 1 replied`; `splitsStep({hasCredits:false,parties:0,pub:0,master:0,sheetAt:null})` → `na`; `splitsStep({hasCredits:true,parties:2,pub:60,master:100,sheetAt:null})` → `doing`; `saleStep([{price:1250,exclusive:true}])` → `1 sale · $1,250 · exclusive`; `money(29.99)` → `$29.99`; `buildRelease` with one `na` and one `done` step among 7 → `total` 6, `done` 1.
- [ ] **Step 2:** `npx vitest run src/main/release-steps.test.ts` → FAIL (module not found).
- [ ] **Step 3:** Implement the types and functions per the rules.
- [ ] **Step 4:** run → PASS; `npm run typecheck` clean.
- [ ] **Step 5:** Commit `feat(release): release steps and their summaries`.

### Task 2: `releaseFor` gathers a beat's group

**Files:**
- Create: `src/main/release.ts`, `src/main/release.test.ts`

**Interfaces:**
- Consumes: Task 1's functions; `fromPrice` from `./catalog-render`; `openDb` and `addBeat` (`./test-helpers`) in tests.
- Produces: `releaseFor(db: Database.Database, beatId: number): Release`. Throws `new Error('That beat no longer exists.')` for an unknown id.

Data sources (all by the beat's `group_id`, every version):
- Store: `site_beats` joined to `beats` for beats in the group; use the table only if it exists in `sqlite_master`. `onSite` = any row; `dirty` = any `site_beats.dirty = 1` (when the column exists); `missing` = any joined `beats.missing = 1`; `soldExclusively` = an exclusive sale for the group; `from` = `fromPrice` over `license_types` rows.
- Video: `videos` rows for beats in the group, `ORDER BY created_at, id`, `format` values.
- Post: `posts` rows for beats in the group.
- Pitch: `pitch_beats` joined to `pitches`, `contact_id` and `status`.
- Feedback: `packs` with `kind='feedback'` that have any group beat in `pack_beats` count as links. Unseen comments: `feedback_comments` with `seen = 0` whose `slug` matches such a link and whose `beat_index` indexes (beats of that pack ordered by `pack_beats.position`) a beat in the group; an out-of-range index is ignored.
- Splits: `beat_splits` for the group (`COUNT`, `SUM(pub_pct)`, `SUM(master_pct)`); `sheetAt` = `groups.split_sheet_at`; `hasCredits` = any beat in the group with non-empty `trim(credits)`.
- Sale: `sales` rows for the group.

- [ ] **Step 1: Failing tests** in `release.test.ts` (temporary db per test): 
  - `'a beat with no activity'`: steps `todo` for store, video, post, pitch, feedback, sale; splits `na`; `done` 0, `total` 6.
  - `'activity on another version of the same song counts'` (Review Focus 1): beats 1 and 2 share `groupId`; a posted post on beat 2 → asking about beat 1 gives post `done`.
  - `'works before Catalog has created site_beats'` (Review Focus 2): fresh `openDb`, store is `todo`, no throw.
  - `'a beat on the site is done, and doing when dirty or file missing'`: create the `site_beats` table the way `Catalog` does by constructing `new Catalog(...)` with `vi.mock('electron', ...)` as `catalog.test.ts` does, or by `CREATE TABLE` with the same columns; `done` after `dirty=0`; `doing`/`Changes not published` at `dirty=1`; `doing`/`File missing` with `beats.missing=1`.
  - `'an exclusive sale takes the beat off the store'`: store `na`, sale summary contains `exclusive`, `total` 5.
  - `'unknown beat'` (Review Focus 3): rejects with `That beat no longer exists.`.
  - `'youtube videos count'` (Review Focus 5): video rows with formats `vertical`, `youtube` → summary `2 videos · vertical, youtube`.
  - `'feedback'`: a `packs` row `kind='feedback'` with `pack_beats` for the beat and two `feedback_comments` (one `seen=0`) → `doing`, `1 link · 1 new comment`; mark seen → `done`; a comment with `beat_index` 5 on a one-beat pack is ignored (Review Focus 4).
  - `'pitch and splits'`: a `pitches` + `pitch_beats` row with status `placed` → `done`; `beat_splits` rows 60/100 with credits set → `doing`.
- [ ] **Step 2:** run → FAIL. **Step 3:** implement `releaseFor`. **Step 4:** run → PASS; typecheck.
- [ ] **Step 5:** Commit `feat(release): compute a beat's release from the whole song`.

### Task 3: IPC and bridge

**Files:**
- Modify: `src/main/store.ts` (add `releaseFor(id: number): Release` that calls `releaseFor(this.db, id)`), `src/main/ipc/library.ts` (handler `release:get`), `src/preload/index.ts`, `src/shared/types.ts` (`StudioApi.releaseGet(beatId: number): Promise<Release>`)

- [ ] **Step 1:** Add the `Store` method, the handler `h('release:get', (_, id: number) => c.store.releaseFor(id))`, the preload line `releaseGet: (id) => ipcRenderer.invoke('release:get', id)`, and the `StudioApi` entry.
- [ ] **Step 2:** `npm run typecheck && npm test` → PASS (no new test: the logic is covered in Task 2; this is wiring).
- [ ] **Step 3:** Commit `feat(release): release status over IPC`.

### Task 4: Button mapping (pure)

**Files:**
- Create: `src/renderer/src/releaseUi.ts`, `src/renderer/src/releaseUi.test.ts`

**Interfaces:**
- Consumes: `ReleaseStep`, `Status` from `@shared/types`.
- Produces: `type StepAction = 'store' | 'content' | 'pitch' | 'feedback' | 'splits' | 'sale'`; `rowButton(step: ReleaseStep, beatStatus: Status, soldExclusively: boolean): { label: string; action: StepAction; disabled: boolean } | null`; `STEP_LABEL: Record<StepId, string>` with `Store, Video, Post, Pitch, Feedback, Splits, Sale`.

Rules: `null` when `step.state === 'na'`. Store → action `store`, label `Put on the store` when `todo`, else `Manage`. Video and Post → action `content`, label `Make video, titles and tags…` when `todo`, else `Open Content…`. Pitch → `pitch`, `Pitch this beat…`; when `beatStatus === 'sold'` label `Sold. Can’t pitch`, disabled. Feedback → `feedback`, `Get timestamped feedback…`. Splits → `splits`, `Add splits` when `todo`, else `Edit splits`. Sale → `sale`, `Log a sale…`; when `soldExclusively` label `Sold exclusively`, disabled. All other cases not disabled.

- [ ] **Step 1:** Failing tests, one per rule, including `rowButton({id:'sale',state:'done',summary:''}, 'sold', true)` → `{ label: 'Sold exclusively', action: 'sale', disabled: true }` and `rowButton({id:'store',state:'na',summary:''}, 'finished', false)` → `null`.
- [ ] **Step 2:** `npx vitest run src/renderer/src/releaseUi.test.ts` → FAIL. **Step 3:** implement. **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat(release): which button each row shows`.

### Task 5: ReleaseCard in the beat panel

**Files:**
- Create: `src/renderer/src/ReleaseCard.tsx`
- Modify: `src/renderer/src/Detail.tsx` (lines ~186-229: the `SiteCard` line and the Pitched to, Sales, Splits and Content blocks), `src/renderer/src/styles.css` (append `.rel-*` rules, staged per the Global Constraints)

**Interfaces:**
- Consumes: `releaseGet`, `rowButton`, `STEP_LABEL`; `SiteCard` (unchanged); `Detail`'s existing props `pitchedTo`, `sales`, `splitGroup`, `posts`, `onPitch`, `onLogSale`, `onEditSplits`, `onSheet`, `onContent`, `onFeedback`, `onOpenContact`.
- Produces: `ReleaseCard(p: { beat: BeatDetail; pitchedTo: { pitch: Pitch; contact: string; response: '' | 'liked' | 'passed' }[]; sales: Sale[]; splitGroup?: SplitGroup; posts: Post[]; reloadKey: string; on: Record<StepAction, () => void>; onSheet: () => void; onOpenContact: (id: number) => void })` exported from `ReleaseCard.tsx`.

Behaviour:
- Loads `window.api.releaseGet(beat.id)` when `beat.id` or `reloadKey` changes, when the window regains focus, and after any row button is pressed. A result for a beat that is no longer the selected one is discarded (use a cancelled flag in the effect).
- Header `Release · d of t done`. Each row: state mark (`✓` done, `●` doing, `○` todo, `–` na), `STEP_LABEL`, the summary, and the `rowButton` (none when `na`). `done` and `doing` marks use `var(--accent)`; `todo` and `na` use `var(--dim)`.
- Rows for store, pitch, sale and splits expand on click (`clickable`, `aria-expanded`): store shows `<SiteCard beat={beat} />`; pitch shows today's contact list (contact, date, status with ♥/✕); sale shows today's sales list; splits shows the totals line and the Split sheet PDF button, enabled only when both totals are within 0.01 of 100. These blocks are today's markup moved out of `Detail`.
- Load failure: show `Couldn't load the release status.` and a Retry button; the rest of the panel is unaffected.
- In `Detail.tsx`: when `kind === 'beat'` and `beat.ext !== 'flp'`, render `ReleaseCard` where the `SiteCard` was and omit the Pitched to, Sales, Splits and Content blocks. `reloadKey` is `[beat.id, beat.status, sales.length, pitchedTo.map((p) => p.pitch.status).join(','), posts.map((p) => p.status).join(','), splitGroup?.parties, splitGroup?.pubTotal, splitGroup?.masterTotal, splitGroup?.sheetAt].join('|')`. The `on` map: `store` toggles the Store row open; `content` → `onContent`; `pitch` → `onPitch`; `feedback` → `onFeedback`; `splits` → `onEditSplits`; `sale` → `onLogSale`. For `kind === 'loop'` nothing changes.
- CSS: `.rel-head`, `.rel-row` (grid `18px 64px 1fr auto`, `min-height: 34px`, bottom border `var(--line)`), `.rel-mark`, `.rel-body` (indented expansion). Nothing else.

- [ ] **Step 1:** Write `ReleaseCard.tsx` and edit `Detail.tsx`. `npm run typecheck && npm test` → PASS.
- [ ] **Step 2:** Verify in the running app on a copy of the library (see Task 6 for the procedure) — a beat with a pitch, a post and a sale, and one with nothing: header count, every row's summary, each expansion, each button opens the right dialog, a sold beat's Pitch and Sale buttons are disabled.
- [ ] **Step 3:** Commit `feat(release): release checklist in the beat panel`.

### Task 6: Check it in the app, document it

**Files:**
- Modify: `README.md` (a short "Release checklist" paragraph in the beat panel/Vault section)

- [ ] **Step 1:** Make a read-only copy of the library (`sqlite3` backup into the session scratchpad) and run `STUDIO_HQ_DATA_DIR=<copy> STUDIO_HQ_NETLIFY_API=http://127.0.0.1:9 npm run dev`. Never run against the real library. Check Task 5's list in Pearl, then the other themes the window lets you reach, and report any you could not.
- [ ] **Step 2:** README paragraph: what the rows mean, that it is computed per song, and that loops keep the old panel.
- [ ] **Step 3:** `npm run typecheck && npm test && npm run build` → all pass. Commit `docs(release): document the release checklist`.
