# Release checklist — design

Sub-project 2 of 4 in the Studio HQ upgrade (store, connected flow, smarter assistant, new look). The store is built; this is the connected flow.

One checklist in the beat panel shows where a beat is across Store, Video, Post, Pitch, Feedback, Splits and Sale, and offers the next step for each. It is computed from what the app already stores.

## Goal and success criteria
- Selecting a beat shows, at a glance, which release steps are done, in progress, still to do, or not applicable, each with a one-line summary.
- Each row has one button that opens the screen or dialog that already does that step. No step is reimplemented.
- The checklist cannot disagree with the Store, Pitch CRM, Content, Feedback or Sales screens, because it reads the same tables and keeps no state of its own.
- The beat panel gets shorter: the separate Beat site, Pitched to, Sales, Splits and Content blocks fold into the checklist's rows.

## Out of scope
- A "release everywhere" wizard that runs several steps in a row.
- Per-beat dots in the Vault list, and changes to the dashboard's "Finished, not out yet" card. Both can be built later on the same data.
- New automatic status changes. Existing rules stay: pitching sets "sent" and an exclusive sale sets "sold". Nothing else moves a status.
- Loops. The loop panel keeps its current "Sent to" block, since loops have no sales, splits, videos or store.
- Restyling. The card uses existing classes and tokens only.

## What is computed
Everything is per song, not per file: all versions of a beat (its `group_id`) count together, the same way sales and exclusive locks already work.

`releaseFor(db, beatId): Release` in a new `src/main/release.ts`, with no Electron imports.

```
type StepId = 'store' | 'video' | 'post' | 'pitch' | 'feedback' | 'splits' | 'sale'
type StepState = 'todo' | 'doing' | 'done' | 'na'
interface ReleaseStep { id: StepId; state: StepState; summary: string }
interface Release { beatId: number; groupId: number; steps: ReleaseStep[]; done: number; total: number }
```

`total` counts steps that are not `na`; `done` counts steps that are `done`. Steps always come in the order above.

| Step | todo | doing | done | na |
|---|---|---|---|---|
| Store | no version of the beat is on the site | on the site with unpublished changes, or its file is missing | on the site and live | sold exclusively (it comes off the site) |
| Video | no video record for any version | — | at least one video record | — |
| Post | no post | a post exists but none is `posted` (planned or private) | at least one post is `posted` | — |
| Pitch | never pitched | pitched, no response yet (`sent` or `listened`) | any pitch has a response (`replied`, `liked`, `passed`, `placed`) | — |
| Feedback | no feedback link includes any version | a link has comments you have not seen | a link exists and every comment is seen | — |
| Splits | the beat has credits but no splits recorded | splits exist but publishing or master does not total 100% | both total 100% | no credits and no splits (you own 100% by default) |
| Sale | no sale | — | at least one sale | — |

Summaries, in these exact shapes:
- Store: `Live · from $X` (using the existing "from" price, omitted when there is none), `Not on the store`, `Changes not published`, `File missing`, `Sold exclusively`.
- Video: `n video(s) · vertical, horizontal` (distinct formats, in the order first made) or `No video yet`.
- Post: `n posted · TikTok, Instagram` (distinct platform labels), `n planned`, or `Nothing planned`.
- Pitch: `Pitched to n · m replied` (distinct contacts) or `Not pitched yet`. Names are not in the summary; the expanded row lists them.
- Feedback: `n link(s) · m new comment(s)` or `No feedback link`.
- Splits: `Publishing p% · Master m%` plus ` · sheet <date>` when a sheet was made, `Not recorded`, or `You own 100%`.
- Sale: `n sale(s) · $total` with ` · exclusive` appended when locked, or `No sales yet`.

