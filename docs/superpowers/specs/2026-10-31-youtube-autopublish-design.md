# YouTube type-beat publisher: design

Date: 2026-10-31. Status: draft for review.

## Goal

Studio HQ studies successful YouTube type-beat channels, packages each of the producer's beats the way those channels do, and uploads the finished video to YouTube. Before anything is uploaded it asks the producer for the beat's BeatStars link and writes it into the description.

Success: from a beat in the Vault, the producer reviews one screen, pastes a BeatStars link, and ends up with a private (or scheduled) YouTube upload whose title, description, tags and hashtags read like the top channels in that beat's niche. The producer presses Publish in YouTube Studio.

## Decisions already made

- **Research sources:** the producer's seed channels plus per-artist discovery ("[artist] type beat", ranked by views per day).
- **Writing engine:** Claude API. It receives the Style Profile, real example videos and the beat profile. The existing template generator (`src/shared/typebeat.ts`) stays as the offline fallback.
- **Video:** the beat's audio over one static image for the full length. No visualizer, no camera drift.
- **Thumbnail:** the same raw image, untouched (cropped to 16:9 only if it is not already).
- **Images:** the producer supplies a folder. Each upload takes an image that has never been used. Duplicates are caught by image content, not file name.
- **Publishing:** the upload lands as private or scheduled. The producer presses Publish in YouTube Studio. (An unaudited YouTube API project cannot publish publicly; verify this against current YouTube policy during implementation. Applying for the audit is a possible later upgrade, out of scope here.)
- **Link gate:** a BeatStars link is required before upload.

## Non-goals

- Reusing other channels' images, artist photos or text overlays.
- TikTok or Instagram posting.
- Public auto-publishing.
- Text on the thumbnail.

## Components

### 1. Research and Style Profile (`src/main/ytresearch.ts`, `src/shared/styleProfile.ts`)

- **Inputs:** seed channel list (Settings), the beat's artist tags.
- **Fetching:** YouTube Data API v3. `search.list` finds top "[artist] type beat" videos; `videos.list` and `channels.list` fetch details. Videos are ranked by views per day since upload. Results are cached in SQLite and refreshed after 7 days.
- **Extraction (pure functions in `styleProfile.ts`):**
  - Title: length distribution, separators, bracket tags such as `[FREE]`, year presence, quoted beat name, artist-pair format, casing.
  - Description: line layout, position of the buy/download link, hashtag block, social lines.
  - Tags and hashtags: count, length, common phrases.
- **Output:** a Style Profile per artist and a global one from the seed channels, stored as JSON and shown in the UI with plain-language findings.
- **Quota budget:** 10,000 units per day by default. A search costs 100 and an upload 1,600. Research is capped (about 30 searches per day) so uploads are never starved. The app tracks units used today and refuses research that would break the reserve.

### 2. Beat profile (`src/shared/beatProfile.ts`)

Built from data the app already holds: BPM, key, genre, vibe and artist tags, plus Essentia energy and mood readings. A beat with no artist tag gets suggested artists from the closest researched profiles, and the producer confirms them.

### 3. Packaging with Claude (`src/main/ytpackage.ts`)

- Sends the Style Profile, up to 8 real example titles and descriptions from top videos, and the beat profile, and asks for title options, a description with a link placeholder, tags and hashtags.
- The system prompt forbids copying example text verbatim.
- Output is validated: title at most 100 characters, tags at most 500 characters, the placeholder present, no URLs other than the placeholder.
- The Anthropic API key is stored with Electron `safeStorage`, the same way as the Netlify token (`src/main/packs.ts`).
- If there is no key or the call fails, the app falls back to `generateCopy` and says so.

### 4. Image folder (`src/main/imagepool.ts`)

- Settings: image folder path.
- Each image is hashed on content (perceptual hash plus exact hash) and recorded in `yt_images` when used. A duplicate saved under another name or format is rejected.
- Selection: the next unused image, oldest file first.
- Warning when fewer than 5 unused images remain; upload is blocked (with a clear message) at zero.

### 5. Still video (`src/main/video.ts`, new "still" mode)

- Audio full length over the image, 1920x1080 H.264 plus AAC, 30 fps (or lower, since the frame never changes).
- The image is scaled and centre-cropped to 16:9 if needed. The same file, as JPEG at most 2 MB, is the thumbnail.

### 6. Publish flow (`src/main/youtube.ts`, new view in the renderer)

1. The producer picks a beat. The app selects the image, renders the video, and builds the package.
2. **Review screen:** video, image, title (with alternatives), description, tags and hashtags, all editable. The Style Profile findings are shown beside it.
3. **Link gate:** a required field for the BeatStars link. It must be an https URL on beatstars.com. The link replaces the placeholder at the position the research found.
4. **Upload:** resumable upload as private, or private with `publishAt` for a scheduled time. Then `thumbnails.set`.
5. **After upload:** the post is logged in the existing `posts` table (platform YouTube, link to the video), the calendar updates, and the app offers "Open in YouTube Studio".
6. The chosen image is marked used only after the upload succeeds, so a failed upload does not burn an image.

### 7. Authorisation

- Google OAuth for installed apps: loopback redirect with PKCE, scope `youtube.upload` plus read access for research.
- The producer creates a Google Cloud project, enables the YouTube Data API v3 and pastes the client ID (and secret, if Google issues one). The app documents the steps in the README.
- The refresh token is stored with `safeStorage`.

## Data model

New tables, added in `src/main/db.ts`:
- `yt_cache` (key, json, fetched_at): API responses.
- `yt_style` (scope, json, updated_at): Style Profiles.
- `yt_images` (hash, path, used_beat_id, used_at): image pool history.
- `yt_quota` (day, units): daily quota tracking.
- Uploaded videos reuse the `posts` and `videos` tables.

## Errors

- Quota exhausted: stop with a message that says when it resets; cached research still works.
- Auth expired or revoked: re-run the sign-in; nothing is lost.
- Upload interrupted: resume from the resumable upload URL; the image stays unused until success.
- No unused images, missing key, invalid BeatStars link: each blocks only the step it affects, with a plain message.

## Testing

- Unit tests for style extraction, title and description validation, link substitution and the duplicate-image check (pure functions).
- YouTube client tested against recorded API responses, with no live calls in the test suite.
- Manual check at the end: one real private upload, verified in YouTube Studio (title, description with BeatStars link, tags, thumbnail).

## Open items to verify during implementation

- Current YouTube policy on private-only uploads from unaudited API projects and the exact default quota.
- Whether `safeStorage` is available on the producer's machine (the app already depends on it for Netlify).
