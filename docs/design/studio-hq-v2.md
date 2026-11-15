# Studio HQ V2 proposal

> **Status, 6 November 2026:** rolled back at the owner's request. The app is back to the 5 November look and six original themes, with only the Phase 0 fixes kept (branch `classic-look`). The later themes, Stage, 3.0 and Content Pack are kept on branch `v3-archive`.

**Date:** 6 November 2026
**Replaces:** `docs/design/v2-proposal.md`, which is left in place. That draft never ran the app, and three of its calls are reversed here (section 9).
**Naming:** `package.json` is already `2.0.0`, and the What's New flag is `2.0`. This release should ship as **3.0**. "V2" below means the redesign.

## How this was reviewed

| Area | Method |
|---|---|
| Whole app | Ran the production build against a sanitised copy of your database. Walked all 13 views and 8 themes, took 46 screenshots, and measured idle CPU, text sizes, hit targets and font coverage |
| Real usage | Read-only counts from your live database |
| Security, data, frontend, UX, audio and video, market | One specialist review each. The highest-severity claims were then checked against the source |
| Baseline | `tsc` clean, 385 of 385 tests passing across 35 files |

Audio figures were measured on your real library. Scale figures come from a synthetic 25k-row database.

**Not tested:** real render speed in frames per second, GPU cost of the themes, live Netlify, live YouTube upload, drag into FL, and behaviour during playback. Security findings come from reading code, not from running exploits.

---

## 1. The verdict

Studio HQ is well engineered and has a rare asset: it sees your audio, your FL projects, your plugins and your business records in one place. Almost nothing connects them, though. It's twelve good tools sharing a sidebar, and it can't answer the only question that matters on a working day: **what should I do with this beat next?**

Your own data shows the problem:

| What you do | Rows | What you don't do | Rows |
|---|---|---|---|
| Beats in the library | 130 (105 "finished") | Contacts | **0** |
| Plugin actions | 226 (201 removals) | Pitches | **0** |
| YouTube posts | 5 posted, 5 planned | Sales | **0** |
| Videos exported | 15 | Splits | **0** |
| FL projects indexed | 158 | Feedback comments, studio sessions | **0** |

105 beats are "finished" and none has been recorded as sent or sold. About a third of the sidebar has never held data. The likely causes are friction and missing imports, not poor features: pitching three artists takes about 27 actions and three trips to Mail, and BeatStars sales have to be typed by hand.

**V2 in one line: stop being a set of tools you visit, and become a line your beats move along, with the app doing the logging for you.**

---

## 2. Fix first: bugs that are live today

These are independent of the redesign and should ship this week. Items marked ✔ were confirmed in the source by hand.

### Can lose or misrepresent your data

| # | Problem | Where |
|---|---|---|
| 1 ✔ | **Restore can corrupt the database.** The DB is never closed on quit, so a `-wal` file can survive. The README's restore replaces only the `.db`, and SQLite could then replay the old log over your backup | `src/main/index.ts:293`, README |
| 2 ✔ | **Plugin bounces delete the WAV** once the MP3 exists, so those beats can't fill the WAV leases the app sells. MP3-only was a deliberate choice for the Vault (commit `e1b2beb`), so the fix archives the WAV outside it. `loopToMp3` deletes its WAV even when conversion failed | `src/main/bounce.ts:18,31` |
| 3 | **An unplugged drive looks like deletion.** A swallowed read error removes project rows and their MIDI within 3 minutes, and marks every sound missing | `src/main/flpindex.ts:37,58`, `sounds.ts:104,126` |
| 4 | **Files renamed while the app is closed lose their metadata.** Tags, status and pitches stay on a dead row | `src/main/watcher.ts:40`, `store.ts:200` |
| 5 | **Six orphaned `pitch_beats` rows are waiting to attach to your next pitches.** `pitches.id` isn't AUTOINCREMENT, so your first three pitches reuse ids 1 to 3 and inherit those beats | Live DB, `src/main/db.ts` |
| 6 | **Deleting a contact erases their pitch history.** Project cleanup cascades through posts, videos and drafts | `src/main/db.ts:118`, `cleanup.ts:104` |
| 7 | **"Never double-sell" has holes.** A lease can be redated past an exclusive. No database constraint enforces one exclusive per beat. Sold beats stay public on the catalog. Two different beats titled "Ghost" merge and share a lock | `sales.ts:65`, `packs.ts:68`, `catalog.ts`, `filename.ts:75` |
| 8 | **A crash during upload can duplicate a YouTube video** and spend 1,600 quota units again | `src/main/ytpublisher.ts:124`, `youtube.ts:35` |

