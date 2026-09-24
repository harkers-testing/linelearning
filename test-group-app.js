// Functional check for group-app (groups + shows + scripts + parts), using a
// fake stand-in for Supabase (and a fake stand-in for pdf.js's text
// extraction, so this doesn't need real network access or a real PDF file —
// parser.js itself runs for real against the fake page-text below) so it
// runs with no real network/account needed. Run:
// node test-group-app.js (needs a static file server already running on
// port 8766 pointed at group-app/).
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const os = require("os");

(async () => {
  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
  const page = await browser.newPage();

  page.on("pageerror", (err) => console.log("PAGE ERROR:", err.message));
  page.on("console", (msg) => { if (msg.type() === "error") console.log("CONSOLE ERROR:", msg.text()); });

  await page.route("**/supabase-js@*/**", (route) => route.fulfill({ status: 200, body: "" }));
  await page.route("**/pdf.min.js", (route) => route.fulfill({ status: 200, body: "" }));

  await page.addInitScript(() => {
    window.__groups = [];
    window.__shows = []; // every show that exists, regardless of membership
    window.__memberOf = new Set(); // ids of shows THIS account has actually joined
    window.__memberCounts = {}; // show id -> member count
    window.__scripts = []; // show id -> {id, show_id, file_name}
    window.__scriptLines = []; // {id, script_id, seq_index, line_type, character_name, line_text}
    window.__parts = []; // {id, show_id, character_name, invite_code, claimed_by, claimed_at}
    window.__showMembers = []; // {show_id, user_id, cue_lookback_lines} — one row per person per show
    window.__recordings = []; // {id, show_id, character_name, line_text, audio_data, mime_type, recorded_by}
    let nextPartId = 1;

    // Stand-ins for the microphone/recording APIs (schema v8, "Record my
    // lines") — there's no real microphone in this test environment, so
    // these fake just enough of getUserMedia/MediaRecorder for app.js's
    // actual recording code to run unmodified: starting "recording"
    // flips a flag, stopping produces one small real Blob (a genuine
    // browser Blob — FileReader/base64-encoding it is exercised for
    // real, only the audio bytes themselves are fake) and fires the same
    // ondataavailable-then-onstop sequence a real recording would.
    navigator.mediaDevices = navigator.mediaDevices || {};
    navigator.mediaDevices.getUserMedia = async () => ({
      getTracks: () => [{ stop: () => {} }],
    });
    window.MediaRecorder = class {
      constructor(stream, opts) {
        this.mimeType = (opts && opts.mimeType) || "audio/webm";
        this.state = "inactive";
      }
      static isTypeSupported(type) {
        return type === "audio/webm;codecs=opus" || type === "audio/webm";
      }
      start() {
        this.state = "recording";
      }
      stop() {
        this.state = "inactive";
        if (this.ondataavailable) {
          this.ondataavailable({ data: new Blob(["fake-audio-bytes"], { type: this.mimeType }) });
        }
        if (this.onstop) this.onstop();
      }
    };

    // Helper used everywhere someone joins/creates/claims a part in a show —
    // mirrors what set_cue_lookback expects to find, and gives everyone the
    // same default (1) a brand-new show_members row gets in the real schema.
    function ensureMember(showId, userId) {
      const exists = window.__showMembers.some((m) => m.show_id === showId && m.user_id === userId);
      if (!exists) {
        window.__showMembers.push({ show_id: showId, user_id: userId, cue_lookback_lines: 1 });
      }
    }

    // Seed a show belonging to a DIFFERENT admin, with one part already
    // claimed by someone else and one still open — this is what lets the
    // test exercise the cast-member's-eye view (not the admin's), and the
    // "already claimed by someone else" error, without needing a second
    // real browser identity.
    window.__shows.push({
      id: "show-other", group_id: "other-group", name: "Preset Show",
      invite_code: "showcodeX", created_by: "otherAdmin",
    });
    window.__memberCounts["show-other"] = 1;
    window.__parts.push({
      id: "part-preset", show_id: "show-other", character_name: "Mrs. Malaprop",
      invite_code: "partcodeX", claimed_by: null, claimed_at: null,
    });
    window.__parts.push({
      id: "part-taken", show_id: "show-other", character_name: "Sir Anthony",
      invite_code: "takencode", claimed_by: "someoneElse", claimed_at: "2026-01-01",
    });

    // A script already sitting on that same preset show, with real dialogue
    // lines for both characters above — this is what lets the "My Part"
    // screen be tested with genuine cue-context and hint/reveal behaviour,
    // without needing to run a whole upload-and-save round trip first.
    // All five lines sit in the same single scene. scene_label is already
    // "Scene 1" here (not null) because that's what a real save would have
    // stored — save_script's own review step always resolves a scene's
    // label (to whatever the director typed, or a default "Scene N") before
    // saving, so a null scene_label never actually reaches the database in
    // practice. This keeps the "My Part" scene browser to exactly one scene
    // to pick, so the existing cue/hint/reveal/lookback checks below stay
    // simple. Scene-to-scene navigation itself is covered separately, on
    // the two-scene script the director uploads later in this test.
    window.__scripts.push({ id: "script-other", show_id: "show-other", file_name: "preset.pdf" });
    window.__scriptLines.push(
      { id: "sl1", script_id: "script-other", seq_index: 0, line_type: "heading", character_name: null, line_text: "ACT I", act_label: "ACT I", scene_label: "Scene 1", scene_seq: 0 },
      { id: "sl2", script_id: "script-other", seq_index: 1, line_type: "line", character_name: "Sir Anthony", line_text: "Good morning, madam, I trust you slept well.", act_label: "ACT I", scene_label: "Scene 1", scene_seq: 0 },
      { id: "sl3", script_id: "script-other", seq_index: 2, line_type: "line", character_name: "Mrs. Malaprop", line_text: "Good morning to you as well, kind sir.", act_label: "ACT I", scene_label: "Scene 1", scene_seq: 0 },
      { id: "sl4", script_id: "script-other", seq_index: 3, line_type: "line", character_name: "Sir Anthony", line_text: "The weather today is really quite fine.", act_label: "ACT I", scene_label: "Scene 1", scene_seq: 0 },
      { id: "sl5", script_id: "script-other", seq_index: 4, line_type: "line", character_name: "Mrs. Malaprop", line_text: "Tolerably well, I thank you, though the night was warm.", act_label: "ACT I", scene_label: "Scene 1", scene_seq: 0 },
      // A second scene where Mrs. Malaprop has NO lines at all (only Sir
      // Anthony speaks) — deliberately added so "Only show my scenes" has
      // something real to filter out; everything above this stays exactly
      // as it was for every existing check against this fixture.
      { id: "sl6", script_id: "script-other", seq_index: 5, line_type: "heading", character_name: null, line_text: "ACT II", act_label: "ACT II", scene_label: "Scene 9", scene_seq: 1 },
      { id: "sl7", script_id: "script-other", seq_index: 6, line_type: "line", character_name: "Sir Anthony", line_text: "I say, this fine weather continues.", act_label: "ACT II", scene_label: "Scene 9", scene_seq: 1 }
    );

    // A second, unrelated show with no parts assigned at all yet — used to
    // check the "joined generally, no specific part" message in isolation
    // from the show above (which does have a part, so re-using it here
    // would leave the earlier claim still attached).
    window.__shows.push({
      id: "show-crew", group_id: "other-group-2", name: "Crew-only Show",
      invite_code: "crewcode", created_by: "otherAdmin2",
    });
    window.__memberCounts["show-crew"] = 1;

    const mock = {
      auth: {
        getSession: async () => ({ data: { session: null } }),
        onAuthStateChange: (cb) => { window.__authCb = cb; return { data: { subscription: { unsubscribe() {} } } }; },
        signInWithOtp: async () => ({ error: null }),
        signOut: async () => ({}),
      },
      // select(...) returns an object that can be awaited directly, or
      // chained with one or more .eq(...) filters before being awaited, or
      // followed by .order(...) or .single() — matching every call shape
      // used in app.js (some queries stop right after one .eq(), others
      // chain two, others add .order() or .single() on top).
      from: (table) => ({
        select: (cols, opts) => {
          const filters = [];
          const resolve = () => {
            if (opts && opts.count) {
              // Every count query in this app filters by exactly one field
              // first (show_id) — that's the value the count is keyed on.
              const val = filters.length ? filters[0][1] : undefined;
              return { count: window.__memberCounts[val] ?? 0, error: null };
            }
            let data;
            if (table === "groups") data = window.__groups;
            else if (table === "shows_public") {
              // Mirrors real RLS: only shows this account has actually
              // joined (or created, which joins them automatically) show
              // up in "your shows" — not every show that merely exists.
              // Mirrors the real shows_public view too: only that show's
              // own admin ("u1" created it) ever gets a real invite_code
              // back — everyone else gets null, same as schema.sql's
              // `case when is_show_admin(id) then invite_code else null end`.
              data = window.__shows
                .filter((s) => window.__memberOf.has(s.id) || filters.length > 0)
                .map((s) => ({ ...s, invite_code: s.created_by === "u1" ? s.invite_code : null }));
            } else if (table === "scripts") data = window.__scripts;
            else if (table === "parts") data = window.__parts;
            else if (table === "show_members") data = window.__showMembers;
            else if (table === "script_lines") data = window.__scriptLines;
            else if (table === "recordings") data = window.__recordings;
            else data = [];

            for (const [field, val] of filters) {
              data = data.filter((row) => row[field] === val);
            }
            return { data, error: null };
          };

          const api = {
            eq: (field, val) => {
              filters.push([field, val]);
              return api;
            },
            order: async () => resolve(),
            single: async () => {
              const result = resolve();
              if (result.error) return result;
              const arr = result.data || [];
              return { data: arr[0] || null, error: null };
            },
            then: (onFulfilled, onRejected) => Promise.resolve(resolve()).then(onFulfilled, onRejected),
          };
          return api;
        },
      }),
      rpc: async (name, args) => {
        if (name === "create_group") {
          const g = { id: "grp" + (window.__groups.length + 1), name: args.group_name };
          window.__groups = [g, ...window.__groups];
          return { data: g, error: null };
        }
        if (name === "create_show") {
          const s = {
            id: "show" + (window.__shows.length + 1),
            group_id: args.group_id,
            name: args.show_name,
            invite_code: "code" + (window.__shows.length + 1),
            created_by: "u1",
          };
          window.__shows = [s, ...window.__shows];
          window.__memberCounts[s.id] = 1; // creator auto-joins
          window.__memberOf.add(s.id);
          ensureMember(s.id, "u1");
          return { data: s, error: null };
        }
        if (name === "join_show_by_code") {
          const existing = window.__shows.find((s) => s.invite_code === args.code);
          if (!existing) return { data: null, error: { message: "No show found for that invite code" } };
          window.__memberCounts[existing.id] = (window.__memberCounts[existing.id] ?? 0) + 1;
          window.__memberOf.add(existing.id);
          ensureMember(existing.id, "u1");
          return { data: existing, error: null };
        }
        if (name === "save_script") {
          const showId = args.target_show_id;
          window.__scripts = window.__scripts.filter((s) => s.show_id !== showId);
          const newScriptId = "script" + Date.now();
          window.__scripts.push({ id: newScriptId, show_id: showId, file_name: args.script_file_name });

          // Mirrors save_script's own insert into script_lines: every line
          // the admin reviewed and saved is replayed here in the same
          // shape the real table uses, so the "My Part" screen has real
          // data to read after a fresh upload, not just the preset show.
          window.__scriptLines = window.__scriptLines.filter((l) => l.script_id !== newScriptId);
          (args.lines || []).forEach((elem, i) => {
            window.__scriptLines.push({
              id: newScriptId + "-line" + i,
              script_id: newScriptId,
              seq_index: elem.seq_index,
              line_type: elem.type,
              character_name: elem.character_name,
              line_text: elem.text || "",
              act_label: elem.act_label != null ? elem.act_label : null,
              scene_label: elem.scene_label != null ? elem.scene_label : null,
              scene_seq: elem.scene_seq != null ? elem.scene_seq : null,
            });
          });

          const keep = new Set(args.character_names);
          window.__parts = window.__parts.filter((p) => p.show_id !== showId || keep.has(p.character_name));

          for (const cname of args.character_names) {
            const exists = window.__parts.some((p) => p.show_id === showId && p.character_name === cname);
            if (!exists) {
              const id = "part" + nextPartId++;
              window.__parts.push({
                id, show_id: showId, character_name: cname,
                invite_code: "pc" + id, claimed_by: null, claimed_at: null,
              });
            }
          }
          return { data: window.__parts.filter((p) => p.show_id === showId), error: null };
        }
        if (name === "claim_part_by_code") {
          const part = window.__parts.find((p) => p.invite_code === args.code);
          if (!part) return { data: null, error: { message: "No part found for that code" } };
          if (part.claimed_by && part.claimed_by !== "u1") {
            return { data: null, error: { message: "This part has already been claimed by someone else" } };
          }
          part.claimed_by = "u1";
          part.claimed_at = "now";
          window.__memberCounts[part.show_id] = (window.__memberCounts[part.show_id] ?? 0) + 1;
          window.__memberOf.add(part.show_id);
          ensureMember(part.show_id, "u1");
          return { data: { ...part }, error: null };
        }
        if (name === "set_cue_lookback") {
          const row = window.__showMembers.find((m) => m.show_id === args.target_show_id && m.user_id === "u1");
          if (!row) return { data: null, error: { message: "Not a member of that show" } };
          if (args.lines !== 1 && args.lines !== 2) {
            return { data: null, error: { message: "lines must be 1 or 2" } };
          }
          row.cue_lookback_lines = args.lines;
          return { data: { ...row }, error: null };
        }
        if (name === "save_line_recording") {
          const part = window.__parts.find((p) =>
            p.show_id === args.target_show_id &&
            p.character_name === args.target_character_name &&
            p.claimed_by === "u1"
          );
          if (!part) {
            return { data: null, error: { message: "You can only record lines for a character you have claimed yourself" } };
          }
          if (!args.audio_base64) {
            return { data: null, error: { message: "No recording was captured" } };
          }
          let row = window.__recordings.find((r) =>
            r.show_id === args.target_show_id &&
            r.character_name === args.target_character_name &&
            r.line_text === args.target_line_text
          );
          if (!row) {
            row = {
              id: "rec" + (window.__recordings.length + 1),
              show_id: args.target_show_id,
              character_name: args.target_character_name,
              line_text: args.target_line_text,
              recorded_by: "u1",
            };
            window.__recordings.push(row);
          }
          row.audio_data = args.audio_base64;
          row.mime_type = args.audio_mime_type;
          return { data: { ...row }, error: null };
        }
        if (name === "unassign_part") {
          const part = window.__parts.find((p) => p.id === args.part_id);
          if (!part) return { data: null, error: { message: "Part not found" } };
          part.claimed_by = null;
          part.claimed_at = null;
          part.invite_code = "fresh-" + part.id;
          return { data: { ...part }, error: null };
        }
        return { data: null, error: { message: "unknown rpc " + name } };
      },
    };
    window.supabase = { createClient: () => mock };

    // Stand-in for pdf.js: parser.js itself still runs for real against
    // this fake "page text," which is deliberately laid out (see the
    // comment below) so paragraph reconstruction — the trickiest part of
    // the real parser — behaves the same way it does on a real PDF.
    window.pdfjsLib = {
      getDocument: () => ({
        promise: Promise.resolve({
          numPages: 1,
          getPage: async () => ({
            getTextContent: async () => ({
              // Most gaps here are 13 (a normal line-wrap within one
              // speech); gaps of 30 — before every heading/speaker — are
              // deliberately larger so parser.js's paragraph-break logic
              // (anything > 1.5x the typical gap starts a new paragraph)
              // correctly separates them, the same way real PDF line-
              // spacing does. A second scene (SCENE 2) is included so
              // scene-browsing/navigation has more than one scene to
              // exercise, in both Act/Scene review and Reading/Practice
              // mode — ALICE and BOB each get one line in each scene.
              items: [
                { str: "ACT I", transform: [1, 0, 0, 1, 50, 1000] },
                { str: "ALICE", transform: [1, 0, 0, 1, 50, 970] },
                { str: "Hello there,", transform: [1, 0, 0, 1, 50, 957] },
                { str: "how are you doing today?", transform: [1, 0, 0, 1, 50, 944] },
                { str: "BOB", transform: [1, 0, 0, 1, 50, 914] },
                { str: "I'm fine,", transform: [1, 0, 0, 1, 50, 901] },
                { str: "thanks.", transform: [1, 0, 0, 1, 50, 888] },
                { str: "SCENE 2", transform: [1, 0, 0, 1, 50, 858] },
                { str: "ALICE", transform: [1, 0, 0, 1, 50, 828] },
                { str: "Let's go to the market.", transform: [1, 0, 0, 1, 50, 815] },
                { str: "BOB", transform: [1, 0, 0, 1, 50, 785] },
                { str: "A splendid idea.", transform: [1, 0, 0, 1, 50, 772] },
              ],
            }),
          }),
        }),
      }),
    };
  });

  await page.goto("http://localhost:8766/index.html");
  await page.waitForTimeout(300);

  const check = async (label, fn) => {
    const ok = await fn();
    console.log((ok ? "PASS" : "FAIL") + " — " + label);
    return ok;
  };

  // ---- Sign in ----
  await check("starts on the sign-in screen", async () =>
    !(await page.locator("#screen-signin").isHidden()));

  await page.fill("#emailInput", "andy@example.com");
  await page.click("#sendLinkBtn");
  await page.waitForTimeout(150);
  await page.evaluate(() => window.__authCb("SIGNED_IN", { user: { id: "u1" } }));
  await page.waitForTimeout(200);

  await check("lands on your-shows once signed in", async () =>
    !(await page.locator("#screen-your-shows").isHidden()));
  await check("shows the no-shows hint when there are none yet", async () =>
    !(await page.locator("#noShowsHint").isHidden()));

  // ---- Cast member claims a specific part by its personal code ----
  await page.fill("#joinCode", "partcodeX");
  await page.click("#joinShowBtn");
  await page.waitForTimeout(200);

  await check("claiming a part code opens that show directly", async () =>
    !(await page.locator("#screen-show").isHidden()));
  await check("this account is NOT treated as that show's admin", async () =>
    (await page.locator("#showAdminActions").isHidden()));
  await check("shows the claimed character name", async () =>
    (await page.locator("#myPartText").textContent()).includes("Mrs. Malaprop"));
  await check("a cast member never sees the show's general invite code", async () =>
    (await page.locator("#showInviteCodeRow").isHidden()));

  // ---- My Part: a cast member's own lines, with cue-line context ----
  await check("a cast member with a claimed part sees 'View my lines'", async () =>
    !(await page.locator("#viewMyPartBtn").isHidden()));

  await page.click("#viewMyPartBtn");
  await page.waitForTimeout(150);

  await check("'Practice my lines' opens a scene browser first", async () =>
    !(await page.locator("#screen-my-part").isHidden()));
  await check("shows the character's name as the heading", async () =>
    (await page.locator("#myPartCharName").textContent()).includes("Mrs. Malaprop"));
  await check("the scene with this character's lines is listed", async () =>
    (await page.locator("#myPartSceneList").textContent()).includes("Scene 1"));
  await check("defaults to a 1-line lookback", async () =>
    (await page.locator("#lookback1Btn").getAttribute("class") || "").includes("active"));

  // ---- Recording progress on the scene list, and "Only show my scenes"
  // (added 2026-09-24) — Scene 1 has 2 of this character's lines (none
  // recorded yet); the ACT II scene has none at all. ----
  await check("shows 0 of 2 recorded before anything's been recorded", async () =>
    (await page.locator("#myPartSceneList").textContent()).includes("0 of 2 recorded"));
  await check("a scene with none of this character's lines is listed too, before filtering", async () =>
    (await page.locator("#myPartSceneList").textContent()).includes("ACT II"));

  await page.click("#onlyMySceneBtn");
  await page.waitForTimeout(50);
  await check("'Only show my scenes' hides the scene with none of this character's lines", async () =>
    (await page.locator("#onlyMySceneBtn").getAttribute("class") || "").includes("active") &&
    !(await page.locator("#myPartSceneList").textContent()).includes("ACT II") &&
    (await page.locator("#myPartSceneList").textContent()).includes("Scene 1"));

  await page.click("#onlyMySceneBtn");
  await page.waitForTimeout(50);
  await check("turning the toggle back off shows every scene again", async () =>
    (await page.locator("#myPartSceneList").textContent()).includes("ACT II"));

  await page.locator("#myPartSceneList .groupbtn", { hasText: "Scene 1" }).click();
  await page.waitForTimeout(150);

  await check("opens the practice screen for that scene", async () =>
    !(await page.locator("#screen-practice-scene").isHidden()));
  await check("shows one card per line belonging to this character", async () =>
    (await page.locator(".mypart-item").count()) === 2);
  await check("shows the preceding line as cue context, in full", async () =>
    (await page.locator(".mypart-item").first().locator(".cue-line").count()) === 1 &&
    (await page.locator(".mypart-item").first().locator(".cue-line").textContent()).includes(
      "Good morning, madam, I trust you slept well."));
  await check("the actor's own line starts hidden behind a short hint", async () => {
    const text = await page.locator(".mypart-item").first().locator(".my-line .line-text").textContent();
    return text.includes("…") && !text.includes("kind sir");
  });

  await page.locator(".mypart-item").first().locator(".my-line").click();
  await page.waitForTimeout(50);
  await check("tapping the line reveals the full text", async () =>
    (await page.locator(".mypart-item").first().locator(".my-line .line-text").textContent())
      .includes("Good morning to you as well, kind sir."));

  await page.locator(".mypart-item").first().locator(".my-line").click();
  await page.waitForTimeout(50);
  await check("tapping it again hides it behind the hint once more", async () => {
    const text = await page.locator(".mypart-item").first().locator(".my-line .line-text").textContent();
    return text.includes("…") && !text.includes("kind sir");
  });

  await check("with a 1-line lookback, the second line shows only 1 cue", async () =>
    (await page.locator(".mypart-item").nth(1).locator(".cue-line").count()) === 1);

  await page.click("#backToScenesFromPractice");
  await page.waitForTimeout(100);
  await page.click("#lookback2Btn");
  await page.waitForTimeout(150);

  await check("switching to a 2-line lookback marks that button active", async () =>
    (await page.locator("#lookback2Btn").getAttribute("class") || "").includes("active"));

  await page.locator("#myPartSceneList .groupbtn", { hasText: "Scene 1" }).click();
  await page.waitForTimeout(150);

  await check("the second line now shows 2 cues instead of 1", async () =>
    (await page.locator(".mypart-item").nth(1).locator(".cue-line").count()) === 2);

  // ---- Recording your own lines (self-recording, added 2026-09-20; made
  // continuous across lines, 2026-09-24) ----
  // Uses this same preset show/part (Mrs. Malaprop, 2 lines, 1 scene) since
  // nothing else in this file ever edits or re-saves its script — the
  // ideal stable ground for exercising this feature on its own.
  await check("'Record my lines' is offered on a scene this character has lines in", async () =>
    !(await page.locator("#recordMyLinesBtn").isHidden()));

  await page.click("#recordMyLinesBtn");
  await page.waitForTimeout(100);

  await check("opens the recording screen", async () =>
    !(await page.locator("#screen-record-scene").isHidden()));
  await check("shows progress through this character's lines in the scene", async () =>
    (await page.locator("#recordProgressHint").textContent()) === "Line 1 of 2");
  await check("shows the first line in full, ready to record", async () =>
    (await page.locator("#recordLineText").textContent()) === "Good morning to you as well, kind sir.");
  await check("nothing recorded yet for this line", async () =>
    (await page.locator("#recordLineStatus").textContent()).includes("Not recorded yet") &&
    (await page.locator("#playRecordingBtn").isHidden()));

  await page.click("#recordToggleBtn");
  await page.waitForTimeout(50);
  await check("tapping Record starts capturing audio", async () =>
    (await page.locator("#recordToggleBtn").textContent()) === "Stop" &&
    (await page.locator("#recordLineStatus").textContent()).includes("Recording"));
  await check("moving to another line is now allowed WHILE recording — that's the whole point", async () =>
    !(await page.locator("#recordNextLineBtn").isDisabled()));

  // Tap Next without ever tapping Stop first — this should cut line 1's
  // take right here, save it in the background, and carry straight on
  // recording into line 2 with no separate Record press needed for it.
  await page.click("#recordNextLineBtn");
  await page.waitForTimeout(50);
  await check("moving on mid-recording shows the next line, and keeps recording", async () =>
    (await page.locator("#recordProgressHint").textContent()) === "Line 2 of 2" &&
    (await page.locator("#recordLineText").textContent()) ===
      "Tolerably well, I thank you, though the night was warm." &&
    (await page.locator("#recordToggleBtn").textContent()) === "Stop" &&
    (await page.locator("#recordLineStatus").textContent()).includes("Recording"));

  await page.waitForTimeout(150); // let line 1's background save finish

  await page.click("#recordToggleBtn"); // Stop — ends the session for good
  await page.waitForTimeout(150);
  await check("tapping Stop saves the take that was still in progress", async () =>
    (await page.locator("#recordLineStatus").textContent()).includes("Recorded") &&
    !(await page.locator("#playRecordingBtn").isHidden()));

  await page.click("#recordPrevLineBtn");
  await page.waitForTimeout(50);
  await check("the first line was also saved, even though Next (not Stop) was what cut it off", async () =>
    (await page.locator("#recordLineStatus").textContent()).includes("Recorded") &&
    !(await page.locator("#playRecordingBtn").isHidden()));

  await page.click("#backToPracticeFromRecord");
  await page.waitForTimeout(100);
  await check("'Done' returns to the practice screen for this scene", async () =>
    !(await page.locator("#screen-practice-scene").isHidden()));

  // Re-opening the recording screen re-fetches from "the database" rather
  // than relying on anything still held in memory — this is what actually
  // proves save_line_recording and reading recordings back both work, not
  // just the on-screen state from the same visit.
  await page.click("#recordMyLinesBtn");
  await page.waitForTimeout(100);
  await check("both lines still show as recorded after reopening the screen fresh", async () =>
    (await page.locator("#recordLineStatus").textContent()).includes("Recorded"));
  await page.click("#recordNextLineBtn");
  await page.waitForTimeout(50);
  await check("the second line also still shows as recorded after reopening fresh", async () =>
    (await page.locator("#recordLineStatus").textContent()).includes("Recorded"));

  await page.click("#backToPracticeFromRecord");
  await page.waitForTimeout(100);

  await page.click("#backToScenesFromPractice");
  await page.waitForTimeout(100);
  await check("the scene list now shows both of this character's lines as recorded", async () =>
    (await page.locator("#myPartSceneList").textContent()).includes("2 of 2 recorded"));

  await page.click("#backToShowFromMyPart");
  await page.waitForTimeout(150);
  await page.click("#viewMyPartBtn");
  await page.waitForTimeout(150);

  await check("the 2-line lookback choice is remembered on the next visit", async () =>
    (await page.locator("#lookback2Btn").getAttribute("class") || "").includes("active"));

  await page.click("#backToShowFromMyPart");
  await page.waitForTimeout(100);

  // ---- A part someone else already claimed refuses a second claimant ----
  await page.click("#backToShows");
  await page.waitForTimeout(150);
  await page.fill("#joinCode", "takencode");
  await page.click("#joinShowBtn");
  await page.waitForTimeout(200);
  await check("claiming an already-claimed part shows an error, not a crash", async () =>
    (await page.locator("#showsErr").textContent()).toLowerCase().includes("already been claimed"));

  // ---- A code that isn't a part falls back to the show's general code ----
  await page.fill("#joinCode", "crewcode");
  await page.click("#joinShowBtn");
  await page.waitForTimeout(200);
  await check("a show's own general code still works as a fallback", async () =>
    !(await page.locator("#screen-show").isHidden()));
  await check("joining generally (no part) shows the no-part message", async () =>
    (await page.locator("#myPartText").textContent()).includes("No specific part assigned"));
  await check("even joining by the general code doesn't reveal it to a non-admin", async () =>
    (await page.locator("#showInviteCodeRow").isHidden()));

  await page.click("#backToShows");
  await page.waitForTimeout(150);

  // ---- Director/admin path: manage groups -> create group -> create show ----
  await page.click("#goToYourGroups");
  await page.waitForTimeout(150);
  await check("moves to your-groups", async () =>
    !(await page.locator("#screen-your-groups").isHidden()));

  await page.fill("#newGroupName", "Tacoma Little Theatre");
  await page.click("#createGroupBtn");
  await page.waitForTimeout(200);

  await page.fill("#newShowName", "The Rivals — Fall 2026");
  await page.click("#createShowBtn");
  await page.waitForTimeout(200);

  await check("creating a show opens its detail screen directly", async () =>
    !(await page.locator("#screen-show").isHidden()));
  await check("this account IS treated as the show's admin", async () =>
    !(await page.locator("#showAdminActions").isHidden()));
  await check("the admin DOES see the show's general invite code", async () =>
    !(await page.locator("#showInviteCodeRow").isHidden()) &&
    (await page.locator("#showInviteCode").textContent()).length > 0);
  await check("an admin with no script yet sees 'Upload script'", async () =>
    !(await page.locator("#uploadScriptBtn").isHidden()));
  await check("a director with no claimed part yet doesn't see the 'ask your director' nudge", async () =>
    (await page.locator("#myPartText").isHidden()));
  await check("a director with no claimed part yet doesn't see 'View my lines'", async () =>
    (await page.locator("#viewMyPartBtn").isHidden()));
  await check("with no script uploaded yet, 'Read the script' isn't offered", async () =>
    (await page.locator("#readScriptBtn").isHidden()));

  // ---- Upload and parse a script ----
  const tmpPdf = path.join(os.tmpdir(), "fake-script.pdf");
  fs.writeFileSync(tmpPdf, "%PDF-1.4 (not a real PDF — pdf.js is stubbed for this test)");

  await page.click("#uploadScriptBtn");
  await page.waitForTimeout(100);
  await check("moves to the upload-script screen", async () =>
    !(await page.locator("#screen-upload-script").isHidden()));

  await page.setInputFiles("#fileInput", tmpPdf);
  await page.check("#certifyBox");
  await check("the read button enables once a file is chosen and certified", async () =>
    !(await page.locator("#startScriptBtn").isDisabled()));

  await page.click("#startScriptBtn");
  await page.waitForTimeout(300);

  await check("moves to the review screen after parsing", async () =>
    !(await page.locator("#screen-review-script").isHidden()));
  await check("found both characters from the fake script", async () => {
    const names = await page.locator("#scriptCharList .charname").evaluateAll((els) => els.map((el) => el.value));
    return names.includes("ALICE") && names.includes("BOB");
  });

  // ---- The review screen also detects Act/Scene structure ----
  await check("the review screen shows a Scenes section grouped by Act", async () =>
    (await page.locator("#scriptSceneList").textContent()).includes("ACT I"));
  await check("a scene with no explicit heading gets a sensible default label", async () =>
    (await page.locator(".scenecard").nth(0).locator(".scenename").inputValue()) === "Scene 1");
  await check("an explicitly-headed scene keeps its detected label", async () =>
    (await page.locator(".scenecard").nth(1).locator(".scenename").inputValue()) === "SCENE 2");
  await check("each detected scene shows its line count", async () => {
    const counts = await page.locator(".scenecard .linecount").allTextContents();
    return counts[0].includes("2 line") && counts[1].includes("2 line");
  });
  await check("the first scene has no 'remove this scene break' option", async () =>
    (await page.locator(".scenecard").nth(0).getByRole("button", { name: /remove this scene break/i }).count()) === 0);
  await check("a later scene offers 'remove this scene break'", async () =>
    (await page.locator(".scenecard").nth(1).getByRole("button", { name: /remove this scene break/i }).count()) === 1);
  await check("a scene with content after it offers 'split this scene'", async () =>
    (await page.locator(".scene-split-row").count()) >= 1);

  // Rename the second scene's label — carried through to save_script below,
  // and checked again once it comes back from "the database" further down.
  await page.locator(".scenecard").nth(1).locator(".scenename").fill("The Market");

  // Rename one character before saving — this exercises the rawLabel/name
  // split (renaming must not disconnect the character from their lines).
  const nameInputs = page.locator("#scriptCharList .charname");
  const count = await nameInputs.count();
  for (let i = 0; i < count; i++) {
    const val = await nameInputs.nth(i).inputValue();
    if (val === "ALICE") {
      await nameInputs.nth(i).fill("ALICE (renamed)");
      break;
    }
  }

  await page.click("#saveScriptBtn");
  await page.waitForTimeout(200);

  await check("moves straight to assign-parts after saving", async () =>
    !(await page.locator("#screen-assign-parts").isHidden()));
  await check("the renamed character appears as its own part", async () =>
    (await page.locator("#partsList").textContent()).includes("ALICE (renamed)"));
  await check("the unrenamed character also appears as its own part", async () =>
    (await page.locator("#partsList").textContent()).includes("BOB"));
  await check("an unclaimed part shows a shareable link", async () =>
    (await page.locator("#partsList .code").first().textContent()).includes("?code="));
  await check("an unclaimed part offers copy/text/email options", async () => {
    const text = await page.locator("#partsList").textContent();
    return text.includes("Copy link") && text.includes("Text it") && text.includes("Email it");
  });

  // ---- The director can also claim a part in their own show ----
  await check("the assign-parts screen offers 'claim this for yourself' on an unclaimed part", async () =>
    (await page.locator("#partsList").textContent()).includes("Claim this for yourself"));

  const aliceCard = page.locator(".partcard", { hasText: "ALICE (renamed)" });
  await aliceCard.getByRole("button", { name: /claim this for yourself/i }).click();
  await page.waitForTimeout(150);

  await check("claiming a part for yourself marks it claimed on the assign-parts screen", async () => {
    const cards = await page.locator(".partcard").allTextContents();
    return cards.some((c) => c.includes("ALICE (renamed)") && c.includes("Claimed"));
  });

  await page.click("#backToShowFromParts");
  await page.waitForTimeout(150);

  await check("the director also sees their own claimed part on the show screen", async () =>
    (await page.locator("#myPartText").textContent()).includes("ALICE (renamed)"));
  await check("the director still sees admin controls at the same time", async () =>
    !(await page.locator("#showAdminActions").isHidden()));
  await check("the director can open 'My Part' for their own claimed role", async () =>
    !(await page.locator("#viewMyPartBtn").isHidden()));

  await page.click("#viewMyPartBtn");
  await page.waitForTimeout(150);
  await check("'Practice my lines' opens a scene browser, not lines directly", async () =>
    !(await page.locator("#screen-my-part").isHidden()) &&
    (await page.locator("#screen-my-part .mypart-item").count()) === 0);
  await check("the director's own My Part screen shows their character's name", async () =>
    (await page.locator("#myPartCharName").textContent()).includes("ALICE (renamed)"));
  await check("the scene browser shows both detected scenes, grouped under Act I", async () => {
    const text = await page.locator("#myPartSceneList").textContent();
    return text.includes("ACT I") && text.includes("Scene 1") && text.includes("The Market");
  });
  await check("each scene notes how many of the director's own lines it has", async () =>
    (await page.locator("#myPartSceneList").textContent()).includes("1 of your line"));

  await page.locator("#myPartSceneList .groupbtn", { hasText: "Scene 1" }).click();
  await page.waitForTimeout(150);

  await check("opens the practice screen for that scene", async () =>
    !(await page.locator("#screen-practice-scene").isHidden()));
  await check("shows the scene heading", async () =>
    (await page.locator("#practiceSceneHeading").textContent()).includes("Scene 1"));
  await check("shows one card for the director's one line in this scene", async () =>
    (await page.locator(".mypart-item").count()) === 1);
  await check("the line starts hidden behind a hint", async () => {
    const text = await page.locator(".my-line .line-text").textContent();
    return text.includes("…") && !text.includes("doing today");
  });
  await check("there's no previous scene from the first one", async () =>
    (await page.locator("#practicePrevSceneBtn").isDisabled()));
  await check("moving to the next scene is available", async () =>
    !(await page.locator("#practiceNextSceneBtn").isDisabled()));

  await page.click("#revealAllBtn");
  await page.waitForTimeout(50);
  await check("'Reveal all' shows the line in full without tapping it", async () =>
    (await page.locator(".my-line .line-text").textContent()).includes("doing today"));
  await check("the button now offers to hide everything again", async () =>
    (await page.locator("#revealAllBtn").textContent()).toLowerCase().includes("hide all"));

  await page.click("#practiceNextSceneBtn");
  await page.waitForTimeout(150);

  await check("moving to the next scene shows its own (renamed) heading", async () =>
    (await page.locator("#practiceSceneHeading").textContent()).includes("The Market"));
  await check("'Reveal all' stayed on after moving to the next scene", async () =>
    (await page.locator(".my-line.revealed").count()) === 1);

  await page.click("#backToScenesFromPractice");
  await page.waitForTimeout(100);
  await check("'Back to scene list' returns to the scene browser", async () =>
    !(await page.locator("#screen-my-part").isHidden()));

  await page.click("#backToShowFromMyPart");
  await page.waitForTimeout(100);

  // ---- Read the script: full text, own lines highlighted ----
  await check("the show screen offers 'Read the script' once a script exists", async () =>
    !(await page.locator("#readScriptBtn").isHidden()));

  await page.click("#readScriptBtn");
  await page.waitForTimeout(150);

  await check("opens the read-script scene browser", async () =>
    !(await page.locator("#screen-read-script").isHidden()));
  await check("shows the renamed second scene's label here too", async () =>
    (await page.locator("#readSceneList").textContent()).includes("The Market"));

  await page.locator("#readSceneList .groupbtn", { hasText: "Scene 1" }).click();
  await page.waitForTimeout(150);

  await check("opens the full scene text", async () =>
    !(await page.locator("#screen-read-scene").isHidden()));
  await check("shows every line in the scene in full, nothing hidden", async () => {
    const text = await page.locator("#readSceneContent").textContent();
    return text.includes("Hello there, how are you doing today?") && text.includes("I'm fine, thanks.");
  });
  await check("the director's own line is visually highlighted", async () =>
    (await page.locator(".read-line-mine").count()) === 1);
  await check("the highlighted line is the director's own", async () =>
    (await page.locator(".read-line-mine").textContent()).includes("Hello there"));
  await check("there's no previous scene from the first one", async () =>
    (await page.locator("#readPrevSceneBtn").isDisabled()));

  await page.click("#readNextSceneBtn");
  await page.waitForTimeout(150);

  await check("next scene shows the renamed scene's own content", async () => {
    const text = await page.locator("#readSceneContent").textContent();
    return text.includes("Let's go to the market.") && text.includes("A splendid idea.");
  });

  await page.click("#backToReadListFromScene");
  await page.waitForTimeout(100);
  await check("'Back to scene list' returns to the read-script browser", async () =>
    !(await page.locator("#screen-read-script").isHidden()));

  // ---- Editing a scene's lines (admin only) — the non-admin/cast case
  // isn't re-tested end to end here: "Edit this scene" is gated by the
  // exact same isAdmin boolean already covered by "this account is NOT
  // treated as that show's admin" earlier in this file. ----
  await page.locator("#readSceneList .groupbtn", { hasText: "Scene 1" }).click();
  await page.waitForTimeout(150);

  await check("the admin sees an 'Edit this scene' option", async () =>
    !(await page.locator("#editThisSceneBtn").isHidden()));

  await page.click("#editThisSceneBtn");
  await page.waitForTimeout(100);

  await check("edit mode replaces the read-only scene view", async () =>
    !(await page.locator("#editSceneArea").isHidden()) &&
    (await page.locator("#readSceneContent").isHidden()));
  await check("shows one editable row per line in the scene, including its heading", async () =>
    (await page.locator(".editlinecard").count()) === 3);

  const aliceRow = page.locator(".editlinecard").nth(1);
  await check("the second row is ALICE's blended line", async () =>
    (await aliceRow.locator("textarea").inputValue()).includes("Hello there"));

  await aliceRow.getByRole("button", { name: "Split into two" }).click();
  await page.waitForTimeout(50);
  await check("'Split into two' adds a duplicate row right after it", async () =>
    (await page.locator(".editlinecard").count()) === 4);

  // Trim the split halves down to what they should actually say, so the
  // upcoming merge check has real, distinguishable text on each side (a
  // freshly-split row starts as a duplicate of the whole original line).
  await page.locator(".editlinecard").nth(1).locator("textarea").fill("Hello there,");
  await page.locator(".editlinecard").nth(2).locator("textarea").fill("how are you doing today?");

  await page.locator(".editlinecard").nth(2).getByRole("button", { name: "Insert line below" }).click();
  await page.waitForTimeout(50);
  await check("'Insert line below' adds a blank row", async () =>
    (await page.locator(".editlinecard").count()) === 5);

  await page.locator(".editlinecard").nth(3).getByRole("button", { name: "Delete" }).click();
  await page.waitForTimeout(50);
  await check("'Delete' removes that row again", async () =>
    (await page.locator(".editlinecard").count()) === 4);

  await page.locator(".editlinecard").nth(1).getByRole("button", { name: "Merge with next" }).click();
  await page.waitForTimeout(50);
  await check("'Merge with next' joins the two rows' text back into one", async () => {
    const count = (await page.locator(".editlinecard").count()) === 3;
    const text = await page.locator(".editlinecard").nth(1).locator("textarea").inputValue();
    return count && text === "Hello there, how are you doing today?";
  });

  await page.click("#cancelSceneEditsBtn");
  await page.waitForTimeout(100);
  await check("'Cancel' discards the edits and returns to the read-only view", async () =>
    (await page.locator("#editSceneArea").isHidden()) &&
    !(await page.locator("#readSceneContent").isHidden()) &&
    (await page.locator("#readSceneContent").textContent()).includes("Hello there, how are you doing today?"));

  // Now make a real, deliberate split and save it.
  await page.click("#editThisSceneBtn");
  await page.waitForTimeout(100);
  await page.locator(".editlinecard").nth(1).getByRole("button", { name: "Split into two" }).click();
  await page.waitForTimeout(50);
  await page.locator(".editlinecard").nth(1).locator("textarea").fill("Hello there,");
  await page.locator(".editlinecard").nth(2).locator("textarea").fill("how are you doing today?");

  await page.click("#saveSceneEditsBtn");
  await page.waitForTimeout(250);

  await check("saving a scene edit returns to the scene browser", async () =>
    !(await page.locator("#screen-read-script").isHidden()));

  await page.locator("#readSceneList .groupbtn", { hasText: "Scene 1" }).click();
  await page.waitForTimeout(150);

  await check("the split shows up as two separate lines when reading the scene", async () => {
    const lines = await page.locator("#readSceneContent .read-line").allTextContents();
    return lines.some((t) => t.trim() === "ALICE (renamed): Hello there,") &&
      lines.some((t) => t.trim() === "ALICE (renamed): how are you doing today?");
  });

  await page.click("#readNextSceneBtn");
  await page.waitForTimeout(150);
  await check("the other scene is untouched by editing this one", async () => {
    const text = await page.locator("#readSceneContent").textContent();
    return text.includes("Let's go to the market.") && text.includes("A splendid idea.");
  });

  // ---- Inserting a brand-new heading mid-scene splits it into two saved
  // scenes, and the untouched scene after it keeps its own custom label
  // ("The Market") rather than losing it to renumbering. ----
  await page.click("#backToReadListFromScene");
  await page.waitForTimeout(100);
  await page.locator("#readSceneList .groupbtn", { hasText: "Scene 1" }).click();
  await page.waitForTimeout(150);
  await page.click("#editThisSceneBtn");
  await page.waitForTimeout(100);

  // Rows are now [ACT I heading, "Hello there,", "how are you doing
  // today?", BOB] — insert a new heading after the second ALICE row so BOB
  // ends up in a scene of his own.
  await page.locator(".editlinecard").nth(2).getByRole("button", { name: "Insert line below" }).click();
  await page.waitForTimeout(50);
  const newHeadingRow = page.locator(".editlinecard").nth(3);
  await newHeadingRow.locator("select").selectOption("heading");
  await page.waitForTimeout(50);
  await newHeadingRow.locator("textarea").fill("Scene 3");

  await page.click("#saveSceneEditsBtn");
  await page.waitForTimeout(250);

  await check("the scene browser now shows the new scene as its own entry", async () =>
    (await page.locator("#readSceneList").textContent()).includes("Scene 3"));
  await check("the untouched scene after it keeps its own custom label", async () =>
    (await page.locator("#readSceneList").textContent()).includes("The Market"));

  await page.locator("#readSceneList .groupbtn", { hasText: "Scene 3" }).click();
  await page.waitForTimeout(150);
  await check("the new scene contains just the line moved into it", async () => {
    const text = await page.locator("#readSceneContent").textContent();
    return text.includes("I'm fine, thanks.") && !text.includes("Hello there");
  });

  await page.click("#readNextSceneBtn");
  await page.waitForTimeout(150);
  await check("moving past the new scene still reaches the untouched one, unchanged", async () => {
    const text = await page.locator("#readSceneContent").textContent();
    return text.includes("Let's go to the market.") && text.includes("A splendid idea.");
  });

  // ---- Andy's real-world case: a scene's content actually continues into
  // what the parser had separately detected as the NEXT scene — pull that
  // adjacent scene's rows into this edit with "Include next scene", then
  // delete its now-redundant heading to fold the two into one. ----
  await page.click("#backToReadListFromScene");
  await page.waitForTimeout(100);
  await page.locator("#readSceneList .groupbtn", { hasText: "Scene 3" }).click();
  await page.waitForTimeout(150);
  await page.click("#editThisSceneBtn");
  await page.waitForTimeout(100);

  await check("both 'include previous' and 'include next' are offered here", async () =>
    !(await page.locator("#includePrevSceneBtn").isHidden()) &&
    !(await page.locator("#includeNextSceneBtn").isHidden()));

  await page.click("#includeNextSceneBtn");
  await page.waitForTimeout(50);
  // Scene 3 itself is [heading "Scene 3", BOB's line] (2 rows) and the
  // pulled-in "The Market" scene is [heading "SCENE 2", ALICE's line, BOB's
  // line] (3 rows), so the combined edit buffer now holds 5 rows.
  await check("including the next scene pulls all of its rows into this edit", async () =>
    (await page.locator(".editlinecard").count()) === 5);
  await check("the range hint mentions more than one scene is being edited together", async () =>
    (await page.locator("#editSceneRangeHint").textContent()).includes("2 scenes"));

  // Find the pulled-in heading row (originally "SCENE 2") and delete it —
  // its old scene now has nothing left marking its own boundary, so its
  // lines fold into the scene being edited on save. There are two heading
  // rows now (Scene 3's own at index 0, and the pulled-in one) — skip the
  // first and take the later one.
  const cardCount = await page.locator(".editlinecard").count();
  let headingCardIndex = -1;
  for (let i = 1; i < cardCount; i++) {
    if ((await page.locator(".editlinecard").nth(i).locator("select").inputValue()) === "heading") {
      headingCardIndex = i;
      break;
    }
  }
  await check("the pulled-in scene's own heading row is there to fix", async () => headingCardIndex > 0);
  await page.locator(".editlinecard").nth(headingCardIndex).getByRole("button", { name: "Delete" }).click();
  await page.waitForTimeout(50);
  await check("deleting it leaves the other scene's dialogue rows in place", async () =>
    (await page.locator(".editlinecard").count()) === 4);

  await page.click("#saveSceneEditsBtn");
  await page.waitForTimeout(250);

  await check("the two scenes are now shown as one", async () =>
    !(await page.locator("#readSceneList").textContent()).includes("The Market"));

  await page.locator("#readSceneList .groupbtn", { hasText: "Scene 3" }).click();
  await page.waitForTimeout(150);
  await check("the merged scene contains both the original and pulled-in dialogue", async () => {
    const text = await page.locator("#readSceneContent").textContent();
    return text.includes("I'm fine, thanks.") &&
      text.includes("Let's go to the market.") &&
      text.includes("A splendid idea.");
  });
  await check("there's no longer a separate scene after it", async () =>
    (await page.locator("#readNextSceneBtn").isDisabled()));

  await page.click("#backToReadListFromScene");
  await page.waitForTimeout(100);
  await page.click("#backToShowFromReadScript");
  await page.waitForTimeout(100);
  await page.click("#manageScriptBtn");
  await page.waitForTimeout(150);

  // ---- Admin frees up a part someone else had claimed ----
  await page.evaluate(() => {
    window.__parts = window.__parts.map((p) =>
      p.character_name === "BOB" ? { ...p, claimed_by: "someActor", claimed_at: "2026-01-01" } : p
    );
  });
  await page.click("#backToShowFromParts");
  await page.waitForTimeout(100);
  await page.click("#manageScriptBtn");
  await page.waitForTimeout(150);

  await check("re-opening the parts screen shows BOB as claimed", async () => {
    const cards = await page.locator(".partcard").allTextContents();
    return cards.some((c) => c.includes("BOB") && c.includes("Claimed"));
  });

  const bobCard = page.locator(".partcard", { hasText: "BOB" });
  await bobCard.getByRole("button", { name: /unassign/i }).click();
  await page.waitForTimeout(150);

  await check("unassigning BOB's part makes it shareable again", async () => {
    const cards = await page.locator(".partcard").allTextContents();
    return cards.some((c) => c.includes("BOB") && c.includes("Not yet claimed"));
  });

  await browser.close();
})();
