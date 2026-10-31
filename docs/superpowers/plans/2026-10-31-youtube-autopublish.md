# YouTube Type-Beat Publisher Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Studio HQ studies top YouTube type-beat channels, packages a beat the same way, renders it over an unused still image, asks for the BeatStars link, and uploads it to YouTube as private or scheduled.

**Architecture:** All logic that can be tested lives in `src/shared/` as pure functions (style extraction, ranking, quota, prompt building, validation, image hashing, upload metadata). `src/main/` modules are thin: they own fetch, files, SQLite, ffmpeg and Electron, and take `fetch` as a parameter so they can be tested against recorded responses. One `YtPublisher` class orchestrates; one new sub-tab in the Content view is the UI.

**Tech Stack:** Electron 44, React 19, better-sqlite3, ffmpeg-static (already used), YouTube Data API v3 (OAuth, loopback + PKCE), Anthropic Messages API over `fetch`, vitest (new, dev only).

**Spec:** `docs/superpowers/specs/2026-10-31-youtube-autopublish-design.md`

## Global Constraints

- Title at most 100 characters. Tags at most 500 characters in total (existing code budgets 480). Thumbnail is JPEG, 16:9, at most 2 MB. Video is 1920x1080 H.264 + AAC.
- BeatStars link must be `https://` on host `beatstars.com` or `www.beatstars.com` (exact host match, never a substring match). It is required before any upload.
- Upload is `privacyStatus: "private"`; a scheduled upload also sets `publishAt` (ISO 8601). Nothing is ever uploaded as public.
- API quota: 10,000 units/day. Costs: search 100, list 1, upload 1,600, thumbnail set 50. Research may use at most 3,000 units/day (about 30 searches); uploads may use the rest.
- Research cache lifetime 7 days. At most 8 example videos go into a packaging prompt. Warn when fewer than 5 unused images remain; block at zero.
- Secrets (Google client secret and refresh token, Anthropic key) are stored with Electron `safeStorage`, base64 in the `settings` table, as `src/main/packs.ts` does for the Netlify token.
- An image is marked used only after the upload succeeds.
- Claude must not copy example text verbatim. Output may contain no URL except the link placeholder `{{BEATSTARS_LINK}}`.
- Follow existing style: TypeScript, no semicolons, single quotes, two-space indent, `Row = Record<string, any>` for SQLite rows.
- `src/shared/` and `src/renderer/` import with `@shared/...`; `src/main/` uses relative `../shared/...`.
- Commit messages end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

## Review Focus

Spec-implied inputs that no spec section tests directly, most likely first:
- A pasted BeatStars link that is padded with spaces, uses `http://`, carries tracking parameters, or is a lookalike (`beatstars.com.evil.com`, `evilbeatstars.com`): trimmed and accepted only when exact host matches; lookalikes rejected. (Task 7.)
- The same picture saved twice as PNG and as a resized JPEG, or a non-image, zero-byte or tiny file in the folder: the copy is treated as used; junk files are skipped without crashing. (Task 8.)
- A beat with no artist tags: gets suggested artists to confirm; packaging never emits "undefined Type Beat". (Task 6.)
- Claude returns malformed JSON, a 140-character title, a stray URL or a missing placeholder: rejected by validation, one retry, then template fallback. (Task 7.)
- A beat that exists only as an FL project (no audio file): publish is refused with a plain message before any image is consumed. (Task 11.)

---

## File Structure

