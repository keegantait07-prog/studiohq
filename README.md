# Studio HQ

A local-first desktop app for your whole producer workflow. Built with Electron, React and SQLite. Runs on macOS.

**Status: Milestones 1–3 (Beat Vault, Pitch CRM, Sales & Collabs).** Later milestones add Content Machine, Sound Library, Feedback Links and the Daily Dashboard.

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

## Shortcuts

| Key | Action |
|---|---|
| ⌘1 / ⌘2 / ⌘3 | Beat Vault / Pitch CRM / Sales & Collabs |

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
```

Studio HQ never moves, renames or edits your audio and project files. The database only stores their paths and metadata. Nothing leaves your computer.

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
