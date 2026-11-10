# Store — design

Sub-project 1 of 4 in the Studio HQ upgrade (store, connected flow, smarter assistant, new look). Each has its own spec.

Run the public beat site from one place in the app, show license tiers on it, and bring BeatStars sales into Sales and Revenue. BeatStars stays the checkout.

## Goal and success criteria
- One **Store** view shows every beat on the public site and lets the producer add, reorder, edit and publish without opening beats one by one.
- A beat whose Buy button would fall back to the general store page (no BeatStars link of its own) is visibly flagged.
- The public page shows the producer's license tiers and prices instead of the hard-coded `$15`.
- The producer sees the built page inside the app before it goes to Netlify.
- A BeatStars sales export can be imported; each order appears once in Sales and Revenue, however many times the file is imported.
- There is one storefront. The unconnected `store/` folder is gone.

## Out of scope
- Taking payment or delivering files ourselves (Stripe, Gumroad). Chosen against: BeatStars remains checkout.
- Reading sales from BeatStars automatically. It has no public sales API; import is by export file.
- Restyling the public page beyond adding the license panel and per-tier price. The page's look is live and stays.
- Restyling the app. The Store view uses existing table, toolbar and form styles only (the new look is sub-project 4 and needs an approved mockup).
- Loops on the site.

## Behaviour

### Store view
- New sidebar entry **Store**, after Sales & Collabs. Lazy-loaded like the other views. Its count is the number of beats on the site; it shows a badge when there are unpublished changes.
- Table, one row per `site_beats` entry in site order: position, title on site, genre, BPM, key, BeatStars link, state.
- State per row: **live**, **changed** (edited since the last publish), **no link** (empty link, so Buy opens the general store URL), **file missing**, **sold exclusively** (kept in the list, not published).
- Title, genre and link are edited in place. Rows reorder by drag and by keyboard (move up / move down buttons), writing `position`.
- **Add beats** opens a dialog listing finished beats with audio that are not on the site, with a search box and a checkbox per beat, so several can be added at once (the existing `BeatPicker` picks one beat only, so it is not reused here). Adding does not publish.
- **Remove** takes selected rows off the site. Removing does not publish.
- Toolbar: **Preview**, **Publish** (shows the same progress steps as today), **Open site**, and a filter for "needs a link".
- With no Netlify token the view explains that and links to Settings; editing still works, Preview still works, Publish is disabled.
- The per-beat **Beat site** card in the beat panel stays and reads and writes the same rows. Its **Send to site** keeps publishing immediately, as today.

### Preview
- **Preview** builds the site folder exactly as publishing does, without deploying, and opens `index.html` from that folder in a preview window (a plain `BrowserWindow` with no preload, navigation locked to that file and its audio).
- Building is split out of `doPublish` into `build()`; `publish()` becomes `build()` then deploy. One build runs at a time, sharing the existing queue.

### License tiers on the public page
- The page data gains `licenses`: every row of `license_types` in `sort` order as `{ name, exclusive, price }`, where `price` is `default_price` (omitted when null).
- A new license panel on the page lists each tier with its price and what it includes.
- "What it includes" is new data: `license_types` gains `files TEXT NOT NULL DEFAULT ''` (for example `MP3 + WAV`) and `perks TEXT NOT NULL DEFAULT '[]'` (JSON list of short lines). Added by one new migration step. Edited in the license editor that already exists in Sales & Collabs.
- The per-beat price on a row is the lowest non-null, non-exclusive tier price, shown as "from $X". If no tier has a price, the price is not shown. The hard-coded `PRICE = 15` and the "Lease it for $15" step text are removed in favour of the same value.
- Buy still opens the beat's BeatStars link, or the general store URL when it has none.
- The license perks text from `store/data.js` is offered as the starting content: on first run after the migration, tiers whose names match (`MP3 Lease`, `WAV Lease`, `Unlimited`, `Exclusive`, compared case-insensitively) get those files and perks if theirs are empty. Nothing else is created or renamed.
- `store/` is deleted from the repository once the panel is ported.

