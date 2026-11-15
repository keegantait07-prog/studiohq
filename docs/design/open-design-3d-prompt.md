# Studio HQ, 3D redesign prompt for Open Design

Sent to Open Design on 2026-11-06 after the first three concepts were rejected as "only changed colours".
Direction: **THE RELIQUARY**, a blend of Elden Ring restraint, Cymatics Diablo tactility and real nature.

---

## THE BRIEF

You are designing **Studio HQ**, a desktop app (Electron, 1440x900 target) a beat producer uses to run a catalogue of 130 beats: Library, Crate (sound packs), Pitches, Ledger (sales and splits), Rig (plugins), Videos, plus an always-on player HUD and a jobs tray.

**The previous three concepts failed because they were flat. They were colour swaps on rectangles with text. This one must be built from real 3D geometry, real 3D type and physically lit materials. If a screenshot could have come from a CSS theme with different hex values, it has failed.**

Deliver ONE self-contained `index.html` (plus any extra asset files in the project folder). It must open and run with no build step.

### 1. The world: THE RELIQUARY

The whole app is a physical object seen through a window: a **dark carved-basalt workbench inlaid with black iron, aged brass and living lichen**, lit by ONE warm light source, a small brass lantern ("grace light") that sits in the scene, casts real shadows and swings very slightly when the player is playing so the shadows breathe with the music.

Nothing in the UI is a flat rectangle. Everything is a thing that sits on, is cut into, or hangs above the slab:
- The **window chrome and left navigation** is a slab of basalt with six **recessed brass plaques** (Library, Crate, Pitches, Ledger, Rig, Videos). Each plaque is a real bevelled extrusion. The active one is pressed in (moves along Z, its inner shadow deepens, and the lantern light catches its brass edge). Hover lifts it slightly. Plaque lettering is **engraved into** the metal (inset, with a highlight on the lower lip), not painted on.
- **Headings and big numerals are real extruded 3D type.** Hero wordmark "STUDIO HQ", view titles and the BPM numerals are solid extruded letterforms with bevelled edges, lit by the scene light, casting shadows onto the slab, and tilting a few degrees with the mouse (parallax). Build them with Three.js `ExtrudeGeometry` from real glyph outlines (see technical section). Body text stays crisp DOM text so it is readable.
- The **Library** is not a table. It is a **rack of real objects**: each beat is a slim cast-iron "tablet" (rounded-chamfer slab with a brass-edged label window) standing in a long carved groove, like records in a crate or tiles on a game-board. Tablets are packed densely (about 18 visible at once, scrolled with a smooth physical slide, the nearest one tilting toward the cursor). The selected tablet lifts out of its groove toward the viewer by about 40px of real depth, its brass edge catches the lantern, and the **item panel** opens beside it as an engraved plate (see Elden Ring section below). BPM, key and status are engraved in the label window using tabular numerals. **Status is a physical token set into the tablet, not a coloured pill**: *Draft* = bare iron, *Mixing* = brass rivet, *Mastered* = polished silver stud, *Listed* = green enamel inlay, *Pitched* = a small folded wax-sealed tag, *Sold* = a pressed oxblood wax seal with a thumbprint. Status must be distinguishable by SHAPE and MATERIAL, not just colour.
- Provide a **list-density toggle** (a physical three-position brass lever) that swaps the tablet rack for a plain dense table for fast scanning. This keeps power-user speed. Same data, same selection.
- **Crate** (sound packs) is an actual **inventory chest view**: a grid of deep square carved sockets in the slab. Each pack is a 3D object sitting in its socket (a slim cartridge, a stamped metal disc, a wax-sealed scroll tube, a small brass reel) with its own geometry per pack type. Empty sockets are visible and deliberately empty. Selecting one lifts it, turns it slowly on a turntable (idle rotation), and fills the item panel.
- **Ledger** is a **brass-and-ink accounting register**: totals are big extruded numerals; each sale is a line stamped into a paper-or-vellum strip laid across the slab (real paper texture, fibre noise, slight curl and soft shadow), with splits shown as small stacked brass weights whose height is proportional to the amount.
- **Rig** (plugins) is a **rack of real hardware modules** (rack ears with screws, a small enable toggle that really flips, a CPU-load needle meter with a glass lens and a real needle).
- **Pitches** and **Videos** can be quieter variants of the same material language (pitches as tied envelopes/tags, videos as film-leader strips with sprocket holes), but must still be 3D objects, never flat rows.

### 2. The HUD (bottom, always on screen): "the instrument"

This is the hero. It is a **cast-iron and glass instrument panel** bolted across the bottom of the window and it must look like a machined object photographed under a studio light.