### Wrong answers shown as facts

| # | Problem | Evidence |
|---|---|---|
| 9 | **BPM detector throws away the right answer.** On disagreement it takes the half-time estimate | 3 of 13 wrong on your beats (159 read as 79.5). The fix is a small octave comparison at `analyze.worker.ts:87` |
| 10 | **Key detection is wrong about 4 times in 10 and looks certain.** Strength is discarded | 38 of 62 exact against your filename keys (an earlier sample read 17 of 31). The `edmm` profile reaches 50 of 62. `analyze.worker.ts:97` |
| 11 | **No loudness handling anywhere.** Videos carry the raw master | Your beats range from −7.5 to −27.5 LUFS. Your last upload's source peaks at +4.9 dBTP, so it is likely clipping |
| 12 | **New bounces default to `finished`,** so the word only means a file exists. Pressing `5` marks a beat sold with no sale | `store.ts:225`, `App.tsx:382` |
| 13 | **Version blindness.** Pitches and posts match by file, sales by group, so another version of a pitched beat reads as never pitched | `App.tsx:225`, `Dashboard.tsx:106` |
| 14 | **Split sheets can print "100.%"** on a legal PDF from float maths (8.5% of sampled three-way splits). Money is also stored as floats | `splitsheet.ts:6,19`, `db.ts:155` |

### Broken features

| # | Problem | Where |
|---|---|---|
| 15 ✔ | **A bad refactor rewrote text to `c.videos` and `c.sales`.** Reveal throws on `FROM c.videos`, the export picker asks "Where should c.videos be saved?", and the CSV defaults to `Studio HQ c.sales.csv` | `src/main/ipc/content.ts:66,70`, `business.ts:44` |
| 16 | **Pitch CRM dead end.** Once a contact is selected, Overview and the due list can't be reached until restart | `Crm.tsx:91` |
| 17 | **Backdrop click throws away a built pitch** | `PitchDialog.tsx:84` |
| 18 | **Scheduled YouTube posts stay "planned", then badge as overdue.** Your 4 overdue posts aren't this: they have no links, so they're plans you made by hand. Private uploads count as posted | `ytpublisher.ts:130` |
| 19 | **Your custom video isn't what gets uploaded.** The YouTube flow always renders a new still-image video | `ytpublisher.ts:103` |

### Security

No remote exploit was found, and prompt injection can't get a write past the assistant's approval gate. Fix in this order:

1. ✔ **Narrow the navigation lock.** `isAppUrl` accepts any `file://` URL and there's no global drop guard, so dragging an `.html` file from a sample pack onto the window might load it with the app's bridge attached. The drop behaviour is inferred, not tested. Match the exact index URL and block drops.
2. ✔ **Validate IPC in main.** `settings:set` merges any key, so a compromised renderer could set `claudePath` and have it spawned. `projectPath` and `draft.videoPath` are also trusted.
3. **Turn the sandbox on.** It's two flags (`index.ts:73`, `video.ts:97`), and the preload needs nothing from Node. The earlier draft said work had to move into main. It doesn't.
4. **Update Electron** to 44.9.1 or later (certificate advisory), and replace the 2023 ffmpeg, which parses third-party audio automatically and unsandboxed.
5. **Show full values on assistant approval cards.** They're cut to 80 characters and hide fields.

Also add single-instance protection (`requestSingleInstanceLock` is missing), which guards the database against a second copy of the app.

---

### Phase 0 status

