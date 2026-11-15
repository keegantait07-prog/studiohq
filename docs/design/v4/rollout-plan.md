# v4 Deck rollout plan

Spec: `docs/design/full-redesign-prompt.md` (brief) and `docs/design/mockups/v4/a-deck.html` (approved target, direction A "Deck", approved by the owner 2026-11-14 after the Home build).

## Global Constraints

- Renderer only. Do not change business logic, data, IPC, `src/main`, `src/shared`, visualizer presets or `#viz-worker`. Every existing handler, keyboard shortcut, empty state and prop keeps working.
- Every theme keeps its own world. Use only the semantic tokens all 8 themes define: `--bg --panel --raise --well --line --line-hi --text --text-2 --dim --accent --accent-ink --accent-text`, status `--idea --wip --finished --sent --sold`, radii `--r-btn --r-field --r-card`, type `--font --font-display --display-case --display-track --display-weight`. Spacing `--s1..--s6`, motion `--dur-1/2/3` and the easing tokens from `shell.css`. No hard-coded colours except where a theme needs ink flipped (see `shell.css` line 117 pattern).
- Mockup token names map to app tokens: `--fg-2`→`--text-2`, `--fg-3`→`--dim`, `--border`→`--line`, `--border-2`→`--line-hi`, `--raised`→`--raise`, `--card`→`--panel`, `--primary`→`--accent`, `--on-primary`→`--accent-ink`, `--done`→`--finished`, `--r-ctl`→`--r-btn`, `--r-chip`→`--r-field`, `--foreground`→`--text`, `--background`→`--bg`.
- The theme font covers all text. Never set a literal font family.
- New styles go in `src/renderer/src/shell.css` (unlayered, so they beat `@layer legacy` in `styles.css`). Add each new view root class to the `@layer v4-reset` selectors (lines 14-16) and to the full-width list on line 24.
- Legacy rules in `styles.css` that only served the replaced markup are deleted; rules still used elsewhere (grep the class) stay.
- No entrance animation on `.app > :is(...)` children (`styles.test.ts` enforces it). Hover effects only under `@media (hover:hover)`; no `transition: all`; everything off under `prefers-reduced-motion`.
- Accessibility: buttons for actions, `aria-pressed`/`aria-current`/`role` where the mockup has a segmented control, visible focus, text contrast ≥ 4.5:1.
- Not a copy of any one 21st component. Cite the 21st references used in a one-line CSS comment (23604 Records Table, 45217 Outline Inspector, 18483 Waveform, 43122 Segmented Control).
- Checks: `npx tsc --noEmit -p tsconfig.json` clean and `npx vitest run` all green.

## Task 1: Beats (and Loops, which share the markup)

Rebuild the vault screen in `App.tsx` (the fallthrough branch that renders `<main className="main">` plus `<Detail>`/`aside.detail.empty-detail`) and restyle the inspector in `Detail.tsx`, to match the `#beats` section of `a-deck.html` (CSS lines 131-175, markup lines 288-326).

Layout
- One root `<section className="vault">` spanning full width: grid `1fr 360px`, list on the left, inspector on the right, both scroll independently (min-height 0).
- List column, top to bottom: tools row, sticky table head, rows, summary footer.
- Tools row: the screen title (`Beats` or `Loops`) in the display font; a segmented status control (All N, Idea N, In progress N, Finished N, Pitched N, Sold N; coloured square per status) that replaces the PageHeader stage pills and drives the existing status tab; the existing search input; saved-search chips and Save search; List/Cards toggle; Group versions; beat-only Clean up and Rescan FL projects; loop-only Group by and Collapse/Expand all. Drop `PageHeader` and the old `.subbar` from this screen if nothing else needs them there.
- Table columns: play button, Title (title, plus version badge and FL-project thumb as today), Waveform (`Thumb` from `Waveform.tsx` fed `beat.peaks`), BPM (keep the warn state), Key (keep `.keycell` colour), Status (`StatusPill`), Touched (relative time from `mtime`; mark it as the sorted column only if it is). Row height 48px, selected row gets an inset 3px bar in its status colour. Loop section rows (`.secrow`) stay.
- Footer summary row: count shown, finished count, average BPM of rows with a BPM, most used key. Compute from the rows already filtered; no new data.
- Cards view stays available; restyle it with the tokens, no new features.
- Inspector (`Detail.tsx`): keep every field and handler; reorder and restyle only. Order: a waveform head (the beat's `peaks` via `Waveform`, showing playback progress when this beat is playing if the player clock is already reachable, otherwise static), title input + one-line state sentence + filename, key-value rows (BPM, Key, Length, Loudness if present, Versions) each with its source note, the readiness checklist (`readiness()` steps as check rows with their existing Draw one / Redraw action), the primary actions (Pitch this beat, and existing actions), then the remaining fields (tags, notes, credits, FL project, compatible, versions, pitched to). Empty inspector state restyled to match.
- Keep the `data-row` attributes and `move()` keyboard navigation, audition mode, double-click to play, profile open, status hotkeys.
- Keep `.tbody` and `.detail` (or update `SELECTOR` in `smoothScroll.ts` to the new scroll containers).
