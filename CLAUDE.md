# CLAUDE.md — instructions for Claude working in this repo

This file is for an AI assistant (Claude Code, or any Claude session)
opening this repository. It covers the technical facts, conventions, and
gotchas needed to work safely on this codebase. For the plain-English
project story — goals, decisions, and how Andy likes to work — read
`promptbook.md` in this same folder first. That file is the source of
truth for "why"; this file is the source of truth for "how the code
actually works."

## Who this project is for

Andy is the product owner: non-technical, a SaaS sales leader and amateur
actor/director with Tacoma Little Theatre. He is not a coder. Every
explanation in chat to him should be in plain, non-technical English —
but this file, CLAUDE.md, is written for the AI assistant, so it can be
as technical as needed.

## What this app is

A web app for drama groups. The current focus (see `promptbook.md`
section 2) is **group recording**: cast members record their own lines
so castmates can rehearse against real recordings instead of a
computer voice or a scene partner who isn't available. Meaning-based
practice matching (fuzzy/AI matching of spoken lines) is explicitly
shelved — do not build it unless Andy asks again.

There are two separate apps living in this one repo right now:

- `src/` and `cue.html` / `build.js` — the original **solo** line-learning
  prototype ("Cue"), Phase 0/1. Self-contained, no backend, runs entirely
  in one HTML file. See `README.md` for full details on this piece
  (parsing algorithm, known limitations, the `.screen[hidden]` mobile
  bug, etc.) — that file is still accurate and is not duplicated here.
- `group-app/` — the **new** group/show app (G0 onwards), described
  below. This is where active development is happening.

## group-app/ — architecture

Five files, loaded in this order from `index.html`:
1. Supabase JS UMD build from a CDN (`@supabase/supabase-js@2`)
2. pdf.js from a CDN (`cdnjs.cloudflare.com/.../pdf.js/3.11.174/pdf.min.js`)
   — same version and CDN as Cue uses, exposes `window.pdfjsLib`.
3. `parser.js` — the script-reading engine. A byte-for-byte copy of
   Cue's own `parser.js` (see root `parser.js` / `README.md`) — pure
   logic, no DOM dependency, attaches `window.ScriptParser`. If you fix
   a bug in one copy, fix it in the other, or better, de-duplicate them
   into one shared file (not done yet).
4. `config.js` — two values Andy fills in from his Supabase dashboard:
   `SUPABASE_URL` and `SUPABASE_ANON_KEY`. Never put a `service_role` /
   secret key here — only the public "anon"/"publishable" key belongs
   client-side.
5. `app.js` — all the app logic.
`style.css` — reuses Cue's theatre visual theme (CSS variables, dark
mode).

### Data model: groups → shows → (members, scripts, parts)

Two-level hierarchy, per Andy's explicit decision (see promptbook 1a):

