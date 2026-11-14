# Redesign skill log

One line per time a skill was applied: step | skill | what it changed.
Phases: 0 Load · 1 Audit · 2 21st research · 3 Mockups · 4 Foundation · 5 Rollout · 6 Verify.

## Phase 0: load (14 Nov 2026)
All 32 skills from the prompt loaded with the Skill tool. `frontend-design` and `21st-ui-explore` were already loaded earlier in the session. The four `animatedwebs:*` skills are command wrappers: they loaded, but their search actions have not run yet.

## Phase 1: audit (14 Nov 2026)
- Audit | design-skills:design-critique | Audit framed by heuristics: hero titles break H8 (minimal design), three nav layers break the excise rule, empty states break H1. See `docs/design/audit/audit-2026-11-14.md`.
- Audit | design-superpowers:design-review | Screenshots taken of all 14 views in Defied, Pearl and Concrete at 1440×900 from a copy of the library. Found the duplicate ticker bug in Pearl Pitch CRM.

## Phase 2: 21st research (14 Nov 2026)
- Research | 21st:21st-cli-use | 32 component searches + 10 theme searches, 131 components and 34 themes; 7 theme CSS files pulled with `21st theme`. `get_inspiration`/`get_theme` are MCP-only and the MCP did not load in this session, so CLI `search` + `theme` were used instead. AI generation not called (off on this plan).
- Research | 21st:21st-ui-explore | Picked 18 references that are NOT the default light shadcn kit; notes on what each lends in `docs/design/mockups/21st-references/README.md`.
- Research | 21st:21st-cli-use | `21st get` (2/day) held back until a direction is picked, so the retrievals go to pieces that will really be adapted.
- Research | ui-ux-pro-max:ui-ux-pro-max | `--design-system --density 8` returned indigo/green + Righteous/Poppins. Rejected as generic (frontend-design tells). Kept: its a11y checklist and "no overshoot easing on dense tables".
- Research | ui-ux-pro-max:design-system | Every 21st theme uses one semantic layer (background, foreground, card, muted, accent, border, primary, ring + radius + 3 font roles + shadow ladder). Decision: new token layer copies that semantic layer; the 8 Studio HQ themes only swap it.
- Research | design-superpowers:creative | Each direction drawn from a different style family: A instrument/DAW, B physical crate/editorial, C command-first console.

## Phase 3: mockups (14 Nov 2026)
Files: `docs/design/mockups/v4/index.html` (comparison), `a-deck.html`, `b-crate.html`, `c-console.html`. Each covers shell + Home + Beats + Pitch dialog, in Defied and Concrete.
- Mockups | superpowers:brainstorming | Approaches laid out as 3 directions for the owner to pick; nothing in `src/` touched.
- Mockups | design-superpowers:creative | Three style families: A instrument (DAW deck), B physical (record crate), C command-first console. Each differs on nav model, density and composition.
- Mockups | 21st:21st-ui-explore | Each direction cites its 21st references in its file header and on the index page.
- Mockups | frontend-design:frontend-design | No eyebrow caps labels, no `A · B · C` meta strings, no mono data labels, real copy from the library. One bold move per direction: A the Idea→Sold line, B the halftone sleeves, C the queue.
- Mockups | ui-ux-pro-max:ui-ux-pro-max | Dense spacing scale (4/8/12/16/24/32) from the density-8 run; overshoot easing kept off tables.
- Mockups | ui-ux-pro-max:design-system | All three share one semantic token block per world (`background, card, raised, well, muted, border, foreground, fg-2, fg-3, primary, ring` + 5 status colours + radius + 2 font roles). Switching Defied↔Concrete only swaps that block.
- Mockups | design-skills:interaction-design | Undo in the toast instead of a confirm dialog after sending pitches (A, B). Keyboard hints shown next to actions (C).
- Mockups | ecc:motion-foundations / audit-suite:web-animation-design | Durations 80/180/320 ms, ease-out for enter, ease-in-out for the gliding indicator, `scale(.97)` on press, every animation off under reduced motion.
- Mockups | ecc:motion-advanced | Rolling digits (C), dot-grid meter that stops when the tab is hidden (C), falling paper-ticket toasts (B).
- Mockups | audit-suite:make-interfaces-feel-better / emil-design-engineering | tabular-nums everywhere, `text-wrap:balance` on headings, no `transition: all`, hover effects only under `(hover:hover)`.
- Mockups | ecc:frontend-a11y | Icon buttons have aria-labels, dialogs are `role=dialog aria-modal`, Escape closes, toasts are `aria-live`, routing pins expose `aria-pressed`.
- Review | design-superpowers:design-review + design-skills:design-critique + ecc:design-system (slop check) | Findings below.
- Review | superpowers:verification-before-completion | All three rendered at 1440×900 in the browser pane, both worlds, all 3 screens each; console errors: none. Two bugs found and fixed: B cover titles clipped, C rolling digits clipped.

### Design review findings (mockups)
| Sev | Where | Issue | Fix in foundation |
|---|---|---|---|
| P1 | All, Defied | `fg-3` #6b6b72 on black is 3.97:1, under 4.5:1 for small text | Raise Defied `fg-3` to about #85858c |
| P1 | All, Concrete | `fg-3` #62615d on slab is 3.63:1; orange #ff5a1f as text is 1.83:1; green done 2.91:1 | Concrete `fg-3` darker; orange and green only as fills or with dark text, never as text |
| P2 | C Home | First queue item uses a colour wash gradient (a slop tell) | Replace with a solid left bar or solid tint |
| P2 | All | Only checked at 1440×900 | Check 1024 and 1920 widths in foundation step |
| P3 | B index | Index links are `<a>` without `href` | Use buttons in the real build |

## Not yet used, and why
- 21st:21st-ui-build, 21st:21st-ui-review: apply to app code; no app code until a pick.
- design-superpowers:design (component selection), design-skills:design-systems, design-skills:design-elevation, ecc:design-system (generate mode): foundation step.
- ecc:motion-patterns: needs real components; foundation step.
- animatedwebs:background / component / gradient / style: loaded as command wrappers with empty queries. Not run: the owner rejects generic gradients and stock backgrounds; will search them only if the picked direction needs a backdrop per theme.
- ui-design-review:review, ui-design-review:polish: run after each built view.
- superpowers:subagent-driven-development: rollout step.

## Not yet used
Everything else. Each will be logged when it is applied, or listed here with a reason if it does not apply.