## Behaviour in the beat panel
- For beats with audio, a **Release** card sits where the Beat site card is now. FL projects without audio keep today's reduced panel.
- Header: `Release · d of t done`.
- Each row: a state mark (done, in progress, to do, not applicable), the step name, the summary, and a button. Rows that are `na` show no button.
- Buttons and what they open (all existing):
  - Store: expands the row to show today's Beat site controls (send to site, title/genre/link, publish, remove).
  - Video, Post: Content (`onContent`), as "Make video, titles and tags…" does now.
  - Pitch: the pitch dialog (`onPitch`); disabled when the beat is sold, as now.
  - Feedback: the feedback dialog (`onFeedback`).
  - Splits: the splits editor (`onEditSplits`); when splits total 100% a second button makes the split sheet, as now.
  - Sale: the log-sale dialog (`onLogSale`); disabled and labelled `Sold exclusively` when locked, as now.
- Pitch, Sale and Splits rows expand (click the row) to show the same lists the panel shows today: contacts pitched and their status, each sale with buyer, date and price, and the split totals. These lists are the existing markup, moved into the row.
- Refresh: the card reloads when the selected beat changes, when any dialog it opened closes, and on the existing beats-changed event.
- Keyboard: rows and buttons are operable with Tab, Enter and Space, using the existing `clickable` helper.

## Structure
- `src/main/release.ts` (new): `releaseFor`, pure queries, plus exported pure helpers `storeStep`, `postStep` and so on, one per step, each taking plain row data so they can be tested without a database.
- `src/main/ipc/library.ts` (where `beats:get` lives): handler `release:get(beatId)`. `src/preload/index.ts` and `StudioApi` in `src/shared/types.ts`: `releaseGet(beatId): Promise<Release>`. Types `StepId`, `StepState`, `ReleaseStep`, `Release` go in `src/shared/types.ts`.
- `src/renderer/src/ReleaseCard.tsx` (new): the card. `Detail.tsx`: for `kind === 'beat'`, render `ReleaseCard` in place of `SiteCard` and of the Pitched to, Sales, Splits and Content blocks, passing the existing props through. For loops nothing changes.
- `SiteCard.tsx` stays and is rendered inside the Store row.
- No database changes.

## Errors
- If the checklist fails to load, the card shows `Couldn't load the release status.` with a Retry button, and the rest of the panel still works.
- A step's button failing (a dialog error) behaves exactly as it does today, because the same handlers run.

## Testing
- Unit (vitest, temporary database from `openDb`, beats from `test-helpers`):
  - a beat with no activity: Store, Video, Post, Pitch, Feedback and Sale are `todo`, Splits is `na`, `done` is 0 and `total` is 6;
  - two versions in one group: a pitch on one version and a post on the other both count;
  - a beat on the site: `done`, and `doing` once `dirty=1` or its file is missing;
  - an exclusive sale: Store becomes `na`, Sale is `done` with `exclusive` in its summary, `total` drops;
  - pitch states: `sent` is `doing`, `placed` is `done`, `passed` is `done`;
  - posts: only `planned` is `doing`, one `posted` makes it `done`;
  - splits: credits and no splits is `todo`; parties at 60/100 is `doing`; 100/100 is `done`; neither credits nor splits is `na`;
  - feedback: unseen comment is `doing`, all seen is `done`;
  - summary strings for each of the shapes above, including pluralisation at 1 and 2.
- Component logic: the row-to-button mapping and the disabled rules (sold beat cannot be pitched or sold again) as a pure helper with its own test.
- In the running app on a copy of the library: select a beat with a pitch, a post and a sale, and one with none, and check the card, the row expansions and every button. Checked in Pearl first, then the other themes if reachable.

## Where the feedback data lives
A feedback link is a row in `packs` with `kind='feedback'`; its beats are in `pack_beats`; comments are in `feedback_comments` keyed by the link's `slug`, and a comment belongs to the beat at its `beat_index` in that link's beats ordered by `pack_beats.position` (the same rule `Feedback.all()` uses). The Feedback step counts a link when any version in the group is in its `pack_beats`, and counts a comment only when it resolves to a version in the group.