Create:
- `vitest.config.ts`: test runner config with the `@shared` alias.
- `src/shared/ytTypes.ts`: `YtVideo`, `StyleProfile`, `BeatProfile`, `PackageDraft`, `PublishDraft`, `YtStatus`, `LINK_PLACEHOLDER`.
- `src/shared/styleProfile.ts`: Style Profile extraction and plain-language description.
- `src/shared/ytQuota.ts`: ranking by views per day and quota rules.
- `src/shared/beatProfile.ts`: beat profile and artist suggestion.
- `src/shared/ytPackage.ts`: prompt, validation, link substitution, fallback copy.
- `src/shared/imagePool.ts`: difference hash, duplicate test, next-image choice.
- `src/shared/ytUpload.ts`: upload metadata.
- `src/shared/ytAuth.ts`: PKCE and OAuth URL helpers.
- `src/main/ytauth.ts`: OAuth loopback sign-in, token storage and refresh.
- `src/main/ytresearch.ts`: YouTube API client for research with cache and quota.
- `src/main/ytpackage.ts`: Anthropic call.
- `src/main/imagepool.ts`: folder scan, hashing glue, 16:9 crop, thumbnail JPEG.
- `src/main/stillvideo.ts`: ffmpeg still-image export.
- `src/main/youtube.ts`: resumable upload and thumbnail.
- `src/main/ytpublisher.ts`: orchestration class `YtPublisher`.
- `src/renderer/src/YouTubePublish.tsx`: the publish sub-tab.
- `src/shared/*.test.ts`: one test file beside each shared module.

Modify: `package.json`, `src/main/db.ts`, `src/main/store.ts` (settings defaults), `src/shared/types.ts` (`Settings`, `Api`), `src/main/index.ts` (IPC), `src/preload/index.ts`, `src/renderer/src/Content.tsx`, `src/renderer/src/Settings.tsx`, `README.md`.

---

### Task 1: Test harness

**Files:**
- Create: `vitest.config.ts`, `src/shared/typebeat.test.ts`
- Modify: `package.json`

**Interfaces:**
- Produces: `npm test` runs every `src/**/*.test.ts` under Node with `@shared` resolving to `src/shared`.

- [ ] **Step 1: Add vitest.** Run `npm install -D vitest` (take the release that supports Vite 8). Add script `"test": "vitest run"`.
- [ ] **Step 2: Write `vitest.config.ts`** with `test.include = ['src/**/*.test.ts']`, `test.environment = 'node'`, and `resolve.alias = { '@shared': <abs path of src/shared> }`.
- [ ] **Step 3: Write the smoke test** `typebeat.test.ts`: `generateCopy` with artist `['future']`, producer profile, `{ free: true, year: 2026 }` returns `titles[0]` that starts with `[FREE] Future Type Beat 2026` and `tags` whose joined length is at most 480.
- [ ] **Step 4: Run** `npm test`. Expected: 1 passed.
- [ ] **Step 5: Commit** `test: add vitest harness`.

---

### Task 2: Types, schema and settings

**Files:**
- Create: `src/shared/ytTypes.ts`
- Modify: `src/main/db.ts`, `src/shared/types.ts` (`Settings`), `src/main/store.ts` (`DEFAULTS`)

