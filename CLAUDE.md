# CLAUDE.md — instructions for Claude working in this repo

This file is for an AI assistant (Claude Code, or any Claude session)
opening this repository. It covers the technical facts, conventions, and
gotchas needed to work safely on this codebase. For the plain-English
project story — goals, decisions, and how Andy likes to work — read
`product-spec.md` in this same folder first. That file is Andy's own
living spec (he edits it directly himself, so always re-read it fresh
rather than assuming it still matches what Claude last wrote) and is
the source of truth for "why"; this file is the source of truth for
"how the code actually works."

## Who this project is for

Andy is the product owner: non-technical, a SaaS sales leader and amateur
actor/director with Tacoma Little Theatre. He is not a coder. Every
explanation in chat to him should be in plain, non-technical English —
but this file, CLAUDE.md, is written for the AI assistant, so it can be
as technical as needed.

## What this app is

A web app for drama groups. The current focus (see `product-spec.md`
section 6) is **group recording**: cast members record their own lines
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
3. `parser.js` — the script-reading engine. Started as a byte-for-byte
   copy of Cue's own `parser.js` (see root `parser.js` / `README.md`) —
   pure logic, no DOM dependency, attaches `window.ScriptParser`. **The
   two copies have now diverged, deliberately**: this one also detects
   Act/Scene headings and tags every line with them (added for G2,
   2026-09) — Cue's solo copy does not, since Act/Scene browsing is a
   group-app-only feature. Keep this in mind before assuming a fix in
   one copy applies to the other; a bug in the shared parsing logic
   (speaker detection, paragraph reconstruction) should still be fixed
   in both, but Act/Scene-specific code belongs only here.
4. `config.js` — two values Andy fills in from his Supabase dashboard:
   `SUPABASE_URL` and `SUPABASE_ANON_KEY`. Never put a `service_role` /
   secret key here — only the public "anon"/"publishable" key belongs
   client-side.
5. `app.js` — all the app logic.
`style.css` — reuses Cue's theatre visual theme (CSS variables, dark
mode).

### Data model: groups → shows → (members, scripts, parts)

Two-level hierarchy, per Andy's explicit decision (see `product-spec.md`
section 3, Users & Roles):

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
  many different shows at once. The show's creator is auto-added. Also
  carries `cue_lookback_lines` (1 or 2, default 1) — added for G1.5, this
  is each cast member's own personal choice of how many lines of "who
  says what before mine" to see on their "My Part" screen, changed only
  through `set_cue_lookback`. Deliberately per person per show, not a
  show-wide setting — see "My Part" below.
- **`scripts`** = the parsed script for a show, one per show. Uploading
  a new one replaces the old one (`save_script` deletes and re-inserts).
- **`script_lines`** = every heading/direction/line of dialogue in
  order, stored so future work (recording, running a scene) doesn't
  need to re-parse anything. `character_name` is set only on
  `line_type = 'line'` rows. `act_label`/`scene_label`/`scene_seq`
  (added in schema v7, for G2) record which Act/Scene each line falls
  under — see "Organizing a script by Act and Scene" below.
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
built (see `product-spec.md` section 4, Core Workflow) and it changed
the design: a
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

Nothing in `claim_part_by_code` stops a show's own admin from claiming
a part in it too — a director can genuinely also be cast, and Andy
explicitly asked for this (2026-09-18) partly for that real-world
reason and partly because it makes testing both the admin side and
the cast side possible from a single account, without constantly
signing in and out. `openShow()` in app.js checks for the caller's own
claimed part regardless of admin status, so a director who has claimed
a part sees their admin controls (upload/manage script, the general
invite code) and their own "View my lines" button at the same time.
The assign-parts screen also has a one-click "Claim this for yourself"
button on any unclaimed part, so the director doesn't need to copy
their own invite code into the join box — it calls the exact same
`claim_part_by_code` RPC an actor's link would.

A part can be freed up again with `unassign_part` (admin-only) if the
wrong person was given a link — this clears the claim and issues a
fresh invite code, invalidating the old link.

