# Studio HQ

A local-first desktop app for your whole producer workflow. Built with Electron, React and SQLite. Runs on macOS.

**Status: all five milestones (Beat Vault, Pitch CRM, Sales & Collabs, Content Machine, and Sound Library + Feedback links + Dashboard).** Planned next: Sound Library, Feedback Links and the Daily Dashboard.

## Setup

Requirements: macOS, Node 20+ (tested on Node 24).

```bash
cd ~/Desktop/StudioHQ
npm install        # also rebuilds SQLite for Electron
npm run dev        # run with hot reload
npm start          # build, then run the production bundle
```

If `npm install` finishes but Electron won't launch with "Electron uninstall", run `node node_modules/electron/install.js` once.

On first launch Studio HQ watches `~/Desktop/! BEATS` and looks for FL projects in `~/Documents/Image-Line/FL Studio/Projects`. Change both in **Settings (⌘,)**.

## Install as a Mac app

```bash
npm run dist                 # builds release/mac-arm64/Studio HQ.app
./scripts/install-app.sh     # copies it to ~/Applications and signs it there
```

Then open **Studio HQ** from Launchpad, Spotlight, or `~/Applications` (drag it to the Dock or into `/Applications` if you like). It uses the same data as the dev version, so nothing needs importing. To update after changing the code, run the two commands again.

- The app is built for Apple Silicon and signed locally (ad-hoc), which is fine for running it on the Mac that built it. It isn't notarized, so a copy sent to another Mac would need right-click → Open the first time.
- The install script copies to `~/Applications` instead of signing in place because this project may sit in iCloud-synced Desktop/Documents, where macOS keeps adding file attributes that break code signing.
- macOS will ask once for access to Desktop, Documents and any external drives; say yes so it can read your beats, projects and sound folders.

## FL Studio plugin