**Interfaces:**
- Produces (in `ytTypes.ts`):
```ts
export const LINK_PLACEHOLDER = '{{BEATSTARS_LINK}}'
export interface YtVideo { id: string; channelId: string; channelTitle: string; title: string; description: string; tags: string[]; publishedAt: string; views: number }
export interface StyleProfile {
  scope: string            // 'global' or an artist name, lower-case
  sample: number
  title: { medianLength: number; bracketRate: Record<string, number>; yearRate: number; quotedNameRate: number; pairRate: number; separators: Record<string, number>; casing: 'title' | 'lower' | 'upper' | 'mixed'; emojiRate: number }
  description: { medianLines: number; linkLine: number; hashtagBlockRate: number; medianHashtags: number }
  tags: { medianCount: number; medianChars: number; top: string[] }
  hashtags: { medianCount: number; top: string[] }
  examples: { title: string; description: string }[]
}
export interface BeatProfile { title: string; bpm: number | null; key: string | null; genre: string[]; vibe: string[]; artist: string[]; energy: 'low' | 'medium' | 'high' | null }
export interface PackageDraft { titles: string[]; description: string; tags: string[]; hashtags: string[]; source: 'claude' | 'template' }
export interface YtStatus { signedIn: boolean; hasClientId: boolean; hasAnthropicKey: boolean; encryptionOk: boolean; imagesLeft: number | null; quotaToday: number }
export interface PublishDraft { beatId: number; imageHash: string; imagePath: string; videoPath: string; thumbPath: string; artists: string[]; package: PackageDraft; styleFindings: string[] }
```
- `Settings` gains `ytSeedChannels: string[]` (a channel name, `@handle`, YouTube URL or channel ID per entry), `ytImageFolder: string`, `ytClientId: string`. Defaults: `ytSeedChannels = ['BuJaa BEATS', 'Soulker', 'CashMoneyAP', 'Fat Cat Beats', 'Profetesa Beats']` (the producer's own list; their subscriber counts and styles were supplied by the producer and are not verified), `ytImageFolder = ''`, `ytClientId = ''`.
- New tables in `db.ts` (`CREATE TABLE IF NOT EXISTS`): `yt_cache(key TEXT PRIMARY KEY, json TEXT NOT NULL, fetched_at INTEGER NOT NULL)`, `yt_style(scope TEXT PRIMARY KEY, json TEXT NOT NULL, updated_at INTEGER NOT NULL)`, `yt_images(hash TEXT PRIMARY KEY, path TEXT NOT NULL, beat_id INTEGER, used_at INTEGER)`, `yt_quota(day TEXT NOT NULL, kind TEXT NOT NULL, units INTEGER NOT NULL, PRIMARY KEY(day, kind))`. (The spec's `yt_quota(day, units)` gains `kind` so research and upload budgets are tracked separately.)

- [ ] **Step 1:** Add the types file, the tables, the three settings and defaults.
- [ ] **Step 2: Run** `npm run typecheck`. Expected: no errors.
- [ ] **Step 3: Commit** `YouTube publisher: types, tables and settings`.

---

### Task 3: Style Profile extraction

**Files:**
- Create: `src/shared/styleProfile.ts`, `src/shared/styleProfile.test.ts`

**Interfaces:**
- Consumes: `YtVideo`, `StyleProfile`.
- Produces: `buildStyleProfile(videos: YtVideo[], scope: string): StyleProfile` and `describeProfile(p: StyleProfile): string[]`.

- [ ] **Step 1: Write the failing tests** with a fixture of 4 videos (3 titled `[FREE] Future Type Beat 2026 - "Name" | Dark Trap`, one lowercase variant; descriptions with the first URL on line 1, `#typebeat #future #trap` last):
  - `bracketRate['[FREE]'] === 0.75`
  - `yearRate === 1`, `quotedNameRate === 0.75`
  - `separators[' | ']` is the most frequent separator
  - `description.linkLine === 1`, `hashtagBlockRate === 1`, `hashtags.medianCount === 3`
  - `tags.top` contains `'future type beat'`, and `examples.length <= 8`, sorted as given
  - empty input returns a profile with `sample === 0` and zeroed rates (no NaN)
  - `describeProfile` includes a line containing `75%` and `[FREE]`
- [ ] **Step 2: Run** `npx vitest run src/shared/styleProfile.test.ts`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement** both functions. Extraction rules: bracket tags are `[...]`/`(...)` tokens at title start; separators counted from the set ` | `, ` - `, ` ~ `, ` // `; pair title = contains ` x ` between two words before `Type Beat`; casing is the most common of the four classes; link line is the median 1-based line of the first `https?://` per description; hashtags are `#\w+` tokens. Medians use the lower middle for even counts.
- [ ] **Step 4: Run** the file. Expected: PASS.
- [ ] **Step 5: Commit** `Style Profile extraction`.

---

### Task 4: Ranking and quota rules

**Files:**
- Create: `src/shared/ytQuota.ts`, `src/shared/ytQuota.test.ts`

**Interfaces:**
- Produces:
```ts
export const COST = { search: 100, list: 1, upload: 1600, thumbnail: 50 } as const
export const DAILY = 10000, RESEARCH_CAP = 3000
export function viewsPerDay(v: Pick<YtVideo, 'views' | 'publishedAt'>, now: number): number
export function rankByVelocity(vs: YtVideo[], now: number): YtVideo[]
export function quotaAllows(used: { research: number; upload: number }, cost: number, kind: 'research' | 'upload'): boolean
```

- [ ] **Step 1: Write the failing tests:** a video of 1,000 views published 10 days before `now` is `100` views/day; a video published in the future or the same instant counts as one day (no divide-by-zero); `rankByVelocity` orders descending without mutating the input; `quotaAllows({research: 2950, upload: 0}, 100, 'research') === false`; `quotaAllows({research: 0, upload: 8400}, 1600, 'upload') === true` and with `upload: 8401` is `false`; research is also refused when `research + upload + cost > DAILY`.
- [ ] **Step 2: Run** the file. Expected: FAIL.
- [ ] **Step 3: Implement** the functions and constants.
- [ ] **Step 4: Run** the file. Expected: PASS.
- [ ] **Step 5: Commit** `Ranking and quota rules`.

---

### Task 5: Google sign-in and research client

**Files:**
- Create: `src/shared/ytAuth.ts`, `src/shared/ytAuth.test.ts`, `src/main/ytauth.ts`, `src/main/ytresearch.ts`

**Interfaces:**
- Consumes: `COST`, `quotaAllows`, `rankByVelocity`, `YtVideo`.
- Produces (shared): `makePkce(): { verifier: string; challenge: string }` (S256, base64url, verifier 43-128 chars); `buildAuthUrl(o: { clientId: string; redirectUri: string; challenge: string; state: string }): string` with scopes `https://www.googleapis.com/auth/youtube.upload` and `https://www.googleapis.com/auth/youtube.readonly`, `access_type=offline`, `prompt=consent`.
- Produces (main): class `YtAuth { constructor(db, getClientId: () => string)`; `status(): { signedIn: boolean; hasClientId: boolean }`; `signIn(): Promise<void>` (loopback server on a random port, `shell.openExternal`, 3-minute timeout, validates `state`); `signOut(): void`; `accessToken(fetchFn = fetch): Promise<string>` (refreshes when within 60 s of expiry; `invalid_grant` clears the token and throws `Error('Google sign-in expired. Sign in again.')`); `setClientSecret(s: string | null): void` }`.
- Produces: class `YtResearch { constructor(db, auth: YtAuth, fetchFn = fetch)`; `discover(artist: string, now = Date.now()): Promise<YtVideo[]>` (search `"${artist} type beat"`, `order=viewCount`, `maxResults=25`, then `videos.list` for statistics and snippet, ranked by velocity, top 15); `fromChannels(channels: string[], now?): Promise<YtVideo[]>` (resolve each entry to a channel ID, cached permanently in `yt_cache`: a `UC...` ID is used as is; a `youtube.com/@x`, `/user/x` or `/channel/x` URL or a bare `@handle` goes through `channels.list` with `forHandle`, `forUsername` or `id` at 1 unit; a plain name such as "Soulker" goes through `search.list type=channel` at 100 units and takes the top hit whose title matches case-insensitively, else the entry is skipped with a warning shown in Settings. Then read the uploads playlist, newest 25 each, ranked); `profileFor(artist: string): Promise<StyleProfile>` (cache 7 days in `yt_cache`/`yt_style`, falls back to the global profile if the search quota is spent); `quotaToday(): number` }`. Every call adds its cost to `yt_quota` before it is made and throws `Error('Research quota for today is used up. Cached research still works.')` if `quotaAllows` is false.

- [ ] **Step 1: Write the failing tests** for `makePkce` (challenge equals base64url SHA-256 of verifier, no `=`, `+` or `/`) and `buildAuthUrl` (contains both scopes, `code_challenge_method=S256`, the given state).
- [ ] **Step 2: Run** the file. Expected: FAIL.
- [ ] **Step 3: Implement** `ytAuth.ts`, then `main/ytauth.ts` and `main/ytresearch.ts` as specified. Parse API errors into plain messages (`quotaExceeded` => the quota message above; 401/403 => sign in again).
- [ ] **Step 4: Run** the file and `npm run typecheck`. Expected: PASS, no errors.
- [ ] **Step 5: Manual check of the seed list:** `fromChannels` with the five default names resolves all five to channels whose titles match (name resolution costs 5 searches, 500 units, once, then cached); anything that resolves to a different channel is corrected in Settings by entering its URL.
- [ ] **Step 6: Manual check:** with a client ID configured, run sign-in from a scratch script via `npm run dev`, confirm the browser consent page opens and `status().signedIn` becomes true. Record the result in the commit message.
- [ ] **Step 7: Commit** `Google sign-in and YouTube research client`.

---

### Task 6: Beat profile and artist suggestion

**Files:**
- Create: `src/shared/beatProfile.ts`, `src/shared/beatProfile.test.ts`

**Interfaces:**
- Consumes: `BeatProfile`, `StyleProfile`, the beat's `thumb: number[]` (48 low-band peaks, 0..1).
- Produces: `beatProfile(b: { title: string; bpm: number | null; key: string | null; tags: { vibe: string[]; genre: string[]; artist: string[] }; thumb: number[] }): BeatProfile` and `suggestArtists(b: BeatProfile, known: { artist: string; genre: string[]; bpmRange: [number, number] }[], limit?: number): string[]` (default limit 3).
- Energy rule: mean of `thumb` below 0.25 is `'low'`, above 0.5 is `'high'`, else `'medium'`; empty `thumb` gives `null`. (The spec said Essentia energy and mood; the app stores only BPM, key and a waveform summary, so energy is derived from that summary and there is no mood.)
- Suggestion rule: score by shared genre tags plus 1 if the beat's BPM falls inside the artist's range; ties keep input order; artists already on the beat are excluded.

- [ ] **Step 1: Write the failing tests:** energy for `thumb` all 0.1 / 0.4 / 0.7 / `[]`; `suggestArtists` for a trap beat at 140 BPM returns the trap artist whose range includes 140 first; a beat that already has `['future']` never returns `'future'`; no matching artists returns `[]` (not undefined entries).
- [ ] **Step 2: Run** the file. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the file. Expected: PASS.
- [ ] **Step 5: Commit** `Beat profile and artist suggestions`.

---

### Task 7: Packaging (prompt, validation, link gate, Claude call)

**Files:**
- Create: `src/shared/ytPackage.ts`, `src/shared/ytPackage.test.ts`, `src/main/ytpackage.ts`

**Interfaces:**
- Consumes: `BeatProfile`, `StyleProfile`, `PackageDraft`, `LINK_PLACEHOLDER`, `generateCopy` (`src/shared/typebeat.ts`).
- Produces (shared):
```ts
export function buildPrompt(beat: BeatProfile, style: StyleProfile, producer: string): { system: string; user: string }
export function parsePackage(raw: string): PackageDraft | null          // JSON only; null if invalid shape
export function validatePackage(p: PackageDraft, exampleTitles: string[]): string[]   // list of problems, [] = ok
export function validateBeatstarsUrl(input: string): { ok: true; url: string } | { ok: false; reason: string }
export function fillLink(description: string, url: string): string
export function fallbackPackage(beat: BeatProfile, producer: string, year: number): PackageDraft
```
- Produces (main): `async function packageBeat(o: { beat: BeatProfile; style: StyleProfile; producer: string; apiKey: string | null; year: number }, fetchFn = fetch): Promise<PackageDraft>`: POST `https://api.anthropic.com/v1/messages` with model `claude-sonnet-5-5`, `max_tokens` 2000, headers `x-api-key` and `anthropic-version: 2023-06-01`; on invalid output retry once with the problems listed; then return `fallbackPackage` with `source: 'template'`.

Validation rules: every title at most 100 characters and non-empty; at least 3 titles; tags joined by commas at most 480 characters; description contains `LINK_PLACEHOLDER` exactly once; no `http://` or `https://` anywhere in title, description, tags or hashtags; no title equal (case-insensitive) to any example title. `validateBeatstarsUrl` trims, requires protocol `https:` and hostname exactly `beatstars.com` or `www.beatstars.com`, keeps the original query string, and gives a reason string otherwise. `fillLink` replaces the placeholder with the URL. The prompt tells Claude to return JSON `{ titles, description, tags, hashtags }` and never to copy example text.

- [ ] **Step 1: Write the failing tests:**
  - `validateBeatstarsUrl('  https://www.beatstars.com/beat/x-123?utm=1 ')` is ok with the trimmed URL; `http://beatstars.com/x`, `https://beatstars.com.evil.com/x`, `https://evilbeatstars.com/x`, `https://youtube.com/x`, `''` and `not a url` are all not ok.
  - `validatePackage` flags a 101-character title, a description missing the placeholder, a description with two placeholders, an extra `https://` URL, 481 characters of tags, and a title equal to an example.
  - `parsePackage` returns null for prose, for JSON missing `titles`, and for JSON wrapped in a code fence it still parses (strip a leading fence).
  - `fillLink` leaves no placeholder behind.
  - `fallbackPackage` for a beat with no artists contains no `undefined` and has the placeholder in its description.
  - `buildPrompt` user text includes the beat's BPM and the profile's bracket finding, and at most 8 examples.
- [ ] **Step 2: Run** the file. Expected: FAIL.
- [ ] **Step 3: Implement** the shared functions, then `packageBeat`. `fallbackPackage` wraps `generateCopy` and appends the placeholder as the first description line.
- [ ] **Step 4: Run** the file and `npm run typecheck`. Expected: PASS, no errors.
- [ ] **Step 5: Commit** `Packaging with Claude and the BeatStars link gate`.

---

### Task 8: Image pool

**Files:**
- Create: `src/shared/imagePool.ts`, `src/shared/imagePool.test.ts`, `src/main/imagepool.ts`

**Interfaces:**
- Produces (shared): `dHash(gray: Uint8Array): string` (input is a 9x8 grayscale buffer, 72 bytes; output 16 hex chars); `hamming(a: string, b: string): number`; `isDuplicate(hash: string, used: string[], maxDistance = 4): boolean`; `pickNext(files: { path: string; mtime: number; hash: string }[], used: string[]): { path: string; hash: string } | null` (oldest `mtime` first, skipping duplicates, and skipping duplicates among the candidates themselves).
- Produces (main): class `ImagePool { constructor(db, folder: () => string)`; `scan(): Promise<{ next: { path: string; hash: string } | null; unused: number; total: number }>` (extensions jpg, jpeg, png, webp; hashes through `nativeImage` resized to 9x8 grayscale; unreadable, zero-byte or smaller than 640x360 images are skipped); `prepare(path: string, outDir: string): { framePath: string; thumbPath: string }` (centre-crop to 16:9, scale to 1920x1080, thumbnail JPEG quality lowered in steps until at most 2 MB); `markUsed(hash: string, path: string, beatId: number): void` }`.

- [ ] **Step 1: Write the failing tests:** `dHash` of a left-to-right ramp differs from its inverse and is stable across calls; a copy with every pixel +3 brightness has `hamming <= 4`, so `isDuplicate` is true; two unrelated buffers have `hamming > 4`; `pickNext` returns the oldest unused file, returns null when all are used, and does not return both of two near-identical candidates across successive calls once the first hash is in `used`.
- [ ] **Step 2: Run** the file. Expected: FAIL.
- [ ] **Step 3: Implement** both files.
- [ ] **Step 4: Run** the file and `npm run typecheck`. Expected: PASS, no errors.
- [ ] **Step 5: Commit** `Image pool with duplicate detection`.

---

### Task 9: Still-image video

**Files:**
- Create: `src/main/stillvideo.ts`, `src/shared/ytUpload.ts`, `src/shared/ytUpload.test.ts`

**Interfaces:**
- Produces (main): `exportStill(o: { audioPath: string; framePath: string; outPath: string; durationSec: number }, onProgress: (pct: number) => void): Promise<string>`, using ffmpeg: `-loop 1 -framerate 2 -i frame -i audio -c:v libx264 -tune stillimage -preset veryfast -crf 20 -pix_fmt yuv420p -r 30 -vf scale=1920:1080 -c:a aac -b:a 192k -shortest -movflags +faststart`. Progress from `-progress pipe:1` `out_time_ms` divided by duration. Rejects with ffmpeg's last error line on a non-zero exit.
- Produces (shared, in `ytUpload.ts`): `buildUploadMetadata(p: { title: string; description: string; tags: string[]; hashtags: string[]; publishAt?: Date }): object` returning the `videos.insert` body: `snippet { title, description (hashtags appended on a final line), tags, categoryId: '10' }` and `status { privacyStatus: 'private', selfDeclaredMadeForKids: false, publishAt? }`.

- [ ] **Step 1: Write the failing tests** for `buildUploadMetadata`: `privacyStatus` is always `'private'`; `publishAt` appears as an ISO string only when given; hashtags are appended to the description as one `#a #b` line; `madeForKids` is false; tags are passed through unchanged.
- [ ] **Step 2: Run** `npx vitest run src/shared/ytUpload.test.ts`. Expected: FAIL, then implement it and expect PASS.
- [ ] **Step 3: Implement `exportStill`.**
- [ ] **Step 4: Verify the encode:** with a real beat and a 1920x1080 image run `exportStill` from a scratch script; `ffprobe` (or `ffmpeg -i`) shows 1920x1080 H.264 and AAC, and the duration equals the audio length within 0.1 s. The file plays in QuickTime.
- [ ] **Step 5: Commit** `Still-image video export and upload metadata`.

---

### Task 10: YouTube upload

**Files:**
- Create: `src/main/youtube.ts`

**Interfaces:**
- Consumes: `YtAuth.accessToken`, `buildUploadMetadata`, `COST`.
- Produces: `async function uploadVideo(o: { auth: YtAuth; videoPath: string; thumbPath: string; metadata: object }, onProgress: (pct: number) => void, fetchFn = fetch): Promise<{ videoId: string; studioUrl: string }>`: resumable session (`POST https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status`), 8 MiB chunks with `Content-Range`, resume by querying the session after a network error (up to 5 attempts), then `thumbnails.set`. `studioUrl` is `https://studio.youtube.com/video/${videoId}/edit`. Errors are plain: `uploadLimitExceeded`/`quotaExceeded` => "YouTube's daily upload quota is used up. Try again after midnight Pacific time."; 401 => sign in again.

- [ ] **Step 1: Implement** as specified.
- [ ] **Step 2: Run** `npm run typecheck`. Expected: no errors.
- [ ] **Step 3: Manual check:** upload a 10-second test video as private, confirm in YouTube Studio that it is Private with the title, description, tags and thumbnail set, then delete it in Studio.
- [ ] **Step 4: Commit** `YouTube resumable upload and thumbnail`.

---

### Task 11: Publisher orchestration and IPC

**Files:**
- Create: `src/main/ytpublisher.ts`
- Modify: `src/shared/types.ts` (`Api`), `src/main/index.ts`, `src/preload/index.ts`

**Interfaces:**
- Consumes: everything above, plus `Store.getBeat`, `Store.getSettings`, `Content.savePost`.
- Produces: class `YtPublisher { constructor(db, store, content, auth, research, pool)`:
  - `status(): Promise<YtStatus>`
  - `prepare(beatId: number, artists: string[], onProgress: (label: string, pct: number) => void): Promise<PublishDraft>`. It throws `Error('This beat only exists as an FL project. Export a bounce first.')` before touching any image when the beat has no playable audio file; throws `Error('Add images to your image folder first.')` when none are unused; builds the beat profile, the style profile (artist profile, falling back to global), the package, the image frame and thumbnail and the video.
  - `publish(draft: PublishDraft, edits: { title: string; description: string; tags: string[]; hashtags: string[]; link: string; publishAt?: number }): Promise<{ videoId: string; studioUrl: string }>`. It rejects with the `validateBeatstarsUrl` reason when the link is bad, before any network call; fills the link, uploads, and only then calls `pool.markUsed` and `content.savePost` (platform `'youtube'`, status `'posted'` or `'planned'` when scheduled, `url` the watch URL).
  - `suggestArtists(beatId: number): number-free string[]` wrapper over Task 6 using the cached artist profiles.
- IPC channels: `yt:status`, `yt:suggestArtists`, `yt:prepare` (progress on `yt:progress`), `yt:publish`, `yt:signIn`, `yt:signOut`, `yt:setSecret` (`{ kind: 'google' | 'anthropic', value: string | null }`), `yt:chooseImageFolder`, `yt:openStudio`. Add each to `Api` and `preload`.

- [ ] **Step 1:** Add the `Api` entries and preload bindings; `npm run typecheck` fails on the missing handlers.
- [ ] **Step 2: Implement** `YtPublisher` and register handlers in `registerIpc`.
- [ ] **Step 3: Run** `npm run typecheck`. Expected: no errors.
- [ ] **Step 4: Commit** `YouTube publisher orchestration and IPC`.

---

### Task 12: Settings and Publish view

**Files:**
- Create: `src/renderer/src/YouTubePublish.tsx`
- Modify: `src/renderer/src/Content.tsx` (add sub-tab `'youtube'`, label "YouTube"), `src/renderer/src/Settings.tsx`, `src/renderer/src/styles.css`

**Interfaces:**
- Consumes: the `Api` from Task 11, `ContentView` props.
- Produces: `YouTubePublish({ beat, settings, toast, reload })`.
- Settings section "YouTube": seed channels (add/remove list), image folder chooser with "N unused images" and a low-folder warning under 5, Google client ID field with a "Sign in" / "Sign out" button, client secret and Anthropic key fields (write-only, show "Saved" when present), and a quota line "N of 10,000 units used today".
- Publish view states: **1 Pick artists** (the beat's artist tags as editable chips, plus suggested ones to accept when there are none) -> **2 Preparing** (progress label from `yt:progress`) -> **3 Review** (video preview, image, title options as radio buttons with the chosen title editable, description, tags and hashtags editable, "What the research found" list from `styleFindings`, a note when the template fallback was used) -> **4 BeatStars link** (required field with inline validation reason; Upload is disabled until valid; optional schedule date-time) -> **5 Done** ("Uploaded as private. Open YouTube Studio to publish." with an Open button). Errors show as inline messages and never discard the draft.

- [ ] **Step 1: Implement** the Settings section and the view.
- [ ] **Step 2: Run** `npm run typecheck`. Expected: no errors.
- [ ] **Step 3: Verify in the app** with `npm run dev`: Upload stays disabled with an empty, `http://`, and `https://beatstars.com.evil.com/x` link and enables with `https://www.beatstars.com/beat/test-1`; closing and reopening the view keeps Settings values; a beat that is only an FL project shows the plain refusal message.
- [ ] **Step 4: Commit** `YouTube publish view and settings`.

---

### Task 13: Docs and end-to-end check

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Document** under a new "What M6 does (YouTube publisher)" heading: the Google Cloud setup steps (create a project, enable YouTube Data API v3, create an OAuth client of type Desktop, paste the client ID and secret), the image folder, the seed channels, the Anthropic key, the private-only behaviour and the daily quota.
- [ ] **Step 2: Verify the spec's open items:** check current YouTube policy on private-only uploads from unaudited projects and the default quota, and correct the README and Global Constraints if either differs.
- [ ] **Step 3: End-to-end:** with one real beat, an image folder of at least 3 images and a real BeatStars link, run the full flow. Confirm in YouTube Studio: private, correct title and description with the BeatStars link in the researched position, tags, thumbnail equal to the video frame. Confirm the image is now listed as used, a second run picks a different image, and the post appears on the Content calendar.
- [ ] **Step 4: Run** `npm test && npm run typecheck`. Expected: all pass.
- [ ] **Step 5: Commit** `YouTube publisher docs`.