Done, uncommitted: items 1 to 6, 8 to 11, 13 and 15 to 19, the security items 1 to 4 except the ffmpeg replacement, automatic daily backups, and in-app restore. The `5` key can no longer mark a beat sold.

Not done, with where each one belongs:

- **Item 7, partly.** The date, constraint, catalog and pitch holes are closed. Two different beats titled "Ghost" still share a group, which needs the project IDs in Phase 2.
- **Item 12, partly.** New bounces still default to `finished`, because `unreviewed` only makes sense with the Inbox lane in Phase 3.
- **Item 14, partly.** Split totals and printing are fixed. Money is still stored as floats, which is a Phase 2 migration.
- **ffmpeg.** `ffmpeg-static` 5.3.0 is the newest release, so replacing the 2023 binary means choosing another source.
- **Later:** full values on approval cards, IPC sender checks, and backups off this disk that include covers and previews.

---

## 3. The new model: one beat, four tracks

The old status ladder (idea, wip, finished, sent, sold) is the root design flaw. A beat is pitched, posted and leased **at the same time**, and a lease doesn't end its life. So a pipeline of single statuses and a Kanban board would both be wrong.

V2 gives every beat four parallel tracks, **derived from events rather than set by hand**:

| Track | Question it answers | Fed by |
|---|---|---|
| **Finish** | Is it done? | Bounces, your review, loudness and sample checks |
| **Pitch** | Who has heard it? | Pitches, replies, listens |
| **Post** | Where is it live? | Videos, uploads, schedule |
| **Sell** | What is it promised to? | Leases, exclusives, splits, placements |

A new `unreviewed` state replaces the false "finished". Sold can only come from a sale. Every record attaches to the **beat**, so all versions share its history.

### Surfaces

Twelve destinations become six. The earlier Make/Send/Sell/Maintain grouping is dropped: it only re-sorted the same twelve items, and your main jobs cross all those groups.

| Surface | Key | What it is |
|---|---|---|
| **The Line** | ⌘1 | Home. Lanes: Inbox, Ready, Out, Earning. Each card shows its one next action. Calendar and table are alternate modes |
| **Beat Sheet** | Space | One page per beat, opened in place: waveform, versions, tracks, pitches, comments, posts, sales, splits. Pitch, video, YouTube and sale all dock inside it, so you stop being thrown between views |
| **People** | ⌘2 | Who's due, then each person's full history: pitches, purchases, comments |
| **Ledger** | ⌘3 | Sales, revenue, splits owed, rights |
| **Crate** | ⌘4 | Sound Library with the kit rack docked, so kits are built where you browse |
| **Rig** | ⌘5 | Plugins, project cleanup, crash watch, with a health badge |

Beats and Loops become a toggle on the Line. Stage becomes a transport mode, Sonic Map a Line mode, and the Assistant a docked panel. A **Jobs tray** in the transport shows every export, upload and deploy with cancel, and it survives switching views.

```
┌────────┬─────────────────────────────────────────────────────┐
│  Line  │ Since you left: 2 bounces · 1 reply · $40 · 3 due   │
│ People ├────────────┬────────────┬────────────┬───────────────┤
│ Ledger │  INBOX 3   │  READY 12  │  OUT 41    │  EARNING 6    │
│ Crate  │ ┌────────┐ │ ┌────────┐ │ ┌────────┐ │ ┌───────────┐ │
│ Rig    │ │glo gang│ │ │Retrov. │ │ │Corrupt │ │ │Lemonade   │ │
│        │ │Review  │ │ │Post it │ │ │Follow  │ │ │Split owed │ │
│        │ └────────┘ │ └────────┘ │ └────────┘ │ └───────────┘ │
├────────┴────────────┴────────────┴────────────┴───────────────┤
│ ▶ transport · audition · A/B · jobs tray 2 running            │
└───────────────────────────────────────────────────────────────┘
```

The lanes are structure a theme can own: order tickets on a rail in Yatai, ledger pages in Gilded Ruin, a flash sheet in Thorn.

### What each job becomes

