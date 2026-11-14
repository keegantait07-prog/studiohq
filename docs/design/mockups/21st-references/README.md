# 21st.dev references (14 Nov 2026)

Source: 32 component searches + 10 theme searches with the 21st CLI (free tier). 131 unique components, 34 themes. Full results in `search-results.json` and `theme-results.json`; `sheet00.jpg`–`sheet10.jpg` are contact sheets of every preview. No component code has been retrieved yet: the 2 free daily `21st get` calls are saved for after a direction is picked.

Most results are the generic light shadcn kit (white cards, grey borders, one radius). That look is exactly what the owner calls cheap, so it is a reference for what to avoid. The picks below are the exceptions.

## Picks and what we borrow

| File | Component | Borrow |
|---|---|---|
| `40334.png` | Analytics Bento @romanvasnev | Colour-block tiles sized by value (treemap) with the number set huge in a mono grotesk; dark panels with hairline borders and generous inner padding. Borrow: category colour as a solid block, not a dot. |
| `46319.png` | Underwater Dashboard @neebarp | A real UI under a live photographic/simulated surface. Borrow: depth from a physical material behind the UI, not gradients. Fits the owner's "photographic, real material" taste. |
| `43212.png` | Dashboard Shell @isaiahbjork | Warm paper shell; italic display title; segmented period control as an inset well; quota meter docked at sidebar bottom. Borrow: inset "well" for segmented controls, quota meter placement. |
| `39900.png` | Tweenly Chart KPI @mirukullacode | Halftone (dotted) fill under a smooth line, one hot accent, progress-to-goal bar under it. Borrow: halftone fill for waveforms and charts. |
| `23604.png` | Records Table @theshanelevine | Dense CRM table: sticky first column, tinted header for the active column, coloured tag chips, count + "add calculation" footer. Borrow: sticky first column, footer summary row for Leads/Beats. |
| `1247.png` | Tallyfold @navedux | Technical diagram as hero ("intake line" with sheets moving through a gate), hairline frames, one teal accent. Borrow: a beat moving along a line as the Home hero instead of a greeting. |
| `1290.png` | Solenne @reacthive | Full-bleed photograph, thin high-contrast serif set very large, bottom-left. Borrow: editorial type scale for one world (theme), photo full-bleed behind it. |
| `18483.png` | Waveform @thegridcn | Glowing bars inside a bracket-cornered frame, LIVE tag. Borrow: corner-bracket frame for the player/meter (Signal and Faceplate themes). |
| `33302.png` | Toast Gravity Stack @nikolas-sapa | Toasts that fall and stack with rotation. Borrow: physical, stacked toasts with slight rotation (paper-ticket feel). |
| `2075.png`, `46285.png` | Command Palettes @rafa-porto, @vovalopuh13 | Grouped results with right-aligned shortcut keys; a preview card for the highlighted item. Borrow: preview pane in the palette (beat waveform + actions). |
| `43122.png` | Segmented Control @flohoeller | Pill OR underline that glides between options. Borrow: one sliding indicator for all tabs. |
| `35051.png` | Timeline @kuratlielia | Activity grouped by day, expandable rows. Borrow: "Since you left" feed grouping. |
| `40086.png` | KPI Tile @konsstepnov | Value rolls to each new number; delta inline. Borrow: rolling digits for money/streak. |
| `12709.png` | Music Player Widget @smammar | Audio-reactive dot-grid visualiser. Borrow: dot-grid level meter in the player. |
| `26936.png` | Kanban Board @uvain | Lanes that survive long titles and many assignees. Borrow: lane density rules for Pitches. |
| `45217.png` | Outline Inspector Panel @aloksivastava102 | Design-tool inspector: scrub sliders, compact label/value rows. Borrow: beat inspector rows (BPM, key scrub). |
| `1392.png` | Curated Recommendations @kedhareswer | Objects scattered on a warm surface. Borrow: physical crate/table composition for the beat library. |

## Themes studied (`themes/`)

| Theme | What its token set teaches |
|---|---|
| Darkmatter @serafimcloud | Whole UI in Geist Mono; 3 greys only (#121113 bg, #222 muted/border, #c1c1c1 text). Shows how far a single family can carry character. |
| Amber Dark | Borders as `rgba(255,255,255,.08)` not a grey hex, so they work on any surface; two radii (6px controls, 14px cards). |
| Graphite Mono | Pure OKLCH neutral ramp (0.145 → 0.985 lightness, chroma 0): clean steps for dark and light. |
| 432 Editorial | Ink-navy #031A29 with paper #F7F5F0, radius 0. A dark theme that is not grey. |
| Elegant Luxury | Stone ramp (#1c1917 → #292524) + oxblood primary + Libre Baskerville serif. |
| Paper and Ink | Warm paper #f2ede3, ink #1c1a17, red #b3261e accent, big 18px radius. |
| Amber Retro | Manrope + Instrument Serif + JetBrains Mono; near-black brown #0e0a07. |

Common structure in every 21st theme: a semantic layer (`background, foreground, card, muted, accent, border, primary, ring`), a radius base with derived sizes, three font roles (`sans, serif, mono`), a 7-step shadow ladder, and a light + dark block. The new Studio HQ token layer uses the same semantic names so each of the 8 themes only swaps that layer.