`plugin/` holds **Studio HQ Bridge**, a VST3/AU plugin for FL Studio: put it on the Master track to **bounce your beat straight into the Vault** (named with FL's tempo, so the BPM comes through) and to **browse and audition your sounds and each project's MIDI** from inside FL. Build and install with `cd plugin && ./build.sh`; details in [`plugin/README.md`](plugin/README.md).

## FL projects show up as beats

Every FL Studio project in your project folders appears in the **Vault** as a beat, even before you've exported audio, so a new beat never goes missing. They're marked **FL project**, start as **WIP** (which also feeds the Dashboard's "close to finished" list), and pick up BPM, key and tags from the project's file name.

- **When it looks for new projects:** every time Studio HQ starts, whenever you switch back to the app (at most once a minute), every 3 minutes while it's open, and on demand with **Rescan FL projects** in the Vault toolbar.
- **How far back:** projects saved in the last **30 days** (Settings → *FL projects as beats*; 0 shows everything). Templates are skipped.
- **When you export a bounce:** it links to its project (by name, or with *Link .flp…*), and the project-only entry disappears, so there are no duplicates.
- A project with no audio can't be played, pitched, sold, posted or sent for feedback yet. Everything else (status, tags, notes, *Open in FL*) works.
- FL 26.1 changed how projects are stored: Studio HQ still finds those projects' samples, but can't read their MIDI yet.

## What M1 does

- **Folder watching.** Every audio file (mp3, wav, flac, m4a, aif, ogg) in your beat folders is imported, and new bounces appear once they finish writing. Renamed or moved files are re-matched by size and date, so your tags and status survive. `Backup/` folders and folders named "ideas"/"scraps" are skipped (toggle in Settings).
- **BPM and key.** Read from the filename if present (`(148bpm, C#min)`), otherwise detected from the audio with Essentia. Detected values are marked in the detail panel, and low-confidence BPMs show in amber. Edit any value, or use ×2 / ÷2 for half-time and double-time. Your edits are never overwritten by re-analysis.
- **Waveform and player.** Peaks are cached, so waveforms draw instantly. Click the waveform to seek.
- **Tags and status.** Vibe, genre and type-beat artist tags. Status: idea → wip → finished → sent → sold. Genre tags come from your folder names and from `(Trap, Dark)` at the start of filenames.
- **Versions.** Files with the same cleaned title (`v1`, `v2`, `final`, `stems`, `(empty)`, `(normal. mix)`) are grouped. The table shows the best version with a "N versions" badge, and the detail panel lists all of them.
- **FL project links.** Each bounce is matched to an `.flp` by name. Guesses show their confidence. Use **Open in FL** to launch the project, **Change** to pick a different one, or **×** to unlink.
- **Search.** Type clauses separated by commas, for example `dark, 140+ bpm, unsold, finished`.

| Clause | Meaning |
|---|---|
| `140+` or `140+ bpm` | BPM at least 140 |
| `120-140` | BPM range |
| `<90` | BPM at most 90 |
| `140 bpm` | BPM within ±1.5 |
| `finished`, `wip`, `idea`, `sent`, `sold` | status |
| `unsold`, `unsent`, `unfinished` | status exclusions |
| `Cm`, `F#`, `key:Bb minor` | key |
| anything else | text match on title, tags, folder, credits |

## What M2 does (Pitch CRM)

Open it from the sidebar or with **⌘2** (⌘1 returns to the Vault).

- **Contacts.** Artists, managers, A&Rs and others, each with email, their sound, links, notes and an optional per-person follow-up interval.
- **Pitch log.** Every pitch records who got which beats, when, how it was sent, and their response. Each beat in a pitch can be marked ♥ liked or ✕ passed. Status: sent → listened → replied → liked / passed / placed. The Vault's detail panel shows "Pitched to" for each beat.
- **Follow-up reminders.** A pitch with no reply gets a follow-up date (default 7 days, set in Settings, overridable per contact). Due follow-ups show a badge on the sidebar, a "Follow-ups due" list in the CRM, and one macOS notification per day (toggle in Settings). Each due pitch has **Draft follow-up**, **Snooze 3d / 7d** and **They replied**.
- **New pitch.** Pick a contact, pick beats (the search box accepts the same syntax as the Vault, and beats already sent to that person are flagged), choose a template, then continue. Logging a pitch marks the beats "sent" in your Vault, unless they are already sold.
- **Private listening page.** Optionally builds a page with your intro, a waveform player per beat, BPM and key. Audio is a 128 kbps MP3 preview, never your WAV. The page has no tracking and no external requests.
- **Email templates.** *First pitch* and *Follow-up* are included and editable under CRM → Templates. Placeholders such as `{{name}}`, `{{beats}}`, `{{link}}` and `{{days}}` fill in automatically, and a line containing `{{link}}` is dropped when there is no page. Studio HQ doesn't send email: **Open in Mail** creates a draft in your mail app, or copy the text.

### Publishing pages to Netlify

1. In Netlify: User settings → Applications → *New access token*.
2. In Studio HQ: Settings → Netlify, paste the token. It's stored encrypted with the macOS Keychain (macOS may ask permission once).
3. The next pitch with "Create a private listening page" publishes it and gives you a link.

Pages go to one Netlify site that Studio HQ creates for you, each under a random unguessable path with `noindex` headers. The link is **unlisted, not password-protected**: anyone who has the link can listen. Every publish sends the whole local `pitch-site` folder, so existing links keep working, and only new or changed files are uploaded.

## What M3 does (Sales & Collabs)

Open it from the sidebar or with **⌘3**.

- **Sales log.** Record every lease and exclusive: beat, buyer, license, price, fees, source (BeatStars, PayPal, Venmo, Cash App, Zelle, other), date and notes. Edit or delete any sale, and **Export CSV** for your accountant or taxes. BeatStars has no sales API Studio HQ can use, so log those by hand for now.
- **Never double-sell.** Logging an exclusive marks the beat, and every version of it, as **sold**, and from then on:
  - no further sale of that beat can be logged (the dialog shows the lock and disables saving),
  - its status can't be changed away from "sold",
  - it can't be added to a pitch, and any new version file that appears later is marked sold too.
  
  The one exception is a **back-dated** lease from before the exclusive, so you can record history. If an exclusive was a mistake, delete that sale and the beat goes back to "finished".
  Non-exclusive leases don't change a beat's status, so "unsold" in search means "no exclusive sale".
- **Licenses.** Starter license types (MP3, WAV, Trackout, Unlimited, Exclusive) with placeholder prices. Edit them under Sales & Collabs → Licenses. Past sales keep the license name they were sold under.
- **Splits and collaborators.** For any beat, record who worked on it with role, email, PRO and IPI, a **publishing %** and a **master %** (the master follows publishing until you change it). Splits apply to all versions of a beat. Totals must be exactly 100% in both columns before a sheet can be made.
- **Split sheet PDF.** One click creates a Letter-size PDF with the work, date, a table of everyone's shares, agreement text, and a signature and date line per person. This is a record of what you agreed, not legal advice. Saving a changed split clears the "sheet made" marker, so you know the PDF is out of date.
- **Revenue dashboard.** Monthly revenue (leases and exclusives stacked), plus top beats, top buyers (repeat buyers flagged) and revenue by source, with a gross / net-of-fees toggle and last-12-months / this-year / all-time ranges. A "Show table" button gives the same data as a table.
- In the Vault, each beat's detail panel shows its sales and splits, and Cmd+K also finds sales by buyer or beat.

## What M4 does (Content Machine)

Open it from the sidebar or with **⌘4**.

- **Video export.** Pick a beat and Studio HQ makes an MP4 with cover art, an animated audio visualizer and your title. Choose **vertical 1080×1920** (TikTok, Reels, Shorts), **horizontal 1920×1080** (YouTube), or both at once. H.264 + AAC, 30 fps. A 30-second clip takes a few seconds, and a full 2½-minute beat in both formats took about 70 seconds on this machine.
- **Looks.** Three designs (Classic, Minimal, Poster), three visualizer styles (mirror bars, bars, waveform line), an accent color, and editable title, second line and footer. The preview is the real frame from the exporter; only the visualizer there is a stand-in that moves with the music in the export.
- **Clip picker.** Click the waveform to choose the start, pick 15–90 seconds or the full beat, or hit **Best section** to jump to the loudest stretch (snapped to a bar line when the tempo is known). "Play from here" auditions it.
- **Cover art.** Uses your chosen image, otherwise artwork embedded in the audio file, otherwise a colored placeholder with the beat's initials. Choose or remove art per beat. Your files are never modified.
- **Titles & tags.** For a beat with type-beat artists, it writes five YouTube-style titles (with a 100-character counter), a description with your store link and email, up to 500 characters of YouTube tags, and a TikTok/Reels caption with hashtags. Add the artists a beat sounds like, set your store link, email and default hashtags in Settings, and everything fills in. These are text templates built from your tags, not AI-written.
- **Posts and calendar.** Log where each beat has been posted (TikTok, Instagram Reels, YouTube, Shorts) with date and link, or plan posts ahead. The calendar shows posted (solid), planned (outlined) and overdue (dashed) posts; drag a post to reschedule. The sidebar badge counts overdue planned posts.
- **What to post next.** Per platform, ranks your finished beats: never-posted and recent beats first, ones with artists and a ready video get a boost, and it skips sold beats, anything posted on that platform in the last 14 days, and anything already planned there. "Plan it" books the next free day.

Videos are saved to `~/Movies/Studio HQ` by default (change it in Settings). Studio HQ doesn't post to Instagram or TikTok for you yet: export the video, post it, then log it here.

## What M5 does

### Daily Dashboard (⌘0, the home screen)
- **Studio session timer.** Start and stop a session; a running session also shows in the sidebar. Optionally turn on *Time sessions automatically while FL Studio is open* and Studio HQ starts and stops a session when FL launches and quits. Sessions under a minute are discarded.
- **Beat-making streak.** A day counts when you bounce a beat or log 15+ minutes in the studio. The heat map covers the last 15 weeks and is built from your bounces' dates, so it fills in with your history immediately. Today doesn't break a streak until the day is over.
- **Weekly goals** (Monday to Sunday): beats made, pitches sent, posts published. Click a goal number to change it. A beat counts as "made" in the week of its first bounce, so extra versions don't count twice.
- **Today's list:** follow-ups due, beats you've marked WIP (with a *Mark finished* button), finished beats never pitched or posted (with *Pitch* and *Video* buttons), posts planned for today or overdue, and new feedback comments.

### Sound Library (⌘5)
- **Scans your sound folders** (default `~/Desktop/!DRUM KITS`; change in Settings). About 18,000 files take roughly 10 seconds. Files are never moved or modified.
- **Auto-sorts** each sound into kick, snare, clap, hat, perc, 808, bass, loop, melody, vocal, fx or other from its file and folder names, and picks up BPM and key from loop names.
- **Search and filter** by text, type, one-shots or loops, favorites, and folder (a collapsible folder tree). Click any column header to sort.
- **Instant preview.** Click a sound, or move with ↑↓, and it plays right away with its waveform. Space replays, **L** loops, **F** toggles favorite. Select several (⌘-click, Shift-click, ⌘A) to tag or favorite them together.
- **Drag into your DAW.** Drag one or many rows straight out of the app into FL Studio.
- **Find duplicates.** Compares files byte for byte (only files of identical size are even read), shows each group, and moves the ones you tick to the **Trash** (so they can be put back). Nothing is ticked until you choose; it can tick all but one copy per group for you, and always keeps one.

### FL projects: each project's own sounds and MIDI
Studio HQ reads every `.flp` in your project folders (skipping FL's `Backup` folders) and gives each project its own section under **Sound Library → FL projects**:
- **Samples:** every audio file the project uses. If a project points at a file that has moved, it's matched by file name against your library; ones that can't be found anywhere are listed so you know what's missing.
- **MIDI:** the notes from each pattern's piano roll are exported as a `.mid` file (one track per instrument, named after the channel and pattern), so you can drag a melody or chord progression from an old project into a new one.
- A beat linked to its project in the Vault shows a *Samples & MIDI from this project* button. MIDI files are saved in `~/Library/Application Support/Studio HQ/FL project MIDI/` and refreshed when a project changes.
- Limits: MIDI has no audio preview (drag it into FL to hear it); only piano-roll patterns are exported, not the playlist arrangement; FL 2026 projects don't store their tempo in a place I could read, so MIDI uses the linked beat's BPM or 120 (FL ignores a MIDI file's tempo on import anyway); a few older or unusual projects can only be read partly.
- MIDI packs inside your sound folders (tens of thousands of files) are **not** indexed unless you tick *Also index MIDI files inside my sound folders* in Settings.

### Feedback links (⌘6)
Send an artist a private link to a beat (from the Vault, *Get timestamped feedback…*, or the Feedback screen). They listen, press **Comment at 0:42**, and write a note. Comments appear in the app pinned to the waveform; click a comment's time to hear that moment (it starts 2 seconds early). Resolve comments as you go.
- Comments are collected with **Netlify Forms** and pulled into the app every 5 minutes, or on *Sync now*, with a macOS notification for new ones. The link is unlisted, not password-protected, and visitors need no account.
- **Netlify's free plan allows 100 form submissions a month** for your whole site, so heavy feedback may need a paid plan.
- Needs the same Netlify token as pitch pages (Settings). Without it, the page is built locally for preview, but comments only work on a published link.
- Tested end to end against a mock of Netlify's forms API (a real page posting real comments, then syncing them into the app). It hasn't been run against a live Netlify account.

## Shortcuts

| Key | Action |
|---|---|
| ⌘0 | Dashboard |
| ⌘1 / ⌘2 / ⌘3 / ⌘4 | Beat Vault / Pitch CRM / Sales & Collabs / Content |
| ⌘5 / ⌘6 | Sound Library / Feedback |

| Key | Action |
|---|---|
| ⌘K | Search everything / commands |
| `/` or ⌘F | Focus search |
| ↑ ↓ | Move selection |
| Space | Play / pause |
| Enter | Play selected |
| ← → (Shift for 15s) | Seek |
| 1–5 | Set status (idea, wip, finished, sent, sold) |
| G | Toggle version grouping |
| ⌘, | Settings |

## Where your data is stored

Everything is in one folder. Contacts, pitches, sales, splits, templates and settings live in the same database as your beats, so one backup covers them all (the Netlify token is stored encrypted inside it).

```
~/Library/Application Support/Studio HQ/
  studio-hq.db       # your library: beats, tags, statuses, notes, links, settings
  backups/           # snapshots made by "Back up now"
  pitch-site/        # the pitch pages and MP3 previews that get published
  pitch-cache/       # cached MP3 previews, safe to delete
  FL project MIDI/   # MIDI made from your FL projects' patterns (rebuilt automatically)
```

Exported videos live outside this folder (default `~/Movies/Studio HQ`), so they are not in the database backup.

Studio HQ never moves, renames or edits your audio and project files. The database only stores their paths and metadata. Nothing leaves your computer except the pitch pages you choose to publish to your Netlify site.

## Backing up

1. **In the app:** Settings → *Back up now* (or File → Back Up Database Now). A consistent snapshot is saved to `backups/`.
2. **Manually:** quit the app, then copy `studio-hq.db` (and `studio-hq.db-wal` / `-shm` if present). Or point Time Machine at `~/Library/Application Support/Studio HQ`.
3. **Restore:** quit the app and replace `studio-hq.db` with a backup copy.

Your audio is not part of the backup. It stays in your own folders, so back those up as you already do.

## Known limits (M1)

- FL Studio `.flp` files are a closed format, so BPM and key come from the bounce, not the project.
- Beat-detection can pick half or double tempo (common on trap and DnB). The amber warning and ×2 / ÷2 buttons cover this.
- Version groups are automatic. A manual "move to group" control isn't built yet.
- Netlify publishing was tested against a mock of the Netlify API, not yet against a live account. If it fails, the error is shown in the pitch dialog and the page is still built locally.
- The app is run from source for now (`npm run dev`). Packaging as a `.app` comes at the end.

## What is new in 2.0

- **Smart collections.** Save any search to the sidebar (kept in the app, per machine). New search words: `nobpm`, `nokey`, `untagged`, `needsinfo`, `stale` (WIP untouched 30+ days), `noloop`, and Camelot codes such as `8A`.
- **Camelot keys and "Plays well with".** The detail panel shows the Camelot code and lists up to 8 beats in the same or a neighbouring key (and relative major/minor) with a tempo within 6%, or half/double.
- **Catalog health** on the dashboard, with a score and one-click jumps to the beats that need attention.
- **CSV export** of beats and sales (Settings, Your data).
- Everything from the FL work: Save to Studio HQ, preview loops, MP3-only bounces, the new look.