| Job | Today | V2 |
|---|---|---|
| New bounce to pitched to 3 artists | About 27 actions, 3 Mail trips, 3 publishes | **Send Run:** pick beats, tick ranked artists (already-sent excluded), publish once, step through the drafts |
| Finished beat to YouTube | About 9 actions, custom video not used, link retyped | **Content Pack:** one click, uses your video, reuses the stored link, resumes after a crash |
| Sale to split to revenue | About 14 actions, 3 unlinked surfaces | Sale prompts for splits and shows net owed. Better still, sales arrive by themselves (section 5) |
| Build a kit | Separate view, no add from library | Press a key in Crate to add to the rack |
| First run | What's New for an app you've never seen, then "100% healthy" with zero beats | Find folders with live counts, name yourself, **pick your world full-bleed**, install Bridge, run a rig check |
| FL crashes | Undiscoverable, on demand only | Rig badge and a notification when a crash report names a plugin, then a check that the fix worked |

---

## 4. Themes: packs that change structure

This keeps every theme. It reverses the earlier draft, which fixed structure and retired 11 themes. You've said you prefer themes whose structure changes, and that draft contradicted it.

**The real problem:** themes are CSS painted over one DOM. There are 498 theme-scoped rules (Chrome has 169, Console 155), and class lists are enumerated by hand. Any view that's missed falls through, which is visible today:

- **Gilded Ruin** promises "not one see-through surface", but its Plugins view sits translucent on the bright tree and rows are hard to read. `.plug` and `.kit` have no theme rules at all.
- **Magma**'s stat numbers ($0, 0, 72) and session clock are close to illegible in Rubik Burned, and card titles fade into the panels.
- **Yatai**'s toolbar buttons wrap and sit on the bright noren photograph, and "Sound Library" wraps in the sidebar.
- **Default theme** is Console, the flat look you rejected, and it's what first-time users see.

**V2: Theme Packs.** Each pack is a manifest of tokens, lazy-loaded CSS, assets, an ambient module, and **slots** (`Shell`, `Nav`, `Transport`, `LineCard`, `BeatRow`, `Stage`).

- Any new view works in every theme by default, using tokens.
- A pack can replace a slot with a real component, so Yatai's menu board stops being a CSS trick and becomes an actual menu board.
- Token-only themes (Dusk, Sonar, Amp, Sandstone, Chalk) already cost about two rules each, so there's no reason to retire them.

**Legibility floor without flattening:**

- Each theme gets a **character data face**: a font in its own world with tabular numerals, used for BPM, money and times. Character fonts still cover all text. Coverage is already good: 3 stray monospace strings each in Yatai, Koi and Magma.
- Darken locally behind text, like a shadow or a well in the painting, rather than dimming the art.
- Give statuses a stamp or glyph as well as colour. Magma, Gilded and Thorn statuses are near-identical today.
- Raise the size floor. The Vault has 74 text elements at 9px, and about half the controls in Kit Maker (323 of 683) and Plugins (378 of 775) are under 24px.
- **Contract test:** every pack on every view, with screenshots and contrast sampled against the real backdrop. It would have caught all of the above.

Make the default a flagship such as Yatai, or let the world picker in first run decide.

Performance isn't a reason to cut themes: idle main-thread CPU was 0.1 to 0.2% on the themes tested, 2.9% on Chrome and 4.4% on Stage. GPU cost during playback is unmeasured.

---

## 5. New capabilities, in priority order

### The big bet: the Beat Passport

Every bounce automatically answers four questions:

1. **Is it clean?** Samples and their packs, loudness, clipping, missing files.
2. **What does it sound like?** BPM, key with confidence, energy, sections, similar beats.
3. **What is it promised to?** Leases, exclusives, splits, expiry.
4. **Who should hear it next?** Ranked contacts and matching references.

Marketplaces see only sales, sample tools see only samples, and DAWs see only the session. Studio HQ is the one place that can join all of them, because it reads your FL projects, audio and business records locally. No tool found in the market research does this, though that means none was found, not that none exists. An exportable clearance sheet may also help you stand out as human-made work against AI supply. That is a hypothesis to test, not a fact.

### Capabilities

