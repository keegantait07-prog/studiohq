# Studio HQ

A local-first desktop app for your whole producer workflow. Built with Electron, React and SQLite. Runs on macOS.

**Status: Milestone 1 (Beat Vault).** Later milestones add Pitch CRM, Sales & Collabs, Content Machine, Sound Library, Feedback Links and the Daily Dashboard.

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

## Shortcuts

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

Everything is in one folder:

```
~/Library/Application Support/Studio HQ/
  studio-hq.db       # your library: beats, tags, statuses, notes, links, settings
  backups/           # snapshots made by "Back up now"
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
- The app is run from source for now (`npm run dev`). Packaging as a `.app` comes at the end.
