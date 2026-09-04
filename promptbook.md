# Line Learning App — Prompt Book

*Working reference for this project. If a chat runs out of room and a new one starts, paste or point it at this file first — it should have everything needed to carry on without re-explaining anything.*

*Last updated: 3 September 2026 (G1 built: script upload, personal-code part assignment -- awaiting Andy's live test)*

---

## 1. How to work with Andy on this project

Standing instructions, in Andy's own words: *"You will be a software developer and advisor for this project. I shall provide the goals and you shall provide the code to build this app using Claude Code where appropriate to do so. Please provide answers and responses in simple, non-technical English, explaining constraints clearly and asking user questions when appropriate to clarify. Questions are encouraged."*

In practice, that means:

- Andy is the product owner, not a developer. He has no or very basic coding/technical knowledge — explain things in plain English, spell out trade-offs and constraints (cost, technical limits, legal grey areas) clearly rather than assuming he'll infer them, and give detailed step-by-step instructions even for things that feel simple.
- Andy sets the goals and priorities; the assistant proposes and builds the actual solution (code, architecture, plan documents).
- Ask clarifying questions freely rather than guessing on anything that matters — Andy has explicitly said questions are welcome.
- Andy does amateur acting and directing (Tacoma Little Theatre) in his spare time — this app is scratching his own itch as well as a general drama-group problem.

## 1a. Groups vs. shows (added 3 Sep 2026)

Andy's own testing surfaced a real gap: the original "group" concept was
doing two jobs at once. Restructured into two levels:

- A **group** is a theatre or company account — one admin's (a director's
  or theatre administrator's) space for organizing every production they
  run. Cast members never see this level at all.
- A **show** is one production, living inside a group — what the app used
  to just call a "group". Only a show's parent group's admin can create
  it (and, from here on, will be the only one who can attach a script and
  assign parts — see the updated decision below). Cast members join and
  see shows directly, by invite code, and can belong to any number of
  different shows at once (e.g. acting in one while directing another).

Who can create a brand-new group is intentionally left open to any
signed-in person for now, while only Andy is testing this. Andy asked how
hard this would be to lock down later: genuinely easy — it's a single
check inside one function (`create_group`), with no knock-on changes to
shows, cast members, scripts, or recordings. Worth doing before this is
ever opened up beyond people Andy knows.

## 2. The problem and the current focus

Original idea: a solo tool to help one actor learn lines (upload a script, pick a part, rehearse against it). That work is still built and still useful (see section 5) — but the project has pivoted.

**Current focus, as of 1 September 2026:** a tool for a *dedicated drama group*, not a lone actor. Andy's problem statement: *"People in the cast need different amounts of help with learning their lines."* His feature idea: *group recording* — cast members record their own lines in their own voice, so anyone can rehearse a scene against real castmates whenever they want, without those castmates needing to be there live. Why it matters, in his words: *"If you need to continually go through a scene, you can do it with your scene partner virtually, without them having to constantly be involved."*

Group recording is the priority now, ahead of the original solo rehearsal modes (which are parked, not cancelled — see section 6).

## 2a. Admin-controlled scripts and casting (added 3 Sep 2026)

Andy's refinement: only a show's admin (its group's director/administrator)
can upload its script and, for now, assign which cast member plays which
part — not the free-for-all multi-select the original plan had cast
members doing themselves. This will shape G1 (attaching a script) when
that gets built: an upload screen and a part-assignment screen for the
admin, rather than a self-service picker for every cast member. Solo,
one-person script upload remains a possible separate area of the app
later, just not the focus now.

## 2b. How assigning parts actually works, and the real workflow behind it (added 3 Sep 2026)

Before any of this got built, Andy walked through the real end-to-end
workflow, which changed the design for the better:

1. A theatre chooses a play and a director (outside the app).
2. They cast the play with real actors (outside the app).
3. The director sets up the show in the app and uploads the script.
4. The director assigns each part to an actor -- before that actor has
   ever opened the app.
5. The director sends each actor their own link.
6. The actor opens it, signs in, and lands straight on the part they've
   been given.
7. The director tells the cast to start recording or learning lines.

The key thing step 4 revealed: assigning a part has to work for someone
who hasn't joined yet, not just for people already on a member list. Andy
also asked, unprompted, for the app to store as little personal
information as possible.

**The design that came out of this:** every character found in an
uploaded script gets its own personal invite code and link, generated
automatically the moment the script is saved -- the director doesn't
create these one at a time. The director sends that link to the actor
however suits them: copy it, or use the built-in "Text it" / "Email it"
buttons, which simply open the director's own phone's Messages or Mail
app with the message already written, ready to send. Opening the link
signs the actor in, joins them to the show, and hands them that
character, all as one step. Our own database never stores anyone's email
address or phone number anywhere -- those "Text it"/"Email it" buttons
build the message entirely inside the director's own browser and hand it
to their phone's own apps; the only email Supabase ever touches is the
one it needs privately, invisibly, to send its own sign-in link, and
nobody -- including our own app's code -- can read that back out for
another user. The show's original general invite code is kept too, for
anyone joining without one specific assigned part: crew, an assistant
director, and so on.

A director can also **unassign** a part if they picked the wrong person --
this clears the claim and issues a fresh code, so the old link stops
working.

**Staying signed in, and Face ID (also discussed 3 Sep 2026):** good news
-- this mostly already works with nothing extra to build. Supabase's
sign-in system keeps someone signed in automatically on the same phone
and browser, so an actor shouldn't need to request a new email link every
time they open the app -- only if they sign out, switch devices, or clear
their browser's data. Adding the app to the phone's home screen makes
this feel even more like a real app. Face ID / fingerprint sign-in (a web
standard called "passkeys") is technically available through Supabase,
but Supabase itself currently labels it experimental -- parked until
that's stable (see section 6).

## 3. Decisions locked in

- **Platform:** a web app, not a native phone app. Opens in any browser on any device, no app-store setup.
- **Script format:** real, text-based PDFs only — no photos or scans. Andy's call: any actor on a licensed production should be able to get a proper PDF, and photographing someone else's copy raises messier copyright questions. It also means the app can read the actual text directly rather than needing image recognition.
- **Copyright check:** a self-certification tick-box at upload ("I have the right to use this script"). No document verification, just an honesty checkbox. Already built.
- **Character matching:** no automatic guessing that two different-looking names belong to the same character. Every distinct name the script uses becomes its own row, and the person picking their part ticks every name that's theirs. This safely handles a character referred to by two names, and an actor doubling up two different roles, without ever risking silently merging two genuinely different characters.
- **Personal information:** store as little of it as possible. Assigning a part works by personal link/code rather than by typing in and storing an actor's email address (see section 2b) -- the only email our own system ever touches is the one Supabase needs privately for its own sign-in links, which even our own app's code cannot read back out.
- **What's built first:** group recording, not solo Read/Voice mode. This is a deliberate reprioritisation — group recording helps a whole cast at once, whereas solo rehearsal only ever helped one person.
- **Where it runs (hosting):** group recording needs a real backend reachable over the internet — not just Andy's own laptop — because cast members are on different devices in different places, and a laptop that's switched off isn't reachable by anyone else. Chosen approach: **Supabase**, on its free tier (handles sign-in, the shared database, and audio file storage; free to start, no card required). Flagged explicitly as a "revisit if this scales" item — a free tier has storage/usage limits that would need checking if this ever covered many productions' worth of recordings at once.
- **Practice-matching scope (updated 1 Sep 2026):** only building free, wording-based matching for now (catching small wording slips against the script text). True meaning-based matching (recognising that "yes, let's go for it" means the same as "yes, let's do that") needs a paid AI-based check and has been explicitly **shelved** — Andy's words: *"probably something we can shelve for future dev work IF this becomes a thing. Let's just solve this one problem really well to begin with."* Don't build or budget for it unless Andy raises it again.

## 4. Infrastructure status

- **Supabase:** account created by Andy (1 Sep 2026), `config.js` filled in with his real project details. He successfully ran the very first version of `schema.sql`, but it's since been rebuilt twice -- once for the groups/shows restructure, and again just now to add scripts and part-assignment -- so the version now in this folder needs running once more in the Supabase SQL Editor before any of G0 or G1 can be tested live. Re-running it is safe and expected: it starts by cleanly removing the previous version's tables so it can run from scratch, which is fine while only Andy has been testing (no real cast data exists yet to lose).
- **Netlify:** Andy claimed the site (https://eloquent-tulumba-e9e353.netlify.app/), so the address is now permanent under his account.
- **Git / GitHub (set up 3 Sep 2026):** this folder is now a proper Git repository (created by Claude via the device link; one clean commit so far, git fsck verified healthy). Andy installed GitHub Desktop. Remaining steps are his: open GitHub Desktop, "Add existing repository" pointed at this folder, publish it to GitHub, then in Netlify link that new GitHub repo for continuous deployment (Site configuration -> Build & deploy -> Link to a Git repository). Once that's done, publishing any future update becomes "Commit" then "Push" in GitHub Desktop, with Netlify rebuilding automatically -- no more manual drag-and-drop, and no more re-registering a new URL with Supabase each time. One thing worth knowing: group-app/config.js contains Andy's real (but intentionally public-safe) Supabase anon key -- fine even in a public repo per Supabase's own design, but Andy should decide public vs. private repo with that in mind when he publishes it.

## 5. Roadmap

Phase 0 and Phase 1 are done and are the foundation everything else builds on. G0–G6 is the group-recording roadmap, in order.

| Phase | What it does | Status |
|---|---|---|
| 0 — Set the stage | Working web app, upload screen, copyright tick-box | **Done** |
| 1 — Read the script | PDF upload → characters & lines extracted → review/fix screen → multi-select "which part(s) are yours" | **Done** |
| G0 — Groups & sign-in | Create a locked-down group, invite by link, sign in (an emailed "magic link", no password) | **Sign-in confirmed working live by Andy. Creating/joining a group is built but not yet confirmed live — quick check, then done.** |
| G1 — Attach the script & assign parts | Reuses Phase 1's parsing; the show's admin uploads the script, and every character gets its own personal invite link to send straight to the actor playing it (see sections 2a and 2b) | **Built and self-tested (24 automated checks passing) -- waiting on Andy running the latest schema.sql and live-testing it** |
| G2 — Record & re-record | Each actor records their own lines from their phone or laptop mic; re-record any line any time, newest take wins | Waiting on G1 |
| G3 — Run a scene, with stand-in voices | Plays real castmate recordings where they exist, a default voice (3 male / 3 female, or modulated) otherwise; a manual "refresh" button pulls in new recordings (no automatic real-time sync in the prototype) | Waiting on G2 |
| G4 — The "Line" prompt | Two buttons: "Hint" (first up to 5 words) and "Full line" | Waiting on G3 |
| G5 — Flexible practice matching | Free wording-difference comparison only (see section 3 — meaning-matching is shelved) | Waiting on G4 |
| G6 — Notifications | Simple in-app "new recordings" indicator; not a phone push notification | Nice-to-have, last |

**Immediate next step:** run the latest `schema.sql` in Supabase (this replaces the database cleanly), then live-test: creating a group and a show, uploading a real script PDF, generating a part's link from the assign-parts screen, and opening that link as a fresh sign-in to confirm it lands straight on the right part.

## 6. Parked for later (not cancelled)

These were the original solo-actor features. They remain valuable and fully buildable later on the same script-reading foundation — just not next in line:

- **Solo Read mode** — every other character's lines shown on screen; you speak your own line at the right moment, then reveal and compare, rehearsing alone.
- **Solo Voice mode** — other characters read aloud by the browser's built-in text-to-speech in assigned voices; your own spoken line is captured by the browser's speech-recognition and checked. Note: this specifically needs testing on a real iPhone before being built, since iPhone's Safari has historically had little/no support for the Web Speech *recognition* API (unlike the plain audio *recording* that group recording uses, which iPhone Safari supports well).
- **A personal script library** — saved scripts and parts for one person across visits, separate from the group feature.

## 7. What's already built (Phase 0 + 1) — technical summary

A single-page, client-side-only web app (no backend yet — that's what G0 adds). Published and working, called **Cue**.

- Uses **pdf.js** to extract text and its on-page position, directly in the browser, from a real text-based PDF (no image recognition needed).
- A custom parser reconstructs paragraphs from the raw positioned text by finding the *most common* line-to-line gap on each page (not the average, which gets skewed on pages mixing dialogue and headings) and treating a noticeably bigger gap as a paragraph break.
- Skips everything before the first "ACT" heading (title pages, cast lists, licence text) and stops at end-of-file boilerplate.
- Treats a paragraph that's just "[...]" as a stage direction.
- Treats a paragraph starting with an ALL-CAPS name (optionally after a title like Mrs./Sir/Dr.) as a new character's line; anything else continues the previous speaker.
- Every distinct raw name becomes its own row in the cast list (see the "character matching" decision above — no auto-merging).

**Tested against:** Sheridan's *The Rivals* (151 pages, public domain) — correctly found all 15 speaking characters, with well under 1% of the play's text left unassigned.

**A genuine bug found and fixed:** a CSS rule (`.screen { display: flex }`) was silently overriding the browser's own handling of hiding elements, so every screen in the app was rendering at once, stacked on top of each other. This only became visible when actually screenshotting the app rather than just checking it functionally — worth remembering for future UI changes.

## 8. Where everything lives

- **Published, working app (Phase 0+1):** "Cue" — https://claude.ai/code/artifact/e25f939b-bc6a-4337-83e6-d5933a72ec3a
- **Full illustrated plan document:** "The Prompt Book" (a nicer-looking, visual version of this same plan) — https://claude.ai/code/artifact/a150ff52-61fe-495a-a342-77bda781ef06
- **Source code**, in this folder:
  - `cue.html` — the whole Phase 0+1 app as one file (matches the published link above)
  - `build.js` — regenerates `cue.html` from the files in `src/` — never hand-edit `cue.html` directly
  - `src/` — the Phase 0+1 source files: `index.html`, `style.css`, `app.js`, `parser.js`
  - `schema.sql` — the G0 database setup; run once in Supabase's SQL Editor
  - `group-app/` — the group/show app (G0 + G1): `index.html`, `style.css`, `app.js`, `parser.js` (the script-reading engine, a copy of Phase 1's), and `config.js` (where Andy's Supabase Project URL and anon key go — see section 9)
  - `test-group-app.js` — an automated check that walks through the app's screens end to end (sign-in, joining, the admin flow, script upload, part assignment) using stand-ins for Supabase and the PDF reader, so it runs without needing real accounts or a real script file
  - `README.md` — a developer-facing README covering the same technical ground as section 7 above, in more depth
  - `CLAUDE.md` — a technical reference for any AI assistant working in this repo (architecture, conventions, known pitfalls) -- a companion to this file, written for a more technical reader
  - `promptbook.md` — this file

## 9. Open questions / things to confirm

- **Not yet live-tested (as of 3 Sep 2026):** the groups/shows restructure and now G1 (script upload + part assignment) are both built and pass every automated check, but Andy hasn't yet run the current `schema.sql` or tried any of it in his own browser -- that's the very next step, ahead of anything further being built.
- **G0 is live:** https://eloquent-tulumba-e9e353.netlify.app/ (an unclaimed Netlify link — fine for now, but worth Andy claiming it with a free Netlify account eventually so it doesn't expire/get cleaned up). `schema.sql` has been run in Supabase (confirmed — "0 rows returned" was the expected, correct result). `config.js` has Andy's real project details, with two small mistakes found and fixed along the way: a dashboard link pasted instead of the project's own API address, and a version bump on the supabase-js library as a precaution around Supabase's newer key format.
- **A real bug found and fixed 2 Sep 2026:** Andy reported the "Send me a sign-in link" button did nothing at all — no error, no visual change. Cause: `app.js` named its own Supabase connection `supabase`, the same name the Supabase code library itself uses internally — like two people in the same room answering to the same name, JavaScript refused to allow it and quietly gave up on running any of the button-click code, with nothing shown on screen to explain why. Fixed by renaming it to `sb`. Also added a proper automated test using the real Supabase library (not a stand-in) specifically so this class of bug gets caught automatically next time, rather than only by Andy noticing a dead button.
- Exact stand-in voice choices for G3 (three male, three female, vs. one of each with modulation) — either is technically fine; to be decided when building G3.
