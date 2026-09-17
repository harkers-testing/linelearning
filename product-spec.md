# Line Learning App — Product Specification

*A living document. Everything here is a draft — change anything, delete anything, add anything. Whenever we build or decide something new together, ask Claude to update this file to match.*

*Last updated: 15 September 2026*

---

## 1. Overview

A web app for drama groups (starting with Tacoma Little Theatre) that helps a cast learn their lines together, without needing to be in the same room. A director sets up a show, uploads the script, and hands each actor a personal link to their part. Cast members use the app to see their lines and — in the next phase — hear real castmates' recorded voices instead of a computer voice or a scene partner who isn't available that week.

**Who this is for:** community theatre casts, where people have jobs, families, and other commitments that make it hard to always find rehearsal time outside scheduled group rehearsals.

**What problem it solves, in Andy's words:** *"People in the cast need different amounts of help with learning their lines."* Some actors have a good ear and can "hear" their castmates in their head while reading a script silently. Others learn better by actually hearing the other lines spoken. This app is meant to give everyone a way to practice on their own schedule, in the way that works for them, using the actual voices of the people they're performing with. So for those who need more help and more time with their castmates, they can get it, without it impacting others schedules.

---

## 2. Problem & Goals

- Learning lines is easier with a scene partner, but community theatre schedules make that hard to arrange consistently.
- Different actors need different kinds of help — some need to hear a cue line before their own; others barely need a prompt at all.
- Directors need an easy way to get a script to a cast and know who's playing what, without a lot of manual admin work.
- Community theatre has particular scheduling challenges, as most participants are volunteers and have limited time.
- Different methods of line learning are preferred by different actors.
- **Privacy goal (explicit, from the very start of this project):** store as little personal information as possible. No actor's email address or phone number is ever saved in the app's own data — only what Supabase (the sign-in provider) needs to do its job, and even that isn't visible to anyone else, including this app's own code.