### BeatStars sales import
- **Import BeatStars sales…** in Sales & Collabs, and dropping a `.csv` on that view, start an import.
- Step 1, read: the file is parsed as CSV (quoted fields, embedded commas and newlines, BOM, CRLF). The header row is matched to the fields we need by name: order id, date, beat title, license, buyer name, buyer email, gross amount, fee or net amount.
- Step 2, map: if any required field (order id, date, beat title, gross amount) was not recognised, the dialog shows the file's column names and the producer picks which is which. The mapping is remembered in `settings` (`beatstars_columns`) for next time. Known header names live in one table in the importer so real files can extend it.
- Step 3, match: each row is matched to a beat by title: exact site title, then exact Vault title, then the same after `siteTitle()` normalisation and case folding. A row matching several groups, or none, is **unmatched** and the producer picks the beat from `BeatPicker` or skips the row.
- Step 4, review: a table of rows marked **new**, **already imported**, **unmatched**, **skipped**, with totals. Nothing is written until **Import**.
- Writing: one transaction. Each new row becomes a `sales` row with `source='beatstars'`, `price` = gross, `fee` = fee (or gross − net when only net is given, never below 0), `license_name` from the file, `license_id` set when the name matches a tier, `exclusive` from the matched tier (or when the license name contains "exclusive"), `buyer`/`buyer_email` from the file, `sold_at` from the date.
- Duplicates: `sales` gains `external_id TEXT` with a unique index on `(source, external_id)` where `external_id` is not null (same migration step as the license columns). The BeatStars order id is stored there; when one order has several beats the id is `<order>:<line number within the order>`. A row whose id already exists is **already imported** and is not written.
- Exclusive sales follow the existing rule: the beat's group is marked `sold` and comes off the site at the next publish, and the Store view is marked as having unpublished changes. A row that would break the existing exclusive lock (a sale dated after an exclusive sale of the same beat) is not written and is listed with that reason.
- Refunds and rows with a zero or negative amount are listed and skipped.

## Structure
- `src/main/catalog.ts`: add `build()`, `reorder(ids)`, `addMany(ids)`, `removeMany(ids)`, per-row state in `status()`; licenses in page data. Tier price logic is a pure exported function.
- `src/main/catalog-page.html`: license panel, "from" price.
- `src/main/beatstars-import.ts` (new): `parseCsv`, `detectColumns`, `matchRows`, `planImport` (all pure, no database writes) and `applyImport(db, plan)`.
- `src/main/db.ts`: one migration step (license `files`/`perks`, sales `external_id` and its index).
- `src/main/ipc/app.ts`: `site:build`, `site:preview`, `site:reorder`, `site:addMany`, `site:removeMany`. `src/main/ipc/business.ts`: `sales:importRead`, `sales:importApply`.
- `src/shared/types.ts`, preload: types and bridge methods for the above.
- `src/renderer/src/Store.tsx` (new view), `ImportSalesDialog.tsx` (new), sidebar entry and icon in `App.tsx` / `Icons.tsx`, license fields in the existing license editor.
- File paths chosen in the renderer go through the existing safe-path checks.

## Errors
- Publish and preview failures show the message in the Store toolbar and leave the rows unchanged; the previous published site stays up.
- A file that is not CSV, is empty, or has no header row is refused with a plain message before any mapping step.
- A failed import transaction writes nothing.

## Testing
- Unit (vitest): CSV parsing edge cases; column detection and remembered mapping; title matching including ambiguous and missing; duplicate detection across two imports of the same file; fee from net; exclusive rule and lock; refund rows skipped; "from" price selection; migration on a database at the current version and on a fresh one; reorder positions.
- Page build: `build()` against a temporary database writes `index.html` containing the licenses and no hard-coded price.
- In the running app: add, reorder, edit, preview and import a file, checked by hand in the dev build. Publishing is checked against the `STUDIO_HQ_NETLIFY_API` override, not the live site.

## Open input
- A real BeatStars sales export, to fill the known-header table. Without one the importer still works through the column-picking step.
