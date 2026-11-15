# v4 "life" components: shortlist and where each goes

Goal: 30–50 components that make Studio HQ feel alive. Each one is rewritten in the app's own CSS and tokens (no Tailwind in the app), follows the theme's font and accent, and turns its motion off under `prefers-reduced-motion`. Owner taste filter: no generic gradients, glass, emoji or stock backgrounds.

Sources:
- **S** = Skiper UI, installed in the sandbox (`scratchpad/ui-sandbox/src/components/ui/skiper-ui/`)
- **A** = Aceternity, locked until 21st sign-in or `API_KEY_21ST`
- **M** = Magic UI, installed in the sandbox (`ui-sandbox/src/components/ui/`); its MCP is in `.mcp.json`
- **P** = Peak Chart, already in the app (`fda9094`)

## Shell (every screen)
1. Animated play/pause morph in the transport — S25 MusicToggleButton
2. Menu / volume icons that animate between states — S99
3. Text-roll hover on the screen tabs — S58 TextRoll
4. Animated tooltips with an arrow, for every icon button — S101 Tooltip
5. Progressive blur at the edges of scroll panels — S41 ProgressiveBlur
6. Rolling numbers on tab badges and counters — S37 AnimatedNumber
7. Gooey merge on the A/B and Audition chips — S64 gooey filter
8. Floating command dock (⌘K results) — M dock
9. Placeholder that cycles example searches in Find — A placeholders-and-vanish-input

## Today (Home)
10. Beats-made chart — P Peak Chart (done)
11. Idea→Sold line drawn as a path — S19 LinePath
12. Rolling numbers in the colour blocks and goals — S37
13. Spotlight that follows the cursor on the lead card — M magic-card
14. Streak heatmap cells that pop in when a day is earned — S61 spring follow, adapted

## Beats and Loops
15. Cursor-follow playhead on row waveforms — S61 SpringMouseFollow
16. Smooth caret in search and inspector fields — S106 SmoothInput
17. Before/after slider for A/B mixes — A compare
18. Release checklist as a tracing timeline — A tracing-beam
19. Hover-expand strip for versions — S52 HoverExpand_001
20. Rolling BPM and loudness numbers in the inspector — S37

## Sounds and Kits
21. Hover-expand sample rows — S53 HoverExpand_002
22. 3D tilt on kit cover cards — A 3d-card
23. Drag-in drop zone for samples — A file-upload
24. Coverflow of kits — S54 Carousel_006

## Map
25. Mouse-follow focus ring on the sonic map — S61
26. Tooltip cards on points — S101

## Leads and Pitch CRM
27. Animated links on contact handles — S40 Link000–004
28. Avatar stack with tooltips — A animated-tooltip
29. Clip reveal when a pitch dialog opens — S66 ClipDiv
30. Multi-step loader for lead lookups — M animated-circular-progress-bar
31. Sticky stacked cards for the pitch history — S34 StickyCard_003

## Content
32. Video preview player with spring controls — S67 VideoPlayer
33. Post carousel by platform — S47 Carousel_001
34. Typewriter caption preview — M typing-animation

## Sales and Store
35. Rolling revenue totals — S37
36. Product carousel for the store page preview — S48 Carousel_002
37. Sticky product cards — S16 StickyCard_001
38. Card stack for licences — S17 StickyCard002

## Plugins and Feedback
39. Expandable plugin rows — S53
40. Animated modal for fix confirmations — M blur-fade (dialog entrance)

## Themes and Settings
41. Theme switch with a circle-wipe reveal — S26 ThemeToggleButton
42. Theme toggle variants for the quick switch — S4 ThemeToggleButton1–4
43. Squircle masks for the Deck flagship cards and buttons — S63 SquiCircleFilter
44. Dynamic toggle for settings switches — S3
45. Text generate for the theme story line — M text-animate

## Skipped, and why
- S28 / S30 / S31 / S39 / S87 / S89 / S62: landing-page scroll scenes (parallax, perspective text, crowd canvas). They don't fit an app.
- S49 / S50 / S51: carousels that duplicate 33, 36 and 24.
- S65 BreakpointIndicator and S102 DebugPanel: developer tools, not UI.
- Aceternity aurora, beams, sparkles and gradient borders: these are the generic gradient look the owner rejected.

Count: 45 (31 Skiper, 6 Magic UI, 7 Aceternity still locked, 1 in the app). More Magic UI in the sandbox: number-ticker, animated-list, border-beam, marquee, ripple, shimmer-button, scroll-progress, file-tree, animated-shiny-text, animated-beam.