- **Transport buttons**: real chamfered keycaps with travel. Pressed state moves 3px down in Z and the shadow contracts. Brass icons are **engraved**, not drawn as flat glyphs.
- **Rotary knob (output level)**: a **knurled, lathe-turned aluminium/brass knob** modelled in 3D (cylinder with fine knurl normal map, bevelled top, an inset indicator line, a skirt, and a skirted base ring with engraved tick marks). Draggable, scroll-wheel and arrow-key operable, double-click to reset, with a tiny rotational inertia and a soft detent feel. A second smaller knob for monitor/pan is encouraged.
- **BPM display**: huge extruded 3D numerals, backlit amber, behind curved glass with a visible reflection of the lantern and a faint dust/fingerprint layer. Digits roll mechanically (flip-style or drum-wheel) when the beat changes.
- **Level meters**: two **glass tubes** with a visible meniscus and glass thickness. Inside, segmented ember lamps glow with bloom, plus a peak marker. They must react to playback and to the knob.
- **Waveform**: an inlaid brass-wire waveform set into a recessed black-glass strip, with the played portion lit and the unplayed portion dull. The playhead is a thin glowing needle that casts a faint light on the glass.
- **Jobs tray**: a row of **small brass-bezelled gauges**. Each job (stem bounce, video render, pack export, upload) is a real gauge with a needle or a rising liquid column. A failed job shows a cracked-lens look and an amber "RETRY" tag.
- The grace-light lantern physically sits at the top-left of the HUD edge and its light is the source for every highlight and shadow in the scene. Keep ONE light source. Add a very dim cool fill only so shadows are not dead black.

### 3. Elden Ring influence (menu grammar and restraint only; no names, art or text from the game)

- **Item panel**: whenever anything is selected, an **engraved plate** slides in on the right. Small-caps serif title, an italic flavour line (write a good one per beat or pack), stat rows with dotted leaders ("BPM ........ 142"), and a thin gold hairline frame inset into the plate (the hairline is real geometry catching light, not a CSS border).
- Lots of negative space. Content areas stay uncluttered. Do not decorate content with ornament; ornament lives on the hardware.
- The **site-of-grace glow**: when a beat is playing, a single warm light bloom sits behind the selected object and slowly pulses with the playback level.
- Typography feel: **small-caps humanist serif for headings**, quiet text face for body, tabular mono for data.

### 4. Diablo-plugin influence (tactility only; no skull or border clip-art)

- Heavy, bolted, machined controls with weight. Hard bevels, rivets, rolled edges, subtle wear on edges where fingers would touch (brighter metal on high points, darker grime in crevices).
- Ember lighting used for "heat" (active, hot, urgent) and nothing else.
- No ornate clip-art frames. No skulls. Wear and weight, not costume.

### 5. Nature: real elements, living material

- **Lichen and moss** grow in the seams of the basalt slab: use real procedural growth (cellular or noise-driven colonies of tiny geometry or a displaced, bump-mapped decal layer), concentrated at seams, corners and the bottom edge. They should be photographic-looking, not cartoon blobs: crisp micro-detail, colour variation (olive, ochre, grey-green, pale sage), dried tips, a few tiny spore stalks.
- A few **real-feeling props** sit in the scene, as 3D objects with physical materials and shadows: a river-pebble paperweight, a sprig of dried fern lying across a corner of the slab (alpha-cutout leaflets with thickness, subtle sway from a "draught"), a small snail shell, brass pins. Keep props few and quiet, and never over the working area.
- **Water/dew**: tiny dew drops on the glass lenses and on the lichen, modelled as refractive/transmissive spheres (MeshPhysicalMaterial transmission + IOR 1.33) that catch the lantern highlight.
- Subtle floating dust motes in the lantern beam (a few dozen soft particles), barely visible.

### 6. Material and lighting spec (physically based; this is the core of the "real" look)

Build the scene in **Three.js (r160 or newer, ES modules via an import map from a CDN such as jsdelivr/unpkg)** with WebGL2:
- `MeshPhysicalMaterial` / `MeshStandardMaterial` with real `roughnessMap`, `metalnessMap`, `normalMap`, `bumpMap`, `aoMap`, `clearcoat` (for lacquered brass and glass), `transmission` and `thickness` (for glass), `anisotropy` (for brushed metal), and `sheen` (for paper/vellum and moss).
- **Generate all texture maps procedurally at load** onto offscreen canvases (fbm / Worley / ridged noise, directional streaks for brushed metal, voronoi cracking for basalt, fibre noise for paper). NO flat colours and NO CSS gradients standing in for materials. Every surface needs micro-roughness variation, edge wear and grime in crevices.
- **If your environment gives you image-generation or media tools, use them to create seamless, tileable, PHOTOGRAPHIC texture maps** (NOT painted, NOT illustrated, NOT anime, NOT concept-art) and feed them into the materials. Use prompts in this style, naming the camera, lens, film stock and light: *"Seamless tileable texture, top-down macro photograph of wet dark basalt, Sony A7R V, 90mm macro, f/8, overcast diffused light, visible fine grain and mineral flecks, tiny hairline cracks, one patch of olive lichen at the lower edge, no text, no vignette"*; *"Seamless tileable macro photograph of aged brass with fingerprint smudges and green verdigris in the crevices, 100mm macro, raking light from the left"*; *"Seamless tileable macro photograph of cast black iron with fine casting pores and worn bright edges, Kodak Portra 400 look"*. If media tools are not available, the procedural maps above are the required fallback.
- **Lighting**: one warm point/spot light (the lantern, about 2700K) with soft real-time shadows (PCFSoft or VSM, shadow map 2048), a very dim cool hemisphere fill, and an environment map for reflections (use `RoomEnvironment` through PMREM, or a generated small HDR-like gradient with a visible warm window and a dark ceiling). ACES filmic tone mapping, sRGB output, subtle bloom only on lamps and lantern, SSAO or a baked AO term in crevices, very light film grain and vignette in a final pass.
- **Depth of field is allowed but subtle**: far props slightly soft. Do not blur anything interactive.