### Goals for this app
1. Let a director set up a show and get a script into the app quickly.
2. Let a director assign parts to specific actors before those actors have even signed up — and get them a working invite link with minimal effort (copy, text, or email it).
3. Let each actor see their own lines, with just enough surrounding context (their "cue" — what's said right before their line) to know when to speak.
4. Eventually, let actors record their own lines so the rest of the cast can rehearse against real voices, not just text or a robotic voice.
5. Let actors practice their lines on a scene-by-scene basis, or skipping from cue to cue.
6. Keep the whole thing simple enough for a non-technical director to run without help.

### Non-goals (at least for now)
- Not a full production-management tool (no scheduling, no costume tracking, no ticketing).
- Not trying to grade or "meaning-check" whether an actor's spoken line matches the script — matching on exact/near-exact wording is enough (see section 6).
- Not a native phone app — a web page that works well on a phone browser is the target for Phase One. Note that a native phone app is a goal for Phase Two.

---

## 3. Users & Roles

| Role | Who they are | What they can do |
|---|---|---|
| **Group admin / director** | Runs a theatre company or is directing a specific show | Creates a group (the company/theatre) and shows (individual productions) inside it; uploads and manages the script; sees and assigns every part; shares invite links; sees the show's general invite code | Director can see which actors have accepted the invite | Can see which actors have added their lines | Can provide feedback on those line recordings (phase two)
| **Cast member (actor)** | Someone acting in a show | Joins a show via their personal part link (or the show's general code); sees their own assigned character and (once built) their lines; will eventually record their own lines |
| **Crew / other join-without-a-part** | Assistant director, stage manager, tech, etc. | Joins a show using its general invite code (given to them by the director) — sees the show but isn't assigned a speaking part | Can see which actors have joined and recorded |

**Notes on roles:**
- A "group" is the theatre/company (e.g. "Tacoma Little Theatre") — only its admin ever sees this level. A "show" is one production (e.g. "The Rivals — Fall 2026") that lives inside a group.
- Anyone can currently create a new group when they sign in — this was left open deliberately for now, and can be locked down later without much work if needed.
- One person can hold different roles across different shows (e.g. directing one show while acting in another) — memberships are independent per show.
- Whoever creates a show is automatically that show's admin. There's no separate "make someone else an admin" feature yet, but this would be a good addition.

---

## 4. Core Workflow

The real-world process this app is built around, worked out early on by walking through how a production actually comes together:

1. A theatre chooses a play and a director (outside the app).
2. They cast the play with real actors (outside the app).
3. The director sets up the show in the app and uploads the script (a real, text-based PDF — not a photo or scan).
4. The app reads the script, finds every character, every scene, every line, and automatically creates a personal, one-time invite link for each one — **before** any actor has ever opened the app.
5. The director sends each actor their own link (however they like — copy/paste, text message, or email; the app has one-tap buttons that open the director's own Messages or Mail app, pre-filled, for the last two).
6. Each actor opens their link, signs in with just their email (a sign-in link, no password), and lands straight on their assigned character — joining the show and getting their part in one step.
7. Anyone joining without a specific part (crew, an assistant director) uses the show's separate general invite code instead — this is deliberately different from a personal part link, and only the director can see it.
8. The director tells the cast to start learning lines / recording, using the app.
9. Actors record their lines using a record function on the app.
10. These lines can then be viewed as recorded by the director and other cast members.
11. When learning lines, the actor can select to either just read the script on the app, or can select to hear the audio - this audio can be recorded by the actors, but for any who have not done so, the app could read the lines aloud.
12. Actors can re-record their lines at any time.
13. Director can provide feedback at any time.

---

## 5. Data & Privacy Principles

These were explicit, deliberate decisions — worth keeping visible so they don't get eroded as the app grows:

- **Minimize personal information, always.** No actor's email address or phone number is stored anywhere in this app's own data. The "text it" / "email it" buttons build a message on the director's own phone and hand it off to Messages/Mail — the app itself never sends anything and never sees the number or address typed in.
- **Sign-in only needs an email, and Supabase (the backend service) handles that privately** — not even this app's own code can read another user's sign-in email back out.
- **The general show invite code is for crew/assistant directors only — never actors.** An actor who joined via their own personal part link should never be able to see or pass along the show's general code. (This was tightened after a real gap was found and fixed in September 2026 — see section 9.)
- **A part is tied to a character, not a person's identity.** The system doesn't need to know "who" an actor is beyond their sign-in — just which character they're playing in which show.
- **Every security rule lives in the database itself, not just in the app's on-screen behavior.** Even if someone bypassed the visible app entirely and talked to the backend directly, the same rules would still apply (who can see what, who can change what).

---

## 6. Features

### 6.1 Built and working (as of September 2026)

- **Sign-in:** email-based, no password — a sign-in link is emailed, clicking it signs you in. Stays signed in on the same phone/browser afterward (no need to sign in again every visit).
- **Groups & shows:** an admin can create a group (their theatre/company) and, inside it, any number of shows (individual productions).
- **Script upload:** a director uploads a real PDF of the script. The app reads it, splits it into paragraphs, and figures out who's speaking each line, using a self-certification tick-box confirming the uploader has the right to use the script.
- **Cast list review:** before saving, the director can review every character name the app found, fix typos, rename anyone, or remove a row that shouldn't be there.
- **Automatic part creation:** saving the script automatically creates one shareable, personal invite code per character — no manual setup needed per actor.
- **Sharing a part:** copy the link, or use one-tap "Text it" / "Email it" buttons.
- **Claiming a part:** opening a personal link signs the actor in (if needed) and joins them to the show with that character assigned, in one step. If someone else already claimed that part, they're told clearly rather than silently overwriting it.
- **General invite code:** a separate code per show for anyone joining without a specific part — visible only to that show's admin.
- **Reassigning a part:** an admin can "unassign" a claimed part, which frees it up and issues a brand new code (so the old link stops working).

### 6.2 Next up — cast member script view *(not yet built; the next planned step)*

- A cast member should be able to see their own assigned character's lines once they've joined — right now, there's no screen for this at all yet.
- **Cue lines:** show the 1 or 2 lines spoken by other characters right before an actor's own line, so they know when to come in.
- **Personal cue-line setting:** each actor chooses 1 or 2 lines of lead-in for themselves — this is a personal preference, not a director-wide setting, because different people learn differently (some have a good ear for voices and need less lead-in; others need more).
- **Act/Scene navigation:** let an actor jump straight to a specific Act and Scene, rather than scrolling through the whole script.
- **Skip to next cue line:** let an actor jump forward past stretches where their character doesn't appear, landing just before their next line.
- **Skip to entrance** *(explicitly agreed as future work, not part of this first version)*: jump specifically to a stage direction where the actor's character enters, rather than just their next line.

### 6.3 Planned — group recording *(not yet started)*

- Actors record their own lines, in their own voice.
- Re-recording: redo any line at any time; the newest take is what everyone hears.
- Default stand-in voices (a small set of male/female voices, or one voice with different tones) read any line nobody has recorded yet, so a scene always has something to play against.
- Manually refresh to pull in newly added recordings from castmates (doesn't need to be automatic/live).
- Notification when a new recording is added — nice to have, not required for the first version.

### 6.4 Planned — rehearsal mode *(not yet started)*

- "Line" prompt with two levels: a short hint (the first few words) or the full line.
- Play through a scene using real castmate recordings where they exist, and the stand-in voice otherwise.
- Flexible matching: catch small wording differences when checking what an actor said against the script — a real spoken-word "meaning" checker (using paid AI tools) is intentionally **shelved indefinitely** for now; the free, wording-based version is the whole plan unless that changes.

### 6.5 Considered, deliberately parked for later

- A personal script library / solo mode outside the group structure.
- Text-to-speech / voice-recognition "solo practice" mode.
- Face ID / fingerprint sign-in (technically possible through the sign-in provider, but still labeled "experimental" by them as of this writing — worth revisiting once that matures).
- Links to other script libraries online (like Gutenberg).

---

## 7. Technical Notes (light-touch, for context)

*(Full technical detail lives in `CLAUDE.md` in this same folder — this section is just enough to explain constraints in plain terms.)*

- **Built as a simple web page**, not a native phone app — works in any modern browser, including on a phone, without installing anything.
- **Backend: Supabase** (a hosted service) handles sign-in, the database, and (eventually) storing audio recordings. It's on a free tier for now.
- **Hosting: Netlify**, which automatically rebuilds and republishes the live site every time a change is saved to the project's GitHub repository — no manual re-uploading needed.
- **Every access rule is enforced by the database itself**, not just by the on-screen app — this is what makes the privacy commitments in section 5 actually hold up, rather than just being a promise about how the visible app behaves.

---

## 8. Open Questions / Decisions Still Needed

*(Use this section as your space to jot down anything you're unsure about, want to change your mind on, or want to flag for discussion — nothing here is locked in.)*

- Should the 1-vs-2-line cue lookback be a simple toggle, or offer more choices (e.g. 0, 1, 2, 3 lines)?
- For "skip to next cue line" — is landing just before the actor's next line enough, or is a visual indicator of "how far until my next line" also wanted?
- Once recording is built: should there be any limit on re-recording (e.g. keeping old takes), or always just the latest one?
- Should a show ever be archived/closed out once a production has finished, so old shows don't clutter the list? (Not designed yet.)
- Should group creation stay open to anyone who signs in, or be restricted to people Andy specifically invites, as the app grows beyond initial testing?
- Is there ever a need for more than one admin per show (e.g. a director and an assistant director both able to manage the script/casting)? Right now only the single creator of a show can manage it.

---

## 9. Known Issues Log (fixed, for reference)

A short record of real problems found during live testing and how they were resolved — kept here so the reasoning isn't lost, not because they need attention now.

| Date | Issue | Resolution |
|---|---|---|
| Sep 2026 | Database setup script failed with a "cannot drop table" error | A leftover setting from an earlier test version blocked a clean rebuild; fixed by having the rebuild also clear out anything still depending on old pieces. |
| Sep 2026 | Live website was showing an old version of the app | GitHub-to-Netlify automatic publishing wasn't fully connected yet; fixed by completing that connection. |
| Sep 2026 | Live website showed "Page not found" | The website's home-page setting pointed at the wrong folder inside the project; corrected. |
| Sep 2026 | "Infinite recursion" error when creating/joining shows; personal links didn't auto-join | Two security rules were each checking each other in a loop; rewritten so each rule can answer on its own. |
| Sep 2026 | Actors could see the show's general invite code (meant for crew only) | Fixed at the database level so that code is now never sent to anyone but that show's own admin, not just hidden on screen. |

---

## 10. Roadmap Summary

| Phase | What it covers | Status |
|---|---|---|
| Phase 0/1 | Original solo line-learning prototype ("Cue") | Built, published, live |
| G0 | Groups, shows, and sign-in | Built and confirmed working live |
| G1 | Script upload and part assignment | Built and confirmed working live (admin side and cast-joining side both tested) |
| G1.5 | Cast member script/lines view, cue lines, personal lookback setting, Act/Scene jump | Not started — next planned step |
| G2 | Recording and re-recording lines | Not started |
| G3 | Running a scene with real/stand-in voices | Not started |
| G4 | The "Line" hint/full-line prompt | Not started |
| G5 | Flexible wording-match checking | Not started |
| G6 | New-recording notifications | Not started |
