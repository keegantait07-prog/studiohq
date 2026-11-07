# Lead Finder — design

Find small, underground artists who may want beats, collect the contact details they publish themselves, rank them by fit, and pitch them through the existing CRM.

## Goal and success criteria
- A producer can build a large, ranked list of small artists (hundreds) without browsing each one by hand.
- Big-follower accounts rank low; artists who publicly ask for beats rank high.
- Every lead shows where its contact email came from and why it got its score.
- Pitching reuses the existing CRM (contacts, pitches, templates, follow-ups). Nothing in it is duplicated.
- No one on the suppression list can be pitched.

## Out of scope
- **Scraping Instagram** (logged-in or automated). It breaks Meta's terms, risks the producer's account, and carries no "needs beats" signal. Instagram handles enter only by paste/CSV import or manual saving.
- Guessing or buying email addresses. Only emails the artist published (bio, link-in-bio page, website contact page, YouTube About) are stored.
- Sending email from Gmail in batches (phase 2, see below).
- Auto-DMing on any platform.

## Behaviour
- New **Leads** view in the sidebar.
- **Add leads** three ways: search a source (YouTube, SoundCloud, Audiomack, Reddit, X), paste handles/links, or import a CSV.
- Each lead row: name, source, profile link, follower/play count, last activity, fit score with its reasons, contact email with its source page, status (new, saved, in CRM, skipped).
- Filters by source, score, has-email, status. Bulk **Add to CRM** and **Skip**.
- **Add to CRM** creates a normal `contact` (role `artist`, email, links, sound note) and opens the existing `PitchDialog`.
- **Contact lookup** runs only on leads the producer added, one at a time with a delay (no bulk crawling), reading the public pages the artist links: link-in-bio, website contact page, YouTube About. It stores the email and the URL it came from.
- Sources needing an API key show a "connect" card in Settings instead of failing.

## Scoring
Plain, explainable formula (no model call). Points for: small following, recent uploads, genre match with the producer's beats, and a public request for beats (Reddit "looking for beats" post, bio text such as "need beats", recent "need a producer" post). Penalty for large following. Each lead stores a `reasons` list shown in the UI. Pure function, unit tested.

## Outreach
- **Version 1:** build the pitch from the chosen template plus beat links from the library and open it in the mail app (`mailto:`); log the pitch in the CRM on click. Existing follow-up timing applies.
- Every pitch includes a one-line opt-out. Replying "stop" is recorded by the producer (button on the contact), which adds the address to the suppression list.
- Suppression is checked before composing and before any future send. A suppressed address cannot be pitched.
- **Phase 2 (separate spec):** send via Gmail API in small daily batches. Requires a Google OAuth scope and review; deferred deliberately.

## Compliance notes
Contact data is limited to what the artist published; each email keeps its source URL; the opt-out and suppression list are mandatory in the pitch flow. These support, but do not replace, the producer's own responsibility under CAN-SPAM/GDPR/CASL.

## Data
- `leads(id, source, source_id, name, url, followers, last_active_at, genre, signals TEXT(json), score, reasons TEXT(json), email, email_source_url, status, contact_id, created_at)`; unique on `(source, source_id)`.
- `suppressed(email PRIMARY KEY, reason, created_at)`.
- Migration follows the existing `db.ts` pattern (`CREATE TABLE IF NOT EXISTS`) and is covered by a migration test.

## Code
- `src/shared/leads.ts` — pure: types, scoring, email normalising, CSV/handle parsing (tested).
- `src/main/leads/` — `index.ts` (store: add, list, promote to CRM, suppress), `sources/{youtube,soundcloud,audiomack,reddit,x}.ts` (each exports `search(query, opts)`; `fetch` injected for tests), `contact-lookup.ts` (rate-limited public page reader).
- `src/main/ipc/business.ts` — handlers `leads:list`, `leads:search`, `leads:import`, `leads:lookupContact`, `leads:promote`, `leads:skip`, `leads:suppress`.
- YouTube source reuses `YtAuth` and the research quota meter in `ytkv.ts`.
- API keys stored with the existing secrets helper.
- `src/renderer/src/Leads.tsx` — the view; lazy-loaded like other views. Uses current theme styles (no restyling). A layout mockup is shown to the producer for approval before the UI is built.

## Errors
- Source failure or quota exhaustion shows a message on that source only; cached results remain.
- Lookup finding no email leaves the lead without one; nothing is guessed.
- Promoting a lead already in the CRM (same email) links to the existing contact.

## Testing
- Unit: scoring, email/handle parsing, CSV import, suppression check, dedupe on `(source, source_id)`.
- Each source parser tested against recorded fixture responses with injected `fetch`.
- Store and migration tested against an in-memory database.
- Contact lookup tested for rate limiting and for storing the source URL.
- UI checked in the running app after build.

## Build order
1. Shared types, scoring, tables, store, suppression.
2. YouTube source, paste/CSV import, Leads view (list, filters, Add to CRM).
3. Contact lookup and the pitch opt-out flow.
4. SoundCloud, Audiomack, Reddit, X sources.
