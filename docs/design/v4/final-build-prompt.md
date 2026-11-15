# Studio HQ v4: final build prompt

Paste everything below the line into a fresh Claude Code session opened in `~/Desktop/StudioHQ`.

---

Build the final version of the Studio HQ v4 redesign. Treat everything done on branch `redesign-v4` on 2026-11-14 as a rough draft. Keep what's good, redo what's weak, and finish every screen. When you're done it must look like one brand-new, finished app, not a half-moved old one.

## Read first
- `docs/design/full-redesign-prompt.md`: the original brief, process and "brand new app" checklist.
- `.superpowers/sdd/v4-rollout/progress.md`: the ledger of what was built, the rulings and the open issues.
- `docs/design/v4/rollout-plan.md`: the global constraints. They still apply.
- `docs/design/v4/component-list.md`: 45 "life" components matched to screens.
- `docs/design/mockups/v4/flagship.html`: the approved flagship theme. `a-deck.html` is the approved layout.
- `docs/design/skill-log.md`: which skills were used and how.
- `git log --oneline 98a93ab..HEAD`: the draft commits (shell and Home, Beats, Peak Chart, Shell life components, theme swap).
- Memory: `v4-deck-direction`, `ui-taste-preferences`, `theme-font-everywhere`.

## Decisions already made by the owner (don't re-ask)
- **Direction:** A "Deck". Header with the player, one flat strip of screens, the Idea→Sold line, a dense table with an inspector, and Pitch as a routing grid.
- **Theme:** ONE flagship theme, `deck`: warm near-black #0b0b0a, vermilion #ff5533, Archivo wide uppercase display type, Inter Tight body text, faint dot grain. `--dim` is #8a847b for AA contrast. The theme system stays so more themes can be added later.
- **Components:** use 30–50 components that give the UI life. Rewrite each in the app's own CSS and React. The app gets no Tailwind and no shadcn. Every one turns its motion off under `prefers-reduced-motion`. No generic gradients, glass, emoji icons or stock backgrounds.
- **Peak Chart (21st):** stays on the Home rail as "Beats made". Keep its theme adaptation.
- **Installing:** don't run `npm run dist` or touch `/Applications/Studio HQ.app` until every screen is finished and verified. Then ask first, and back up the old app.

## Tools to use (all connected now; load each with ToolSearch or the Skill tool, because naming one isn't using it)
- **21st MCP** (`mcp__21st__*`): `search`, `get_inspiration`, `get_theme`, `list_bookmarks`, `get_component`. Free tier allows 2 `get_component` calls a day: spend them on parts you'll really adapt. Never call AI generation (`generate`, `iterate_generation`, `edit_take`).
- **Magic UI MCP** (`mcp__magicuidesign__*`): `searchRegistryItems`, `getRegistryItem` with `includeSource`. This is the main source for the component list's M items and for new finds.
- **Skiper UI and Magic UI sources** are also installed in the scratch sandbox (`ui-sandbox`, path in the ledger). If the scratchpad is gone, rebuild it as a Vite + Tailwind + shadcn project outside the repo and run `npx @21st-dev/cli add @skiper-ui`. Aceternity needs the owner to sign in to 21st or set `API_KEY_21ST`, so ask before relying on it.
- **Claude in Chrome / built-in browser:** for 21st.dev browsing, the HTML mockups (launch config "mockups", port 8098) and references.
- **Graphify:** `graphify-out/` exists. Run `graphify query "…"` before reading code broadly. Run `/graphify . --update` after big changes.
- **Skills to load and use at their stage:**
  - Process: `superpowers:subagent-driven-development` (one implementer per screen, never two on the same file), `superpowers:verification-before-completion`.
  - Design: `frontend-design:frontend-design`, `design-skills:interaction-design`, `ecc:motion-patterns`, `audit-suite:make-interfaces-feel-better`, `audit-suite:web-animation-design`.
  - Review and polish after every screen: `ui-design-review:ui-review` then `ui-design-review:ui-polish`.
  - Accessibility: `design-skills:accessibility-audit`.
  - 21st: `21st:21st-ui-explore`, `21st:21st-ui-review`.
  - `ponytail` (full) and `caveman` stay on.

  Log every applied skill in `docs/design/skill-log.md`, and show that phase's log lines at the end of each phase.

## Plan
1. **Audit the draft.** Screenshot every screen and dialog in the `deck` theme at 1024, 1440 and 1920 (the method is below). Write a short gap list: what's finished, what's old layout, what's broken.
2. **Polish the draft screens** (shell, Today, Beats/Loops) against the flagship. Fix any old 12/18px corners, leftover old-theme CSS and contrast problems. Commit the font packages that are uncommitted in package.json (`@fontsource-variable/archivo`, `@fontsource/inter-tight`), keeping the owner's other edits separate, and remove the unused old font packages. Ask before committing the owner's other edits.
3. **Roll out every remaining screen** to the Deck layout, one implementer each, with review and polish after each. The screens are Sounds, Kits, Map, Leads, Pitch CRM (routing grid), Content, Feedback, Sales, Store, Plugins, Themes, Settings and Assistant, plus the palette. Port that screen's items from `component-list.md` as you go. Use the Magic UI MCP for M items and new finds, and 21st search for anything missing. Delete each screen's legacy rules from `styles.css` once it's moved.
4. **Dialogs and the rest of the interface:** every `*Dialog.tsx` (Pitch as a routing grid), toasts with Undo, tooltips, the readiness panel, and an `Icons.tsx` redraw with one stroke weight.
5. **Cleanup:** cut `styles.css` down to the theme token block only, and grep to prove no old class still does any styling.
6. **Verify:** every screen and dialog at 1024, 1440 and 1920, with reduced motion on, keyboard-only, and no console errors. Run `npx tsc --noEmit -p tsconfig.json` and `npx vitest run`. Write the before/after report and answer the "brand new app" checklist honestly.
7. **Ask the owner** whether to build and install. Only on a yes: run `npm run dist`, back up the current app, then install.

## How to screenshot the real app
Run `npx electron-vite dev --remoteDebuggingPort 9333` in the background, with `STUDIO_HQ_DATA_DIR` pointing to a copy of the library. Make the copy with `sqlite3 ~/Library/Application\ Support/Studio\ HQ/studio-hq.db ".backup '<dir>/studio-hq.db'"`. Then drive the app over CDP with Node's built-in WebSocket:
- set `localStorage` `shq.theme=deck` and `shq.seen=2.0`, and `shq.vaultView=list` when needed
- reload with `setTimeout(()=>location.reload(),50)`; awaiting reload hangs
- click `.st-tab` by its text
- select a row with an ArrowDown keydown; clicking a row opens the profile overlay
- capture with `Page.captureScreenshot`

If `Emulation.setDeviceMetricsOverride` hangs, skip it. Stop the app afterwards with `pkill -f "electron-vite dev --remoteDebuggingPort 9333"`.

## Rules
- Mockup first for any screen whose layout isn't already in `a-deck.html`, and get the owner's OK.
- Renderer only. No changes to business logic, data, IPC, `src/main`, `src/shared`, or visualizer presets / `#viz-worker`.
- New styles go in `shell.css` (unlayered). The legacy CSS is in `@layer legacy`. Add each new screen's root class to the `v4-reset` layer and to the full-width list. Put narrow-width `@media` rules AFTER the base rules they override, because a rule placed earlier lost to the base rules in the draft.
- Small commits on `redesign-v4`. Never bundle the owner's uncommitted work without asking.
- End every reply with what was skipped or not checked.
