# Prompt: full Studio HQ redesign (must look like a brand new app)

Paste everything below the line into a new Claude Code session opened in `/Users/keegan/Desktop/StudioHQ`. Use high effort.

---

Studio HQ (Electron + React + TypeScript, renderer in `src/renderer/src`) looks bad. Redesign it so that anyone who used the old version would believe it is a different, newly built product. This is a rebuild of the interface, not a restyle.

## The bar: "brand new app"
The redesign is only done when ALL of these are true:
1. **Before/after test.** Put a screenshot of every main view (old vs new) side by side. If the new one still shares the old layout skeleton, nav arrangement, card/row shapes, header pattern or icon style, it fails. Redo it.
2. **New shell.** Rethink the app frame from zero: navigation model, header/page-title pattern, floating player, ticker, command palette, assistant, toasts and modals. Do not keep the current sidebar+header arrangement just because it exists. Justify the new structure in one paragraph before building.
3. **New design language.** New type scale and pairing, new spacing rhythm, new radius/elevation/border logic, new component shapes (buttons, inputs, tabs, rows, cards, badges, tables, empty states, dialogs), new iconography (redraw `Icons.tsx`, consistent stroke/weight), new logo/wordmark treatment, new motion language (entrances, hover, press, route and panel transitions, number/meter animation).
4. **New views, not moved boxes.** Re-compose each view around what the producer actually does there (decide, act, see status), with a clear primary action and strong hierarchy. Cut clutter. Every view needs designed empty, loading and error states.
5. **Zero legacy styling.** Replace `styles.css` (about 1400 lines) with a fresh token-based stylesheet or split modules. Delete dead rules. No leftover old class names doing visual work. Grep to prove it.
6. **Polish you can feel.** Smooth scroll (Lenis, already wired), micro-interactions, focus rings, keyboard flow, consistent 60fps animation, crisp text at all window sizes. It should feel premium and expensive, not template-y.
7. **Themes survive as worlds.** The 8 themes in `themes.ts` (Defied, Pearl, Signal, Faceplate, Tape, Brass, Ballpoint, Concrete) each keep their own character and character font on ALL text everywhere, but all are rebuilt on the new component system, so each looks like a brand new app in its own style. Check every view in every theme.

## Scope
Every view and surface: Home/Dashboard, Content, Studio, Leads and CRM, Sales, Revenue, Calendar, Store, Sound library and Sonic map, Videos and Video builder, Templates, Themes, Plugins, Settings, Feedback, Assistant, Palette, all dialogs (`*Dialog.tsx`), the nav, the floating player, the ticker, and the HUD/overlay layer (readiness/beat panel, toasts, tooltips). Do not change business logic, data, IPC or the main process.

## Read first
- `docs/design/studio-hq-v2.md`, `docs/design/redesign-draft-artlist.md`, `docs/design/open-design-3d-prompt.md`, `docs/design/mockups/` (old attempts: learn what to avoid and what the owner liked)
- `src/renderer/src/styles.css`, `themes.ts`, `App.tsx`, `Nav.tsx`, `PageHeader.tsx`, `Ticker.tsx`, `Dashboard.tsx`, `Icons.tsx`
- Memory notes in `~/.claude/projects/-Users-keegan-Desktop-StudioHQ/memory/` (UI taste, theme fonts, visualizer lessons)

## Hard constraints (owner's past feedback)
1. **MOCKUP FIRST.** Make 3 genuinely different full-app directions as mockups (HTML/Artifact or images in `docs/design/mockups/`, covering shell + Home + one dense view + one dialog). Get the owner's explicit pick BEFORE touching app code. Earlier redesigns (3.0 and the Nov 5-6 themes) "looked cheap" and were rolled back. Cheap means: generic gradients, default-card sameness, emoji icons, weak hierarchy, uneven spacing, flat dead surfaces.
2. After the pick, build ONE view fully (shell + Home) and get approval again before rolling out to the rest.
3. Keep every feature and data flow working. Run `npm run typecheck` and the tests (`styles.test.ts`, `readiness.test.ts`, others) after each step; change tests only when the redesign requires it.
4. The window is a fixed-overflow desktop shell (`html, body, #root { overflow: hidden }`); scrolling lives in panels. Lenis is wired in `src/renderer/src/smoothScroll.ts` (see its `SELECTOR`); extend it for new scroll panels, keep it off virtualised lists.
5. Do not touch visualizer presets or the hidden `#viz-worker` window.
6. Work on a new branch, commit in small steps.

## Skills and tools (all of them, except `lens`)
Load each with the Skill tool before using it:
- Direction and concepts: `superpowers:brainstorming`, `design-superpowers:design`, `design-superpowers:creative`, `design-superpowers:design-review`, `frontend-design:frontend-design`, `ui-ux-pro-max:ui-ux-pro-max` (+ `ui-ux-pro-max:design-system`, `ui-ux-pro-max:ui-styling`)
- 21st.dev (plugin installed, owner is logged in): `21st:21st-ui-explore` for the three mockup directions, `21st:21st-ai` to sketch and iterate variants, `21st:21st-cli-use` to find reference components, `21st:21st-ui-build` to implement each view, `21st:21st-ui-review` to audit. If 21st is not authorised, say so and continue. The project has no `components.json`: do not run `shadcn init` without asking; adapt pulled code into the app's own CSS system.
- Systems and quality: `design-skills:design-elevation`, `design-skills:design-systems`, `design-skills:interaction-design`, `design-skills:design-critique`, `ecc:design-system`, `ecc:frontend-a11y`
- Motion and feel: `ecc:motion-foundations`, `ecc:motion-patterns`, `ecc:motion-advanced`, `audit-suite:make-interfaces-feel-better`, `audit-suite:web-animation-design`, `audit-suite:emil-design-engineering`, `animatedwebs:background`, `animatedwebs:component`, `animatedwebs:gradient`, `animatedwebs:style`
- Review and verification: `ui-design-review:review`, `ui-design-review:polish`, `superpowers:verification-before-completion`
- Parallel build once a direction is approved: `superpowers:subagent-driven-development` (one agent per view, each following the same token layer; no two agents on the same file)

## Process
1. **Audit.** Screenshot every view in at least Defied, Pearl and Concrete. List what is bad (hierarchy, density, contrast, type, alignment, empty states, HUD clutter, icon inconsistency).
2. **Mockups.** Three directions, owner picks one.
3. **Foundation.** Tokens (color, type, spacing, radius, elevation, motion), the new component set, the new icon set, the new shell. Show it for approval with Home.
4. **Roll out** view by view, then dialogs and HUD, then theme-by-theme pass.
5. **Verify.** Run the app (`.claude/launch.json`), screenshot every view in every theme, check console errors, keyboard focus, contrast, small and large window sizes, reduced motion.
6. **Before/after report** with side-by-side screenshots, a list of deleted legacy CSS, what is unverified, and what is left. Run the "brand new app" checklist above honestly and say which items pass.
