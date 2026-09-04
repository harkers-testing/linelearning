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
    window.__parts = []; // {id, show_id, character_name, invite_code, claimed_by, claimed_at}
    let nextPartId = 1;

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

    // A second, unrelated show with no parts assigned at all yet — used to
    // check the "joined generally, no specific part" message in isolation
    // from the show above (which does have a part, so re-using it here
    // would leave the earlier claim still attached).
    window.__shows.push({
      id: "show-crew", group_id: "other-group-2", name: "Crew-only Show",
      invite_code: "crewcode", created_by: "otherAdmin2",
    });
    window.__memberCounts["show-crew"] = 1;

    function eqResult(payload) {
      const p = Promise.resolve(payload);
      p.order = async () => payload;
      // .single() is only ever called (in this app) after .eq("id", ...)
      // filtered a list down to at most one row — hand back that one row
      // directly instead of an array.
      p.single = async () => {
        if (payload.error) return payload;
        const arr = payload.data || [];
        return { data: arr[0] || null, error: null };
      };
      return p;
    }

    const mock = {
      auth: {
        getSession: async () => ({ data: { session: null } }),
        onAuthStateChange: (cb) => { window.__authCb = cb; return { data: { subscription: { unsubscribe() {} } } }; },
        signInWithOtp: async () => ({ error: null }),
        signOut: async () => ({}),
      },
      from: (table) => ({
        select: (cols, opts) => ({
          order: async () => {
            if (table === "groups") return { data: window.__groups, error: null };
            if (table === "shows") {
              // Mirrors real RLS: only shows this account has actually
              // joined (or created, which joins them automatically) show
              // up in "your shows" — not every show that merely exists.
              return { data: window.__shows.filter((s) => window.__memberOf.has(s.id)), error: null };
            }
            return { data: [], error: null };
          },
          eq: (field, val) => {
            if (opts && opts.count) {
              const count = window.__memberCounts[val] ?? 0;
              return eqResult({ count, error: null });
            }
            if (table === "shows") {
              return eqResult({ data: window.__shows.filter((s) => s[field] === val), error: null });
            }
            if (table === "scripts") {
              return eqResult({ data: window.__scripts.filter((s) => s[field] === val), error: null });
            }
            if (table === "parts") {
              return eqResult({ data: window.__parts.filter((p) => p[field] === val), error: null });
            }
            return eqResult({ data: [], error: null });
          },
        }),
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
          return { data: s, error: null };
        }
        if (name === "join_show_by_code") {
          const existing = window.__shows.find((s) => s.invite_code === args.code);
          if (!existing) return { data: null, error: { message: "No show found for that invite code" } };
          window.__memberCounts[existing.id] = (window.__memberCounts[existing.id] ?? 0) + 1;
          window.__memberOf.add(existing.id);
          return { data: existing, error: null };
        }
        if (name === "save_script") {
          const showId = args.target_show_id;
          window.__scripts = window.__scripts.filter((s) => s.show_id !== showId);
          window.__scripts.push({ id: "script" + Date.now(), show_id: showId, file_name: args.script_file_name });

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
          return { data: { ...part }, error: null };
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
              // speech); the two gaps of 30, before ALICE and before BOB,
              // are deliberately larger so parser.js's paragraph-break
              // logic (anything > 1.5x the typical gap starts a new
              // paragraph) correctly separates the heading from the two
              // speeches, the same way real PDF line-spacing does.
              items: [
                { str: "ACT I", transform: [1, 0, 0, 1, 50, 1000] },
                { str: "ALICE", transform: [1, 0, 0, 1, 50, 970] },
                { str: "Hello there,", transform: [1, 0, 0, 1, 50, 957] },
                { str: "how are you?", transform: [1, 0, 0, 1, 50, 944] },
                { str: "BOB", transform: [1, 0, 0, 1, 50, 914] },
                { str: "I'm fine,", transform: [1, 0, 0, 1, 50, 901] },
                { str: "thanks.", transform: [1, 0, 0, 1, 50, 888] },
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
  await check("an admin with no script yet sees 'Upload script'", async () =>
    !(await page.locator("#uploadScriptBtn").isHidden()));

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