### Organizing a script by Act and Scene (G2, added 2026-09)

`parser.js` classifies every structural heading it finds as "act"
(`ACT <roman numeral>`, or `PROLOGUE`/`EPILOGUE` treated the same way),
"scene" (`SCENE ...`), or "other" (`DRAMATIS PERSONAE`, `PREFACE`,
`THE END`, `FINIS` — meta text that doesn't change what act/scene
we're in). While walking the script, it tracks the current act/scene
and a running `sceneSeq` counter (incremented every time the act or
scene changes) and tags every item — heading, direction, line, or
unassigned — with `{act, scene, sceneSeq}`. `groupScenes(sequence)`
collapses that into one row per detected scene, with a line count and
a `defaultLabel` (the detected heading text, or a synthesized
"Scene N" for a scene with no heading of its own — common right after
an Act heading with no separate "Scene 1").

**Why `sceneSeq` and not just act/scene text:** many plays reuse
"Scene 1" in every act, so the label alone can't order or distinguish
scenes — `sceneSeq` is what the app actually groups/navigates by,
independent of what the labels say.

**Review step:** on `screen-review-script`, `renderSceneReview()`
shows the detected scenes (grouped under bold Act headers) alongside
the existing character list, each with an editable label
(`scriptState.sceneGroups[i].label`, defaulting to `defaultLabel`) and
a "Merge into previous scene" button (`dropBoundary: true`) for a
scene the parser split by mistake. **Known v1 limitation, agreed with
Andy:** you can rename a scene or merge one into the one before it,
but you can't manually move an individual line to a different scene,
or insert a missed scene boundary — that would need a full line-level
editor, not built yet. At save time, the `saveScriptBtn` handler walks
`sceneGroups` once, resolving each merged group to whatever the
nearest surviving group before it resolved to (chaining correctly
through several merges in a row) and renumbering surviving scenes'
`sceneSeq` contiguously from 0 — this is what actually goes into each
line's `act_label`/`scene_label`/`scene_seq` sent to `save_script`.

**Reading mode — "Read the script"** (`readScriptBtn` on the show
screen, shown to admin and cast alike once a script exists):
`openReadScript()` fetches all of a show's `script_lines`, groups them
with `groupSceneRows()` (the read-time equivalent of `groupScenes`,
working from already-saved rows instead of a fresh parse), and shows a
scene picker (`screen-read-script`, shared rendering via
`renderSceneListInto()`). Opening a scene (`screen-read-scene`) shows
every line in full — headings centered, directions italic, dialogue as
"NAME: text" — with the viewer's own claimed character's lines
highlighted (`.read-line-mine`) if they have one; nothing is hidden
here, unlike Practice mode. Previous/next-scene buttons walk
`sceneGroups` without returning to the picker.

**Practice mode — "Practice my lines"** (`viewMyPartBtn`, only shown
to someone with a claimed part): `openMyPart(part)` now opens a scene
picker first (`screen-my-part` — this screen changed meaning in G2; it
used to be the cue list directly), reusing the same
`groupSceneRows()`/`renderSceneListInto()` as Reading mode. Picking a
scene (`openPracticeScene`, `screen-practice-scene`) shows the
cue-context/hint-reveal list from G1.5 (`renderMyPart(lines)`, now
takes the scene-filtered lines as a parameter so cue lookback never
crosses a scene boundary), plus a "Reveal all" toggle
(`practiceRevealAll`) that shows every one of that character's lines
in the scene already expanded. This is a per-visit convenience, not a
saved preference: it resets to off each time "Practice my lines" is
opened fresh, but — per Andy's explicit request — stays on as you move
between scenes within the same visit, via prev/next-scene buttons that
don't reset it. The 1-line/2-line cue lookback setting
(`cue_lookback_lines`) is unchanged by any of this and still lives on
the scene-picker screen.

Deliberately not built yet: jump-to-next-cue / jump-to-entrance
navigation within Practice mode (still a "Step 2+" idea, not
requested again since it was first deferred) — see product-spec.md's
roadmap.

### Security model — read this before changing any Supabase code

Nothing writes directly to a table from the client. The pattern is:

```sql
revoke insert, update, delete on public.<table> from authenticated;
grant select on public.<table> to authenticated;
create policy "..." on public.<table> for select using (...);
```

All writes go through `security definer` Postgres functions
(`create_group`, `create_show`, `join_show_by_code`, `save_script`,
`claim_part_by_code`, `unassign_part`, `set_cue_lookback`) that check
`auth.uid()` themselves before doing anything. This means the app is
locked down at the database level regardless of what the JavaScript
does or doesn't check — a hostile or buggy client cannot bypass these
rules by calling the Supabase REST API directly. **Keep this pattern
for every future table and every future write.** Never grant `insert`,
`update`, or `delete` directly to the `authenticated` role.

Two further `security definer` functions, `is_show_admin(show_id)` and
`is_show_member(show_id)`, exist purely as read-only helpers *for other
policies to call* (not for the app to call directly) — see "The RLS
recursion gotcha" below for why they exist and why every future policy
that checks show membership/admin status should call them instead of
writing a fresh subquery.

There's also a view, `public.shows_public` (`security_invoker = true`),
that the front end reads from instead of the real `shows` table for
every day-to-day read (`loadShows`, `openShow`'s post-claim fetch,
`loadGroupShows`). It returns every column `shows` has, except
`invite_code` is replaced with `null` unless the querying user is that
show's own admin. Andy flagged (2026-09-09) that a cast member could see
— and potentially pass on — the show's general invite code, which is
meant only for a director to hand to crew/an assistant director. Masking
it in a view means it's never sent to a non-admin's browser at all, not
just hidden in the interface. **Keep querying `shows_public` from the
client, never `shows` directly, for anything a cast member's browser
might load** — the `security definer` functions (`create_show`,
`join_show_by_code`, `claim_part_by_code`, `unassign_part`) are the only
things that should still touch the real `shows` table.

### The RLS recursion gotcha — do not reintroduce this bug

Andy hit this live on 2026-09-09: `infinite recursion detected in policy
for relation "shows"`. It also silently broke `loadShows()`, opening a
show, and a personal part link's automatic sign-in-and-join — all of
those read from `shows` or `show_members` under the hood, so all of them
failed the same way.

**The cause:** the `shows` SELECT policy and the `show_members` SELECT
policy each checked the *other* table directly in a plain subquery (and
`show_members`'s policy even checked itself). A row's visibility on
`shows` depended on checking `show_members`, which re-applied
`show_members`'s own RLS policy, which checked `shows` again, which
re-applied `shows`'s policy, forever. Postgres detects this and refuses
with the "infinite recursion" error rather than looping forever.

**The fix:** two `security definer stable` helper functions,
`is_show_admin(show_id)` and `is_show_member(show_id)`. A `security
definer` function's own internal queries run as the function's owner
(the schema owner), and table owners aren't subject to their own table's
row-level security by default — so calling one of these from inside a
policy answers "is this person a member of this show?" without
re-triggering that table's policy and looping. Every policy that needs
to check show membership or show-admin status calls these now, instead
of repeating the subquery inline. See the comment directly above these
functions in `schema.sql` for the full explanation.

**Keep this pattern:** any *new* table whose visibility depends on
`shows` or `show_members` (e.g. a future `recordings` table for G2)
should call `is_show_admin`/`is_show_member` in its policy, not write a
fresh subquery against those two tables — that's exactly how this bug
happened the first time.

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
`show` (a single show's detail) → `my-part` (Practice mode's scene
picker, G1.5/G2) → `practice-scene` (the actual cue-context/hint list
for one scene, G2) and, separately, `read-script` (Reading mode's
scene picker, G2) → `read-scene` (a full scene's text, G2) — plus the
admin-only path `your-groups` → `group` (a single group's shows) and
`upload-script` → `processing-script` → `review-script` →
`assign-parts`. The "back" button from a show is context-aware
(`showBackTarget`): it returns either to the flat "your shows" list or
the group the show was opened from, depending on how the user
navigated in.

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
  the general-code fallback, admin unassign, a director claiming a
  part in their own show (and still seeing admin controls alongside
  their own "Practice my lines"), the Act/Scene review UI (detected
  scenes, default labels, the merge-into-previous option), Reading
  mode (scene browsing, full scene text, own-line highlighting), and
  Practice mode's scene picker + per-scene cue/hint/reveal behaviour
  including "Reveal all" persisting across scene navigation — 78
  checks as of this writing. The mock's `.from(table).select(...)`
  returns a chainable object so `.eq()` can be called more than once
  before `.order()`/`.single()`/awaiting it directly (needed for the
  `show_members` lookup, which filters by both `show_id` and
  `user_id`). The fake PDF page text (in `window.pdfjsLib`) now
  includes two scenes (ACT I with an unheaded first scene, then an
  explicit SCENE 2) so scene review/navigation has more than one scene
  to exercise — see the comment above it in the test file before
  changing the exact wording of any line in it, since several checks
  match specific substrings. Run with a static file server on port
  8766 pointed at `group-app/`, then `node test-group-app.js`.
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
- Keep `product-spec.md` up to date whenever a decision changes — it's
  Andy's own plain-English, Andy-editable living spec across chat
  sessions ("sing off the same hymn sheet"). He edits it directly
  himself too, so always re-read it (don't assume it still matches
  what Claude last wrote) before planning new work. This file
  (CLAUDE.md) should also be kept current when the architecture or
  conventions change, since future Claude sessions will read this one
  first for technical orientation.
- Commit messages in this repo should end with:
  ```
  Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
  ```
  (plus a `Claude-Session:` link when working from a Claude session that
  has one — check the current session's system instructions for the
  exact trailer to use, since the URL changes per session).

## Status and what's next (updated for G2)

G1 (script upload + personal-code part assignment) is live and
confirmed working by Andy, including the RLS-recursion fix (schema
v4) and the invite-code-masking fix (schema v5). A director claiming a
part in their own show also shipped and needed no schema change (see
"How parts get assigned" above).

G1.5 (schema v6: `cue_lookback_lines` + `set_cue_lookback`) — cue
context and the hint/reveal tap — is built and self-tested but has
**never been tried live**, since it was immediately superseded by the
G2 work below before Andy got to test it. That's fine; nothing about
it changed.

G2 — organizing a script by Act and Scene — is built and self-tested
(schema v7: `act_label`/`scene_label`/`scene_seq` on `script_lines`;
see "Organizing a script by Act and Scene" above), but **Andy has not
yet run the updated `schema.sql` or tried any of it live.** That's the
next step before building anything further: re-run schema.sql (schema
v7 — this will wipe test data again, same as every previous round),
then upload a script, check the detected Act/Scene list on the review
screen, and try both "Read the script" and "Practice my lines" from
the show screen. Known, agreed-with-Andy limitation to mention if he
hits it: the review screen can rename a scene or merge one into the
previous scene, but can't yet move an individual line to a different
scene or insert a missed scene break — that needs a fuller line-level
editor, not built.

Deliberately not built yet: jump-to-next-cue / jump-to-entrance
navigation within Practice mode — this was floated as a "Step 2+"
idea back when G1.5 was first built and hasn't been asked for again
since; Andy's actual "next" request became Act/Scene organization
instead, which is now done.

See `product-spec.md` (Andy's own living spec, which he edits
directly) for the fuller roadmap: next up is Phase B (recording —
Andy has chosen the "feels continuous, tap Next between lines"
approach, which will actually store separate per-line clips under the
hood via a new `recordings` table; silence-trimming is explicitly
deferred to a v2 upgrade), then Phase C (scene rehearsal playback,
which can now build directly on the Act/Scene grouping from G2),
Phase D (director visibility into join/recording status), and Phase E
(director feedback, multi-admin shows, a native phone app,
script-library import — all explicitly Andy's own "Phase Two" or
"parked idea" items, not started).