### 7. 3D fonts: how to do them for real

- **Hero and numerals**: extrude real glyph outlines. Load a Google Font file (fetch the TTF/WOFF from fonts.gstatic.com), parse it with **opentype.js** (CDN), convert glyph paths to `THREE.Shape`s, and extrude with `ExtrudeGeometry` (depth 0.12-0.3 em, bevelEnabled with small bevelSize and 3-4 bevel segments, curveSegments 12). Cache geometries. Provide a **fallback**: layered DOM text extrusion (30-60 stacked `translateZ` copies of the same real font with progressively darker colour, plus a final soft drop shadow) so the type is still visibly solid if the fetch fails.
- **Font choices (Google Fonts only; avoid Inter, Roboto, Space Grotesk, Cinzel, Playfair, and any default-looking pairing)**: pick a distinctive small-caps humanist serif for titles (candidates to evaluate in the real render: *Cormorant SC*, *Marcellus SC*, *IM Fell English SC*, *Newsreader*, *Spectral SC*), a condensed or engraved display face for numerals (*Big Shoulders Display*, *Oswald* is too common, prefer *Big Shoulders* or *Antonio*), a quiet text face (*Hanken Grotesk*, *Spectral*), and a tabular mono for data (*IBM Plex Mono*, *JetBrains Mono*). Tell me which you chose and why.
- Engraved text on plaques and tablets is rendered as bump/normal-mapped text on the material (canvas-drawn alpha used as a bump map) so it truly looks cut into the metal.

### 8. Architecture (keep it usable, not just pretty)

- A full-window WebGL canvas renders the world (slab, lantern, props, HUD hardware, extruded type, tablets, sockets). **DOM overlays** (absolutely positioned, aligned to 3D objects) carry real selectable, accessible text: row labels, the search field, filters, the item panel body copy. Text must be sharp at 1x and 2x pixel ratio.
- Cap `devicePixelRatio` at 2. Pause rendering when the tab is hidden. Instance repeated geometry (`InstancedMesh`) for the tablet rack. Target a steady 60fps on an Apple Silicon laptop.
- Working interactions: navigation across ALL six views with a physical transition (the slab slides, the old view's objects drop away and the new ones rise out of their grooves, 400-600ms eased); selection, hover and focus states for every object; keyboard (`1`-`6` views, arrows to move, Enter to select, Space play/pause, `/` search, Esc close panel); search and status filters that actually filter; play/pause that moves the playhead, drives the meters and swings the lantern; draggable knob; jobs that advance and complete; `prefers-reduced-motion` respected (no swing, no parallax, instant transitions).
- Provide a visible, always-working **"Flat mode" toggle** (a small switch in the title bar) that turns off WebGL and shows a plain, fast, accessible 2D layout of the same content, for low-power machines and accessibility.
- Realistic data: invent 130 beats with believable names, BPMs (70-170), keys (F# min, Ab maj, ...), statuses, plays and earnings; sales and splits that add up (all totals computed from the data).

### 9. Hard "no" list (these are what make designs look like AI slop)

NO glassmorphism cards. NO rounded-rectangle cards with a soft shadow. NO gradients standing in for materials. NO neon glow outlines. NO purple/blue gradient anything. NO emoji, NO stock icon sets (Heroicons, Lucide, Material). NO painted, illustrated or anime backdrops. NO lorem ipsum. NO ornate skull/filigree clip-art frames. NO generic "dashboard with stat tiles" layout. NO centred hero with a gradient blob. Do not use more than one accent colour family. If a part of the UI looks like it came from a Tailwind template, redo it.

### 10. Self-check before you finish (do this, do not skip)

1. Open the page in a browser, take screenshots at 1440x900 of: Library (tablet rack, with a selected item and item panel), Library (dense list mode), Crate, Ledger, Rig, the HUD close-up with the knob and meters, and the extruded wordmark. Look at each screenshot critically.
2. Ask: *Would this fool someone into thinking it was a real object photographed in a studio?* If any surface still looks like flat colour with a shadow, fix the material.
3. Check the console for errors, check that the knob, nav, search, filters and play/pause all work, and that Flat mode works.
4. In your final message, list the three weakest-looking things you could not fix, and the exact libraries and fonts used.

---

## What "done" looks like

A person who opens it should say "that is a physical thing", not "that is a dark theme". The extruded type, the knurled knob, the lantern-cast shadows, the lichen in the seams and the engraved plaques must each be visibly 3D and visibly lit. It must still be a usable app: fast to scan, keyboard-friendly, readable, with a Flat mode.
