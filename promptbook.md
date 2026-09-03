# Line Learning App — Prompt Book

*Working reference for this project. If a chat runs out of room and a new one starts, paste or point it at this file first — it should have everything needed to carry on without re-explaining anything.*

*Last updated: 2 September 2026 (G0 sign-in confirmed working live)*

---

## 1. How to work with Andy on this project

Standing instructions, in Andy's own words: *"You will be a software developer and advisor for this project. I shall provide the goals and you shall provide the code to build this app using Claude Code where appropriate to do so. Please provide answers and responses in simple, non-technical English, explaining constraints clearly and asking user questions when appropriate to clarify. Questions are encouraged."*

In practice, that means:

- Andy is the product owner, not a developer. He has no or very basic coding/technical knowledge — explain things in plain English, spell out trade-offs and constraints (cost, technical limits, legal grey areas) clearly rather than assuming he'll infer them, and give detailed step-by-step instructions even for things that feel simple.
- Andy sets the goals and priorities; the assistant proposes and builds the actual solution (code, architecture, plan documents).
- Ask clarifying questions freely rather than guessing on anything that matters — Andy has explicitly said questions are welcome.
- Andy does amateur acting and directing (Tacoma Little Theatre) in his spare time — this app is scratching his own itch as well as a general drama-group problem.

## 2. The problem and the current focus

Original idea: a solo tool to help one actor learn lines (upload a script, pick a part, rehearse against it). That work is still built and still useful (see section 5) — but the project has pivoted.

**Current focus, as of 1 September 2026:** a tool for a *dedicated drama group*, not a lone actor. Andy's problem statement: *"People in the cast need different amounts of help with learning their lines."* His feature idea: *group recording* — cast members record their own lines in their own voice, so anyone can rehearse a scene against real castmates whenever they want, without those castmates needing to be there live. Why it matters, in his words: *"If you need to continually go through a scene, you can do it with your scene partner virtually, without them having to constantly be involved."*

Group recording is the priority now, ahead of the original solo rehearsal modes (which are parked, not cancelled — see section 6).

## 3. Decisions locked in

- **Platform:** a web app, not a native phone app. Opens in any browser on any device, no app-store setup.
- **Script format:** real, text-based PDFs only — no photos or scans. Andy's call: any actor on a licensed production should be able to get a proper PDF, and photographing someone else's copy raises messier copyright questions. It also means the app can read the actual text directly rather than needing image recognition.
- **Copyright check:** a self-certification tick-box at upload ("I have the right to use this script"). No document verification, just an honesty checkbox. Already built.
- **Character matching:** no automatic guessing that two different-looking names belong to the same character. Every distinct name the script uses becomes its own row, and the person picking their part ticks every name that's theirs. This safely handles a character referred to by two names, and an actor doubling up two different roles, without ever risking silently merging two genuinely different characters.
- **What's built first:** group recording, not solo Read/Voice mode. This is a deliberate reprioritisation — group recording helps a whole cast at once, whereas solo rehearsal only ever helped one person.
- **Where it runs (hosting):** group recording needs a real backend reachable over the internet — not just Andy's own laptop — because cast members are on different devices in different places, and a laptop that's switched off isn't reachable by anyone else. Chosen approach: **Supabase**, on its free tier (handles sign-in, the shared database, and audio file storage; free to start, no card required). Flagged explicitly as a "revisit if this scales" item — a free tier has storage/usage limits that would need checking if this ever covered many productions' worth of recordings at once.
- **Practice-matching scope (updated 1 Sep 2026):** only building free, wording-based matching for now (catching small wording slips against the script text). True meaning-based matching (recognising that "yes, let's go for it" means the same as "yes, let's do that") needs a paid AI-based check and has been explicitly **shelved** — Andy's words: *"probably something we can shelve for future dev work IF this becomes a thing. Let's just solve this one problem really well to begin with."* Don't build or budget for it unless Andy raises it again.