| # | Capability | Why it matters | Built with | Size |
|---|---|---|---|---|
| 1 | **Beat features** | Everything below depends on it. Today analysis isn't stored beyond BPM, key and peaks | Essentia, ffmpeg `ebur128` | M |
| 2 | **Crash-safe publish queue and Content Pack** | The work you already do. One beat gives 9:16 and 16:9 preset renders, thumbnail, copy and scheduled upload | Existing exporter and YouTube modules, job table | L |
| 3 | **Loudness-safe video audio** | Warn, then apply gain and a −1 dBTP limiter to video audio only, and raise AAC from 192k | ffmpeg `loudnorm`, `alimiter` | S |
| 4 | **Audition engine** | True A/B at matched loudness, gapless, sample-accurate loops, real meters. Today's A/B has an audible gap | Web Audio, AudioWorklet | L |
| 5 | **Sonic index** | "Sounds like this" and text search across beats, loops and your sounds. No competitor found indexes your finished beats alongside your samples | Embeddings in sqlite-vec via onnxruntime-node. Check model licences | M |
| 6 | **Sample passport** | Which pack and licence each sample came from, before you sell an exclusive or use Content ID. `flp_samples` already has 3,472 links | SQL, Chromaprint | M |
| 7 | **Sales and reply intake** | Fixes the zeros. I found no public BeatStars API, so read order emails instead | Gmail or IMAP parsing | M |
| 8 | **Revenue attribution** | Learn which titles, tags and videos actually sell, and feed that into "What to post next" | YouTube Analytics API | M |
| 9 | **Hook finder** | Real chorus detection replaces "loudest stretch" for Shorts and audition | all-in-one (check model licence) | M |
| 10 | **Rights ledger** | What each lease promised and what blocks an exclusive. Needed once sales flow | SQL | M |
| 11 | **Pitch matching** | Ranks who should hear a beat. Only useful once you have contacts | Sonic index plus reply history | M |
| 12 | **Bridge 2** | Stable project ID in plugin state, keeps WAVs and tails, live LUFS meter, two-way link, "similar sounds to this project" inside FL | JUCE, libebur128 | M |
| 13 | **Idea search** | Find a melody across old projects | Index `flp_midis`, Basic Pitch for audio | M |

**Skip:** a stem separation UI, because FL Studio 2026 includes separation (edition unconfirmed). Add it to a release pack only if you need trackouts for beats with lost projects. Also skip a checkout storefront. The YouTube flow already requires a BeatStars link, and `store/` has placeholder audio and blank checkout links, so retire it or fold it into `catalog.ts`.

**Video presets:** `lab`, the default, is a panel dashboard, and `cover` keeps the BPM, key and clock row. Both break your preset rules, so change the default and rework those two. Add named saved looks and batch rendering.

---

## 6. Foundations

Only the parts the features above need.

**Data model**

1. **Projects and assets.** A stable project ID joins FLP versions, bounces, stems, previews and covers. This replaces title-derived groups, the cause of the "Ghost" merge.
2. **Portable file identity.** Volume, root, relative path and content hash, with `missing` kept separate from `offline`. Fixes the drive and rename bugs, and enables moving to a new Mac.
3. **Rights ledger.** Contract snapshots, a unique exclusive hold, integer cents with currency, and split basis points.
4. **Events.** Tracks are derived from an event log, and soft deletes replace cascades.
5. **Backups that work.** Automatic, with retention, off-disk, and in-app restore. Include covers, previews (sometimes your only audio), `pitch-site` and the localStorage kits, which your backup currently misses. Prune dead rows: 88,170 of 104,628 sound rows are stale, and most are MIDI from an old setting.

**Frontend**

- Split the 660-line `App.tsx` (49 `useState`, no store, no context) into Zustand slices, typed routes and TanStack Query over typed IPC.
- Add one `AudioEngine` to replace five separate HTMLAudio setups.
- Add shared `Dialog`, `TagInput` and a shortcut registry feeding the palette, menu bar and hints. There are 16 modal shells today.
- Add a root error boundary. Dashboard, CRM, Sales and Feedback have none.
- Minify the build, since `index.js` ships unminified at 1.97 MB. Move the video worker to its own entry so Remotion and Mediabunny stop loading at startup.
- Fix `Waveform`, which rebuilds its observer every frame during `VideoBuilder` playback.

