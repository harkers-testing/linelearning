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

### Organizing a script by Act and Scene (G2, added 2026-09; scene-editing rework added 2026-09-18)

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

**The "ghost empty scene" bug (found by Andy 2026-09-18) and its
fix.** Andy reported a script where Act 1 showed both a "Scene 1"
with 0 lines and a "Scene 1 - the location of the scene" with 70-odd
— and merging them the way v1 worked (below) picked the wrong one's
label to survive, and the same wrong split came back on a clean
re-upload. Root cause: a bare scene-number title line immediately
followed by a second, more descriptive heading line (or an Act
heading immediately followed by that act's own first scene heading)
each independently matched a heading regex and bumped `sceneSeq`,
even though nothing had happened in between — producing a permanent,
empty scene stub in front of the real one, deterministically, every
time the script was parsed. **Fixed at the source in `parseScript`**:
a new `sceneHasContent` flag tracks whether any line or stage
direction has appeared since the current scene boundary started: a
`SCENE` heading that arrives before that happens just refines the
current scene (updates `currentScene`, does *not* bump `sceneSeq`)
instead of starting a new one. `groupScenes` was also changed so that
when two heading paragraphs land in the same scene this way, the
*later* (usually more descriptive) heading text wins as the group's
`scene`/`defaultLabel`, not the first. See `test-parser-scenes.js` for
the regression tests covering this (both the "Scene 1" + descriptive-
heading case and the Act-heading-immediately-followed-by-Scene-1
case), and confirming a real scene break with actual content between
headings is still detected correctly.

**Review step — manual editing, added 2026-09-18.** The parser fix
above handles the common "two headings, nothing between them" case
automatically, but Andy also asked for the director to be able to fix
scene/line delineation by hand after reading the script, and for a
way to delete a heading. `scriptState.sceneGroups` is a flat array of
"pieces", each `{ startIndex, act, label, defaultLabel,
hasRealHeading, source, dropBoundary }` — `startIndex` is the index
into `scriptState.sequence` where that piece begins, which is what
lets a piece be inserted (a split) as well as removed (a merge), not
just picked from the parser's original list. `source` is `"parsed"`
for a scene the parser detected or `"manual"` for one the director
added. `computeEffectiveScenePieces()` is the single source of truth
for "what scenes exist right now": it filters out dropped pieces,
sorts by `startIndex`, and works out each survivor's `[startIndex,
endIndex)` range — both `renderSceneReview()` and the `saveScriptBtn`
save logic call this, so they can never disagree.

On `screen-review-script`, `renderSceneReview()` shows one row per
active piece (grouped under bold Act headers) with an editable label,
a dynamically-recomputed line count (recalculated from the piece's
current range on every render, so a merge visibly grows the survivor's
count instead of the merged row just vanishing with no trace), and —
for every piece but the first — a button: "Remove this scene break"
for a parsed piece, or "Undo this split" for a manually-added one.
Clicking it calls `mergePieceUp(piece)`, which finds the nearest
still-active preceding piece and merges into it. **Label carryover:**
`scenePieceLabelPriority()` ranks a director-typed label above a real
detected heading above a synthesized "Scene N", and the better of the
two pieces' labels survives the merge — this is the fix for Andy's
"the wrong scene's label won" complaint. **Deleting a heading:** for a
`source: "parsed"` piece, merging it away also adds its `startIndex`
to `scriptState.deletedHeadingIndices`, so that heading's own text is
dropped from the saved script entirely at save time, not just its
effect on scene boundaries — this is how "delete a heading" works,
folded into the same action rather than being a separate control.

Each active piece with at least one line or stage direction inside it
also gets a **"Split this scene"** control: a dropdown of that scene's
own lines/directions (short previews) plus a "Split here" button.
Choosing one and clicking it calls `splitPieceAt(piece, atIndex)`,
which splices a new `source: "manual"` piece into `sceneGroups` right
after the one being split — this is how a director inserts a scene
boundary the parser missed.

At save time, `saveScriptBtn`'s handler calls
`computeEffectiveScenePieces()` once to get each surviving scene's
final range and fresh, contiguous `sceneSeq` (in original document
order), then walks `scriptState.sequence` building the `lines` array
for `save_script` — skipping any index in `deletedHeadingIndices` and
renumbering `seq_index` contiguously via the output array's own
running length (since a deleted heading means the original positions
are no longer back-to-back).

None of this needed a schema change — `save_script`'s `lines` jsonb
shape (`seq_index, type, character_name, text, act_label, scene_label,
scene_seq`) is exactly what schema v7 already expected. **This
editing UI lives on the pre-save review screen** — for scene/line
fixes to an already-saved show, see "Editing a saved script's lines"
below, which is a separate, more general editor added later. That's
safe for casting either way: `save_script` already keeps the existing
invite code and claim for any character name that still appears in
the new script, so fixing scene boundaries or line text doesn't lose
actor assignments as long as character names are unchanged.

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

**Editing a saved script's lines (show admins only, added
2026-09-20).** Andy read a script live and found lines the parser had
blended together (a "blended paragraph" mis-split, not the ghost-scene
bug above), and asked for a director-only way to fix wording, splits,
speakers, and stray/missing lines after the fact, not just before
saving — "I imagine they would have the incentive to read the play and
adjust it first beforehand." An "Edit this scene" button (hidden
unless `currentShowIsAdmin`, set in `openShow`) appears on
`screen-read-scene`; clicking it swaps the read-only view for an
editable list of every row in that scene (`editSceneState.rows`,
`renderEditSceneLines()`) — including its own heading row, and
including any `unassigned` rows (Reading mode itself skips displaying
those, but the editor needs to show everything so a stray misclassified
paragraph can actually be found and fixed). Each row has a type
dropdown (heading/direction/dialogue/unclassified), a character-name
field (dialogue only), and a text box, plus four buttons: "Split into
two" (duplicates the row so each half can be trimmed down — no
cursor-position picker, just duplicate-then-edit, which is far simpler
on mobile), "Merge with next" (concatenates text and removes the
following row), "Insert line below" (a blank row, for something the
parser skipped), and "Delete" (removes the row outright). "Cancel"
discards every change; "Save changes" persists them.

Saving reuses `save_script` directly — **no new database function was
needed**, since it already does everything required (admin check,
replace `script_lines`, reconcile `parts` by character name so
existing invite codes/claims survive exactly like they do when
re-uploading a corrected script). The interesting part is working out
the right `act_label`/`scene_label`/`scene_seq` for the save, because
editing a heading (or adding/removing/reclassifying one) can change
how many scenes this one scene's worth of rows now represents, without
disturbing anything else in the script:

- `before` = every row with `scene_seq < seq`, `after` = every row
  with `scene_seq > seq` (`seq` being the scene being edited) — both
  read straight from `readState.lines`, i.e. the database's last saved
  state, not from anything already touched by scene-review-screen
  editing.
- Only the edited scene's own rows get freshly tagged, via
  `ScriptParser.tagActsAndScenes(editSceneState.rows, seed)` — the
  `seed` parameter (added alongside this feature) lets tagging
  *continue* from a starting point instead of always starting blank,
  seeded with whatever `before`'s last row's act/scene/sceneSeq was
  (or the untouched defaults if this is the very first scene). This is
  what makes a heading added or removed *inside* the edited scene
  correctly split it into more scenes or collapse it into fewer,
  using the exact same ghost-scene-prevention rule as a fresh upload.
- `after`'s rows are **not** re-tagged — their `act_label`/`scene_label`
  are carried over completely unchanged, and only `scene_seq` shifts,
  by whatever `seqDelta` the edited scene's new scene count implies
  (0 if unchanged, +1 if it split in two, -1 if it fully collapsed into
  `before`, and so on). This is the fix for a real bug hit while
  building this: re-tagging the *whole* document from scratch on every
  scene edit was quietly discarding every other scene's
  director-customized label (e.g. a scene renamed "The Market" on the
  pre-save review screen would revert to its raw "SCENE 2" heading
  text, or to nothing at all, the moment any other scene was edited
  here) — seeing `test-group-app.js`'s "the untouched scene after it
  keeps its own custom label" check before touching this logic again.
- One more subtlety, handled the same way `groupScenes` already does
  it for a fresh parse: a scene with no real heading text of its own
  (the common case right after an Act heading) needs a synthesized
  "Scene N" fallback, not a blank label. `ScriptParser.groupScenes()`
  is called one more time on the fully-assembled row list purely to
  get that per-act numbering; any row that already has real label text
  (a genuine heading, or a preserved custom label from `before`/
  `after`) passes straight through unchanged.

Known, accepted edge case: this does **not** re-check whether the
edited scene's own trailing heading should ghost-merge with whatever
untouched heading immediately follows it in `after` (the same rule
that prevents two heading paragraphs with nothing between them from
creating an empty scene during upload) — only re-uploading the whole
script re-runs that check across the entire document. In practice this
only bites if a heading is deliberately left as the very last row of
an edit with zero real content after it before the next scene's own
heading, which isn't a realistic way to use "Insert line below".

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

Three test scripts cover `group-app/`:
- `test-group-app.js` — fast Playwright suite, uses a hand-written
  Supabase stand-in (also stubbing `window.pdfjsLib` with fake page
  text laid out so parser.js's real paragraph-reconstruction logic
  runs unmodified — see the comment in the test file for why the fake
  gaps are sized the way they are). Covers all the app's screen flows
  and button logic, including script upload/review/save, part
  assignment, claiming a part by code (including a "someone else
  already claimed it" case), the general-code fallback, admin
  unassign, a director claiming a part in their own show (and still
  seeing admin controls alongside their own "Practice my lines"), the
  Act/Scene review UI (detected scenes, default labels, "Remove this
  scene break", "Split this scene"), Reading mode (scene browsing,
  full scene text, own-line highlighting), the post-save "Edit this
  scene" line editor (split/merge/insert/delete mechanics, cancel
  discarding changes, a real save round-trip, and — the trickiest
  part — that inserting a new heading correctly splits a scene into
  two while an untouched scene further along keeps its own
  director-customized label rather than losing it to renumbering), and
  Practice mode's scene picker + per-scene cue/hint/reveal behaviour
  including "Reveal all" persisting across scene navigation — 98
  checks as of this writing.
  The mock's `.from(table).select(...)` returns a chainable object so
  `.eq()` can be called more than once before
  `.order()`/`.single()`/awaiting it directly (needed for the
  `show_members` lookup, which filters by both `show_id` and
  `user_id`). The fake PDF page text (in `window.pdfjsLib`) includes
  two scenes (ACT I with an unheaded first scene, then an explicit
  SCENE 2) so scene review/navigation has more than one scene to
  exercise — see the comment above it in the test file before changing
  the exact wording of any line in it, since several checks match
  specific substrings. Run with a static file server on port 8766
  pointed at `group-app/`, then `node test-group-app.js` (both from
  the repo root — the test file itself lives at the repo root, not
  inside `group-app/`).
- `test-parser-scenes.js` — fast, no browser and no server needed
  (added 2026-09-18 alongside the "ghost empty scene" fix — see
  "Organizing a script by Act and Scene" above). Calls `parseScript`
  in `group-app/parser.js` directly with hand-built fake PDF page
  items, and checks: a bare scene-title heading immediately followed
  by a more descriptive heading (with nothing between them) collapses
  into one scene, not two, with the later heading's text as the label;
  an Act heading immediately followed by that act's own first scene
  heading behaves the same way; and a genuine scene break with real
  content before it is still correctly detected as two scenes (i.e.
  this fix doesn't cause the parser to under-detect real scene
  breaks). Run with `node test-parser-scenes.js` from the repo root.
  Any future change to the heading-detection logic in `parseScript` or
  `groupScenes` should keep this passing.
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
see "Organizing a script by Act and Scene" above). Andy tried it live
with a real script and found two real bugs (the "ghost empty scene"
splitting a scene in two, and the wrong scene's label surviving a
merge) plus asked for manual scene-editing controls and a way to
delete a heading — all of that is fixed/built (2026-09-18), fully
self-tested, and needed **no schema change** (still schema v7).

Andy then read a saved script live and found lines the parser had
blended together, and asked for a director-only way to fix wording,
line splits/merges, speakers, and stray/missing lines on an
already-saved script, not just before saving. That's built too
(2026-09-20): "Edit this scene" in "Read the script" — see "Editing a
saved script's lines" above — fully self-tested, also **no schema
change**. Next step: Andy tries both of these live — re-uploads the
script that showed the original scene-splitting bug to confirm it's
gone and the new "Remove this scene break"/"Split this scene"
controls work, and separately tries "Edit this scene" on a scene with
a blended line to confirm the fix and that his existing cast
assignments/custom scene labels survive it.

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