## 4. Infrastructure status

- **Supabase:** account created by Andy (1 Sep 2026). Andy still needs to: (1) run `schema.sql` once in the Supabase SQL Editor, and (2) put his Project URL and anon public key into `group-app/config.js`.
- **GitHub:** Andy has connected his Supabase project to GitHub. No dedicated GitHub connector exists to attach directly to this chat (checked the connector registry, 1 Sep 2026) — for now, G0 is being built and tested the same way Phase 0/1 was, directly in this folder via the device link. Getting the app onto a real public web address (so castmates can actually use it, not just Andy) is a separate, later step — see section 9.

## 5. Roadmap

Phase 0 and Phase 1 are done and are the foundation everything else builds on. G0–G6 is the group-recording roadmap, in order.

| Phase | What it does | Status |
|---|---|---|
| 0 — Set the stage | Working web app, upload screen, copyright tick-box | **Done** |
| 1 — Read the script | PDF upload → characters & lines extracted → review/fix screen → multi-select "which part(s) are yours" | **Done** |
| G0 — Groups & sign-in | Create a locked-down group, invite by link, sign in (an emailed "magic link", no password) | **Sign-in confirmed working live by Andy. Creating/joining a group is built but not yet confirmed live — quick check, then done.** |
| G1 — Attach the script & pick parts | Reuses Phase 1's parsing so the whole group shares one reviewed cast list; each person picks their part(s) | Waiting on G0 |
| G2 — Record & re-record | Each actor records their own lines from their phone or laptop mic; re-record any line any time, newest take wins | Waiting on G1 |
| G3 — Run a scene, with stand-in voices | Plays real castmate recordings where they exist, a default voice (3 male / 3 female, or modulated) otherwise; a manual "refresh" button pulls in new recordings (no automatic real-time sync in the prototype) | Waiting on G2 |
| G4 — The "Line" prompt | Two buttons: "Hint" (first up to 5 words) and "Full line" | Waiting on G3 |
| G5 — Flexible practice matching | Free wording-difference comparison only (see section 3 — meaning-matching is shelved) | Waiting on G4 |
| G6 — Notifications | Simple in-app "new recordings" indicator; not a phone push notification | Nice-to-have, last |

**Immediate next step:** a quick live check that creating/joining a group works too (try the buttons on the "Your groups" screen), then start G1 — attaching a script to a group.

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
  - `group-app/` — the new G0 app (groups & sign-in): `index.html`, `style.css`, `app.js`, and `config.js` (where Andy's Supabase Project URL and anon key go — see section 9)
  - `README.md` — a developer-facing README covering the same technical ground as section 7 above, in more depth
  - `promptbook.md` — this file

## 9. Open questions / things to confirm

- **G0 is live:** https://eloquent-tulumba-e9e353.netlify.app/ (an unclaimed Netlify link — fine for now, but worth Andy claiming it with a free Netlify account eventually so it doesn't expire/get cleaned up). `schema.sql` has been run in Supabase (confirmed — "0 rows returned" was the expected, correct result). `config.js` has Andy's real project details, with two small mistakes found and fixed along the way: a dashboard link pasted instead of the project's own API address, and a version bump on the supabase-js library as a precaution around Supabase's newer key format.
- **A real bug found and fixed 2 Sep 2026:** Andy reported the "Send me a sign-in link" button did nothing at all — no error, no visual change. Cause: `app.js` named its own Supabase connection `supabase`, the same name the Supabase code library itself uses internally — like two people in the same room answering to the same name, JavaScript refused to allow it and quietly gave up on running any of the button-click code, with nothing shown on screen to explain why. Fixed by renaming it to `sb`. Also added a proper automated test using the real Supabase library (not a stand-in) specifically so this class of bug gets caught automatically next time, rather than only by Andy noticing a dead button.
- Exact stand-in voice choices for G3 (three male, three female, vs. one of each with modulation) — either is technically fine; to be decided when building G3.