**Quality:** ESLint, Vitest with jsdom, a Playwright smoke test for Electron, an accuracy test set for BPM and key using your own filenames as ground truth, and the theme contract test. The renderer has one test file, and that gap is how the `c.videos` bug shipped.

**Right-sized on purpose:** the reviews flagged 20k-row problems, but you have 130 beats. Beat table virtualisation and full-text search are cheap to include in the rewrite and aren't urgent on their own. One exception: add the missing `beats(project_path)` index now, since it's one line.

---

## 7. Roadmap

Sizes are relative effort, not dates.

| Phase | Outcome | Contents | Size |
|---|---|---|---|
| **0. Trust** | Nothing lost, nothing lies | All of section 2. Security items 1 to 4. Close the DB on quit, plus backups | M |
| **1. Know your beats** | Analysis you can believe | Beat features, key confidence, octave fix, loudness-safe video, accuracy tests | M |
| **2. Foundations** | Safe to change | Data model migration with a snapshot, `App.tsx` split, typed IPC, tests. No visible change | L |
| **3. The Line** | The new app | Tracks, the Line, Beat Sheet, Jobs tray, first run, People, Ledger, Crate, Rig | L |
| **4. Theme Packs** | Worlds with real structure | Pack engine and slots. Port Yatai, Magma, Gilded and Thorn first, then contract test | L |
| **5. Ship faster** | The work you do most, cut to one click | Crash-safe queue, Content Pack, audition engine, Bridge 2 | L |
| **6. Passport** | The category move | Sonic index, sample passport, sales intake, attribution, rights ledger, pitch matching | L |

Phases 0 and 1 can start now. Phase 3 depends on 2, and 4 needs the slots from 3. Phase 5's publish queue can move earlier, since it doesn't depend on the Line.

**Done looks like:** open the app, see what changed since last time, and clear a beat's next action in two moves. All 105 finished beats have a real status, and no track is logged by hand if the app could have detected it.

---

## 8. Decisions needed

1. **Are the zeros friction or irrelevance?** This is the most important question. If you really do pitch and sell, but outside the app, V2 stands as written. If you only sell through BeatStars and post on YouTube, People shrinks and Phase 5 moves up.
2. **Personal tool or product?** Recommendation: stay personal, then try it with about 10 producers after the Passport exists. Going commercial needs notarised builds, removal of personal defaults, replacing the Google, Netlify and Claude CLI setup with something non-technical, a model licence audit, and a Windows answer, since FL runs there. Comparable tools sit at roughly $99 one-time or $8 to $10 a month (mostly third-party listings).
3. **The Line as home?** Before building, I recommend making concept images of the Line in 2 or 3 worlds so you can pick. Mockups are how your best decisions have been made so far.

---

## 9. Where the reviewers disagreed

| Question | Recommended by | Decision | Why |
|---|---|---|---|
| Retire or freeze themes? | Earlier draft, strategy | **Keep all** | Cost comes from hand-written CSS, which packs remove. Themes are your signature |
| Fix structure across themes? | Earlier draft | **No** | You've asked for themes that change structure. Slots allow it safely |
| Stop developing Plugins? | Strategy | **No** | It's your most-used feature (226 actions), and crash watch ties it to the daily job |
| Rights ledger first? | Strategy | **Later** | You have 0 sales. Intake has to come first or it stays empty |
| Vault-first home? | Earlier draft | **No, the Line** | The daily question is "what's next", not "what do I own" |
| Sandbox is High, needs main-process work? | Earlier draft | **Medium, two flags** | Preload uses no Node. Navigation and IPC come first |
| Stems pipeline? | Audio | **Not as a feature** | FL 2026 covers it. Only use it for lost-project trackouts |
| Virtualise for 20k rows now? | Frontend, data | **Fold into the rewrite** | Your catalog is 130 beats |