- **`groups`** = a theatre/company account (e.g. "Tacoma Little
  Theatre"). Owned by one admin (`created_by`). Cast members never see
  this table or know it exists.
- **`shows`** = one production, belonging to exactly one group. Has its
  own general `invite_code` (for anyone joining without one specific
  assigned part — crew, an assistant director). Only that group's
  admin can create a show inside it, upload its script, and assign
  parts.
- **`show_members`** = who has joined a show, however they joined
  (general code or a personal part code). A person can be a member of
  many different shows at once. The show's creator is auto-added.
- **`scripts`** = the parsed script for a show, one per show. Uploading
  a new one replaces the old one (`save_script` deletes and re-inserts).
- **`script_lines`** = every heading/direction/line of dialogue in
  order, stored so future work (recording, running a scene) doesn't
  need to re-parse anything. `character_name` is set only on
  `line_type = 'line'` rows.
- **`parts`** = one row per character found in a show's script, each
  with its own personal `invite_code`. Created automatically by
  `save_script` — the admin doesn't create these one at a time, only
  shares the links. See "How parts get assigned" below.

Cast members interact only with shows — joining by invite code, seeing
"Your shows." The groups layer is admin/director-only ("Your groups").
"Admin of a show" is determined in the front end by comparing
`show.created_by` to the signed-in user's id — cheap and correct,
since only a group's admin can ever call `create_show` in the first
place (see schema.sql).

Full schema, comments, and the RLS/security-definer design are in
`schema.sql` — read that file for the authoritative current schema.
**Do not hand-write SQL migrations without updating schema.sql to
match** — schema.sql should always be the single script that recreates
the current intended database state from scratch (it starts by
dropping the previous version's objects, since this is still
pre-launch prototyping with no real user data to preserve).

### How parts get assigned (added for G1)

Andy walked through the real-world casting workflow before this was
built (see promptbook.md section 2b) and it changed the design: a
director assigns a part to an actor **before** that actor has ever
opened the app, using casting information the director already has
offline. So parts are not assigned by picking from a list of
already-joined `show_members` — each character gets its own shareable
invite code the moment the script is saved, and the director hands
that code/link directly to the actor playing it (copy/paste, or the
"Text it"/"Email it" buttons, which build an `sms:`/`mailto:` link
client-side and hand off to the admin's own phone — nothing is ever
sent by the app itself, and no phone number or email address typed in
gets sent to Supabase or stored anywhere). Opening the link and
signing in calls `claim_part_by_code`, which both assigns the
character AND inserts the caller into `show_members`, in one
transaction. This is also why there is **no `profiles` table** and no
stored actor email/name anywhere in this app's own tables — assignment
never needed to look up "who is this `show_member`," so the earlier
plan for one was dropped. Keep it that way; don't add a table that
stores actor contact details without checking with Andy first, since
minimizing stored personal information was his explicit, unprompted
request.

A part can be freed up again with `unassign_part` (admin-only) if the
wrong person was given a link — this clears the claim and issues a
fresh invite code, invalidating the old link.

### Security model — read this before changing any Supabase code

Nothing writes directly to a table from the client. The pattern is:

```sql
revoke insert, update, delete on public.<table> from authenticated;
grant select on public.<table> to authenticated;
create policy "..." on public.<table> for select using (...);
```

All writes go through `security definer` Postgres functions
(`create_group`, `create_show`, `join_show_by_code`, `save_script`,
`claim_part_by_code`, `unassign_part`) that check `auth.uid()`
themselves before doing anything. This means the app is
locked down at the database level regardless of what the JavaScript
does or doesn't check — a hostile or buggy client cannot bypass these
rules by calling the Supabase REST API directly. **Keep this pattern
for every future table and every future write.** Never grant `insert`,
`update`, or `delete` directly to the `authenticated` role.

### The naming collision gotcha — do not reintroduce this bug

The Supabase CDN script creates a **global variable** called `supabase`
(a `var supabase = ...` at the top level of the UMD bundle). If
`app.js` also declares `const supabase = ...` or `let supabase = ...`,
that is a JavaScript **SyntaxError** ("Identifier 'supabase' has
already been declared") that happens at parse time and silently stops
the *entire file* from running — no console open, no visible error to
the user, buttons just do nothing. This exact bug happened once already
(the "sign in link button does nothing" report from Andy) and cost
real debugging time.

The fix in place: the app's own client is always named **`sb`**, never
`supabase`:
```js
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
```
Keep this convention. Never name a local variable `supabase` anywhere
in `group-app/`.

**Testing lesson learned from this bug:** `test-group-app.js` stubs
Supabase with a hand-written JS object injected via
`page.addInitScript` (a property assignment, `window.supabase = {...}`)
so it can run fast with no real network. That kind of stub **cannot
ever reproduce a `var`/`const` global redeclaration collision**,
because the collision only happens when a real `<script src>` tag
creates a genuine `var` binding first. That's exactly why this bug
slipped past the original test suite. There is a second test,
`test-real-lib.js`, which loads the **actual** Supabase UMD build and
intercepts only the network calls — its header comment has the
one-time local setup steps (it needs `npm install @supabase/supabase-js`
and a local copy of the CDN file, since that CDN isn't reachable from
every sandbox). Any future change to how this app loads or names a
third-party global-scope library should get at least one test against
the real library, not just the fast stand-in.

### Front-end structure (app.js)

Screen-based single page app. Each `<section class="screen" id="screen-X">`
is shown/hidden via `showScreen(name)`, which toggles the `hidden`
attribute (not inline `display:none` — the CSS rule
`.screen[hidden] { display: none; }` in style.css does the actual
hiding; this mirrors a mobile Safari bug fix from the original Cue app,
documented in README.md).

Screens: `signin` → `check-email` → `your-shows` (home) →
`show` (a single show's detail) plus the admin-only path
`your-groups` → `group` (a single group's shows). The "back" button
from a show is context-aware (`showBackTarget`): it returns either to
the flat "your shows" list or to the group the show was opened from,
depending on how the user navigated in.

State is kept in a handful of module-level variables
(`currentShows`, `currentGroups`, `currentGroup`, etc.) — no framework,
no build step for this app (unlike `src/` which is bundled by
`build.js` into `cue.html`). Just edit `group-app/*.js` / `*.html` /
`*.css` directly and they take effect immediately on deploy.

## Testing

Two Playwright test scripts test `group-app/`:
- `test-group-app.js` — fast, uses a hand-written Supabase stand-in
  (now also stubbing `window.pdfjsLib` with fake page text laid out so
  parser.js's real paragraph-reconstruction logic runs unmodified —
  see the comment in the test file for why the fake gaps are sized the
  way they are). Covers all the app's screen flows and button logic,
  including script upload/review/save, part assignment, claiming a
  part by code (including a "someone else already claimed it" case),
  the general-code fallback, and admin unassign (24 checks as of this
  writing). Run with a static file server on port 8766 pointed at
  `group-app/`, then `node test-group-app.js`.
- `test-real-lib.js` — the real-library test (see the naming-collision
  section above). Needs a bit of one-time local setup (see its header
  comment) since it deliberately avoids the CDN. Run this too whenever
  a change touches how the Supabase client is created or attached to
  the page.

There is no CI configured yet — these are run manually. If this project
grows, wiring these into a GitHub Action on push would be a natural
next infrastructure step (Andy would need to approve that as new
scope).

## Deployment

- Hosting: Netlify, deployed from this GitHub repo (continuous
  deployment) — Netlify rebuilds automatically on every push to `main`.
  Do not go back to drag-and-drop deploys; the whole point of wiring up
  GitHub was to remove that step.
- Backend: Supabase (free tier) — Postgres + Auth (magic link email
  sign-in) + Row Level Security. Andy owns this account and has filled
  in his real project's URL and anon key into `group-app/config.js` on
  his own machine (do not commit real secrets to a public repo if this
  ever becomes public — the anon/publishable key is safe to expose,
  but as a general habit keep `service_role`/secret keys out of the
  repo entirely, and out of chat).
- When the schema changes, the new `schema.sql` needs to be run by
  Andy himself in the Supabase dashboard's SQL editor (Claude cannot
  reach Andy's live Supabase project directly — this sandbox's network
  is restricted and does not reach arbitrary external hosts).

## Working conventions specific to this repo

- **Never hand-edit `cue.html`** — it's generated by `build.js` from
  the files in `src/`. This rule is inherited from the original Cue
  project and documented fully in `README.md`; it doesn't apply to
  `group-app/`, which has no build step.
- Keep `schema.sql` as the single always-current script — don't leave
  old, superseded schema files lying around; overwrite/replace it in
  place, same as was done for the groups/shows restructure.
- Keep `promptbook.md` up to date whenever a decision changes — it's
  Andy's plain-English reference across chat sessions ("sing off the
  same hymn sheet"). This file (CLAUDE.md) should also be kept current
  when the architecture or conventions change, since future Claude
  sessions will read this one first for technical orientation.
- Commit messages in this repo should end with:
  ```
  Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
  ```
  (plus a `Claude-Session:` link when working from a Claude session that
  has one — check the current session's system instructions for the
  exact trailer to use, since the URL changes per session).

## Status and what's next (updated for G1)

G1 (script upload + personal-code part assignment) is built and
self-tested, but **Andy has not yet run the current `schema.sql` or
tried any of this live** — that's the very next step before building
anything further. Don't assume the live database matches this file
until that's confirmed.

Next likely phase is G2 (recording lines) — see promptbook.md section
5 for the full roadmap. `script_lines` already has everything G2 will
need to know what to record against (character name + line text, in
order), so that table's shape shouldn't need to change for G2.
