# Cue — line-learning app (prototype)

Where this fits in the plan: see the "Prompt Book" build plan (published as a
Claude artifact) for the full picture. This folder is Phase 0 + Phase 1:
upload a script PDF, work out the cast and lines, review/fix them, pick your
part(s). Read mode, Voice mode, and the "Line" prompter come next.

## Files

- `cue.html` — the whole app as one file, exactly what's published at the
  Cue artifact link. Open it directly in a browser (needs internet, for the
  Google Fonts and the pdf.js library it loads from cdnjs).
- `src/` — the same app split into normal files (`index.html`, `style.css`,
  `app.js`, `parser.js`) for anyone (or any future Claude Code session)
  picking this up to keep building. Open `src/index.html` the same way
  (needs internet too — it points at the same cdnjs copy of pdf.js).
- `parser.js` is the actual "read the script" logic, and has no dependency
  on the browser or pdf.js — it just takes text-with-positions and returns
  characters + lines. That split made it possible to test the parsing logic
  on its own against a real script before wiring it into the app.
- `build.js` regenerates `cue.html` from the `src/` files (run `node
  build.js` from this folder). Always edit the `src/` files and rebuild —
  never hand-edit `cue.html` directly, since it'll just get overwritten.

## How the script-reading works, briefly

A PDF gives us text as a pile of little text fragments with x/y positions,
not paragraphs. `parser.js`:

1. Groups fragments into visual lines by y-position, then lines into
   paragraphs by looking for unusually large gaps between lines (a
   paragraph break) — using the *most common* line-to-line gap on a page as
   the "normal" spacing to compare against, since a page mixing dialogue
   and headings has a misleading average.
2. Skips everything before the first "ACT" heading (title pages, licence
   text, front-matter cast list) and stops at end-of-file boilerplate.
3. Treats a paragraph that's just "[...]" as a stage direction.
4. Treats a paragraph starting with an ALL-CAPS name (optionally after
   Mrs./Sir/etc.) as a new speech by that character; anything else
   continues the previous speaker's line.
5. Every distinct raw name the script uses becomes its own row — the app
   deliberately does NOT try to guess that "ABSOLUTE" and "CAPTAIN ABSOLUTE"
   are the same person. Guessing wrong risks silently merging two different
   characters (e.g. a father and son sharing a surname). Instead, the
   person picking their part just ticks every name that's theirs, which
   also naturally covers an actor doubling up two different roles.

Tested against a full, real, public-domain play (Sheridan's *The Rivals*,
151 pages): correctly found all 15 speaking characters, with well under 1%
of the play's paragraphs left unassigned (mostly decorative dividers and the
epilogue, which is out of scope for now — see "Known limitations" below).

## Known limitations (things to revisit, not yet bugs to fix blindly)

- Prologue/epilogue speeches (framing text spoken by "characters" outside
  the main cast list) are currently skipped entirely, starting only at the
  first "ACT" heading.
- No accounts or saved scripts yet (Phase 6) — everything lives only in the
  browser tab for the current visit.
- Runs pdf.js without its background worker on purpose, trading a little
  speed for not depending on a worker script loading correctly on every
  hosting setup.

## Mobile

Not a v1 requirement, but kept in mind since actors will likely want this on
a phone, not just a laptop. The layout is already single-column and
touch-sized (checked at an iPhone-sized viewport). One real bug did turn up
while checking this and has been fixed: `.screen { display: flex }` was
silently overriding the browser's built-in handling of the `hidden`
attribute (author CSS always wins over the browser default, regardless of
selector specificity), so every screen was rendering at once, stacked side
by side, until `.screen[hidden] { display: none; }` was added — worth
knowing if a future screen/section is added and starts "showing through"
unexpectedly.

The bigger open question for later (Phase 4/5, Voice mode) is that the Web
Speech *recognition* API — the part that listens to you, not the part that
reads lines aloud — has historically had little or no support in Safari on
iPhone (every browser on iOS uses Apple's engine under the hood, so
"Chrome on iPhone" doesn't get around this). That could mean the "free
browser speech" decision needs revisiting specifically for iPhone users
before Voice mode ships, even though it's fine for now on a laptop or an
Android phone. Worth an explicit test on an actual iPhone before building
Voice mode, rather than assuming.

## Local dev

`test-parse.js` and `test-ui.js` (this npm project) are the test harness
used to build and check `parser.js` and the app — not part of the shipped
app itself. `test-ui.js` needs Playwright and a static file server pointed
at this folder, and a local copy of pdf.js (see `vendor/`, not checked in
here) since this sandbox can't reach cdnjs — swap the script tag back to
the cdnjs URL before shipping.
