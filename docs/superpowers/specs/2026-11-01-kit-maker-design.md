# Kit Maker — design

Build your own drum kit from the sounds already in the Sound Library (the producer made every sample), renamed under their own tag.

## Behaviour
- New **Kit Maker** view in the sidebar. Kit name, tag and output folder (default `~/Desktop/!DRUM KITS/! MY KITS`).
- Slots: Kicks, Snares, Claps, Hi Hats, Open Hats, 808s, Percs, FX, Vox, Loops. Hi Hats / Open Hats are split by file name (the library has one `hat` kind). Only WAVs are offered.
- Pick a slot to see a searchable, auditionable list of library sounds; click to add or remove.
- **Auto-fill** tops each slot up to a per-slot target with random picks (identical name+size files counted once). **Re-roll** replaces only the auto-picked sounds; hand-picks stay.
- **Export** copies (never moves) into `<Kit>/<Slot folder>/<Single> NN [key|BPM] @tag.wav`, zero-padded per folder. Source producers' names/tags never reach the output. Existing kit folder is never overwritten (a numbered sibling is made). Reveals the folder and rescans.
- `kit-map.json` (new name -> original path) is written to the app data folder, not into the kit.
- Draft (name, tag, folder, picks) persists in the renderer's localStorage.

## Code
- `src/shared/kitmaker.ts` — pure: slots, slot classification, naming, auto-fill (tested).
- `src/main/kitmaker.ts` — filesystem export (tested against a temp dir).
- IPC `kits:defaults`, `kits:pickFolder`, `kits:export`.
- `src/renderer/src/KitMaker.tsx` — the view.
