// Rehearsal Group — groups (theatres/companies, admin-only) containing
// shows (individual productions, what cast members actually join), each
// with a script (attached by the show's admin) and one "part" per
// character, each with its own personal invite code an admin can hand
// directly to the actor playing it.
// Talks to Supabase (see config.js for the two values you need to fill in,
// and schema.sql for the database setup this code assumes already exists).

// Careful: the Supabase library itself creates a global variable called
// "supabase" (from the CDN script tag in index.html). Naming our own client
// the same thing would silently break the whole page — declaring `const
// supabase = ...` on top of an existing `var supabase` from another script
// tag is a JavaScript error that stops this entire file from running, with
// no visible sign to anyone just using the page. Calling it `sb` avoids that.
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const $ = (id) => document.getElementById(id);

function showScreen(name) {
  document.querySelectorAll(".screen").forEach((el) => {
    el.hidden = el.id !== `screen-${name}`;
  });
}

function setStage(text) {
  $("stageLabel").textContent = text;
}

function showError(el, err) {
  el.textContent = err && err.message ? err.message : String(err);
  el.hidden = false;
}

function clearError(el) {
  el.hidden = true;
  el.textContent = "";
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[c]);
}

// A personal part link looks like ".../?code=xyz123". Capture it once, right
// away, before anything else runs — a magic-link sign-in round trip involves
// a full page reload, so this is read fresh every time the page loads.
function getCodeFromUrl() {
  return new URLSearchParams(window.location.search).get("code");
}
let pendingCode = getCodeFromUrl();

function clearCodeFromUrl() {
  if (window.location.search) {
    window.history.replaceState({}, document.title, window.location.pathname);
  }
}

let currentUserId = null;

// ---- Sign in ----

$("sendLinkBtn").addEventListener("click", async () => {
  const email = $("emailInput").value.trim();
  const errEl = $("signinErr");
  clearError(errEl);

  if (!email) {
    showError(errEl, "Enter your email first.");
    return;
  }

  $("sendLinkBtn").disabled = true;
  // Keep a pending part code in the link Supabase emails out, so someone
  // who opens their personal part link, then has to sign in for the first
  // time, still lands on the right part once they click the emailed link.
  const codeParam = pendingCode ? "?code=" + encodeURIComponent(pendingCode) : "";
  const redirectTo = window.location.origin + window.location.pathname + codeParam;
  const { error } = await sb.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: redirectTo },
  });
  $("sendLinkBtn").disabled = false;

  if (error) {
    showError(errEl, error);
    return;
  }

  $("sentToEmail").textContent = email;
  showScreen("check-email");
});

$("useDifferentEmail").addEventListener("click", () => {
  showScreen("signin");
});

$("signOutBtn").addEventListener("click", async () => {
  await sb.auth.signOut();
  currentUserId = null;
  showScreen("signin");
  setStage("Signed out");
});

// ---- Your shows (home screen, for cast and admins alike) ----

let currentShows = [];
// Where "back" from the show-detail screen should return to: either the
// top-level "your shows" list, or the group screen a show was opened from.
let showBackTarget = { type: "shows" };

async function loadShows() {
  const errEl = $("showsErr");
  clearError(errEl);

  // shows_public, not shows: a masked view that only ever hands the show's
  // general invite code to that show's own admin — never to a cast member,
  // even one who's a legitimate member of the show (see schema.sql).
  const { data, error } = await sb
    .from("shows_public")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    showError(errEl, error);
    return;
  }

  currentShows = data || [];
  renderShowList();
}

function renderShowList() {
  const list = $("showList");
  list.innerHTML = "";
  $("noShowsHint").hidden = currentShows.length > 0;

  for (const show of currentShows) {
    const btn = document.createElement("button");
    btn.className = "groupbtn";
    btn.innerHTML = `<span class="gname">${escapeHtml(show.name)}</span>`;
    btn.addEventListener("click", () => openShow(show, { type: "shows" }));
    list.appendChild(btn);
  }
}

// Try a code as a personal part code first (the common case for an actor),
// and fall back to treating it as a show's general invite code. One box,
// one action — the person doesn't need to know which kind of code they have.
async function attemptClaimOrJoin(code) {
  const errEl = $("showsErr");
  clearError(errEl);

  const claimResult = await sb.rpc("claim_part_by_code", { code });

  if (!claimResult.error) {
    const { data: show, error: showErr } = await sb
      .from("shows_public")
      .select("*")
      .eq("id", claimResult.data.show_id)
      .single();
    await loadShows();
    if (showErr) {
      showError(errEl, showErr);
      return;
    }
    openShow(show, { type: "shows" });
    return;
  }

  if (/no part found for that code/i.test(claimResult.error.message || "")) {
    const joinResult = await sb.rpc("join_show_by_code", { code });
    if (!joinResult.error) {
      await loadShows();
      openShow(joinResult.data, { type: "shows" });
      return;
    }
    showError(errEl, joinResult.error);
    return;
  }

  showError(errEl, claimResult.error);
}

$("joinShowBtn").addEventListener("click", async () => {
  const code = $("joinCode").value.trim();
  const errEl = $("showsErr");
  clearError(errEl);

  if (!code) {
    showError(errEl, "Enter a code first.");
    return;
  }

  $("joinShowBtn").disabled = true;
  await attemptClaimOrJoin(code);
  $("joinShowBtn").disabled = false;
  $("joinCode").value = "";
});

$("goToYourGroups").addEventListener("click", () => {
  showScreen("your-groups");
  setStage("Your groups");
  loadGroups();
});

// ---- A single show ----

let currentShow = null;
let currentMyPart = null; // this account's own claimed part in currentShow, if any — shared by Practice and Reading mode

async function openShow(show, backTarget) {
  showBackTarget = backTarget;
  currentShow = show;
  $("showName").textContent = show.name;

  const { count } = await sb
    .from("show_members")
    .select("*", { count: "exact", head: true })
    .eq("show_id", show.id);

  $("showStats").textContent = `${count ?? "?"} member${count === 1 ? "" : "s"}`;

  // Whoever created a show is that show's admin (only a group's admin can
  // create a show in it — see create_show in schema.sql) — so this is a
  // reliable, no-extra-query way to tell admin and cast apart here.
  const isAdmin = show.created_by === currentUserId;
  $("showAdminActions").hidden = !isAdmin;

  // Only a show's own admin ever sees its general invite code — a cast
  // member shouldn't be able to see or pass on the code meant for
  // crew/an assistant director. The data itself is already masked to null
  // for non-admins (shows_public, see schema.sql); hiding the row too means
  // there's nothing blank/odd-looking left behind for them either.
  $("showInviteCodeRow").hidden = !isAdmin;

  // Fetched regardless of role: an admin needs it to decide between
  // "Upload script"/"Manage script & cast", and "Read the script" should be
  // offered to anyone with a script to read, admin or cast alike.
  const { data: scriptRows } = await sb.from("scripts").select("id").eq("show_id", show.id);
  const hasScript = !!(scriptRows && scriptRows.length > 0);

  if (isAdmin) {
    $("showInviteCode").textContent = show.invite_code;
    $("uploadScriptBtn").hidden = hasScript;
    $("manageScriptBtn").hidden = !hasScript;
  }

  // A director can also be cast in their own show — that happens in real
  // productions, and it's also what makes it possible to test both the
  // admin side and the cast side from a single account instead of
  // constantly signing in and out. So check for a claimed part regardless
  // of admin status. RLS means a non-admin only ever gets their own
  // claimed part back from this query, while an admin gets every part in
  // the show — either way, this still picks out their own row correctly.
  const { data: partRows } = await sb.from("parts").select("*").eq("show_id", show.id);
  const myPart = (partRows || []).find((p) => p.claimed_by === currentUserId);
  currentMyPart = myPart || null;

  if (myPart) {
    $("myPartText").hidden = false;
    $("myPartText").textContent = `You're playing: ${myPart.character_name}`;
  } else if (isAdmin) {
    // Don't nudge the director to "ask your director" — that's them.
    $("myPartText").hidden = true;
  } else {
    $("myPartText").hidden = false;
    $("myPartText").textContent = "No specific part assigned yet — ask your director.";
  }
  $("viewMyPartBtn").hidden = !myPart;
  $("viewMyPartBtn").onclick = myPart ? () => openMyPart(myPart) : null;
  $("readScriptBtn").hidden = !hasScript;
  $("readScriptBtn").onclick = hasScript ? () => openReadScript() : null;

  showScreen("show");
  setStage(show.name);
}

$("backToShows").addEventListener("click", () => {
  if (showBackTarget.type === "group") {
    openGroupDetail(showBackTarget.group);
  } else {
    showScreen("your-shows");
    setStage("Your shows");
  }
});

// ---- Your groups (admin/director area) ----

let currentGroups = [];
let currentGroup = null;

async function loadGroups() {
  const errEl = $("groupsErr");
  clearError(errEl);

  const { data, error } = await sb
    .from("groups")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    showError(errEl, error);
    return;
  }

  currentGroups = data || [];
  renderGroupList();
}

function renderGroupList() {
  const list = $("groupList");
  list.innerHTML = "";
  $("noGroupsHint").hidden = currentGroups.length > 0;

  for (const group of currentGroups) {
    const btn = document.createElement("button");
    btn.className = "groupbtn";
    btn.innerHTML = `<span class="gname">${escapeHtml(group.name)}</span>`;
    btn.addEventListener("click", () => openGroupDetail(group));
    list.appendChild(btn);
  }
}

$("createGroupBtn").addEventListener("click", async () => {
  const name = $("newGroupName").value.trim();
  const errEl = $("groupsErr");
  clearError(errEl);

  if (!name) {
    showError(errEl, "Give the group a name first.");
    return;
  }

  $("createGroupBtn").disabled = true;
  const { data, error } = await sb.rpc("create_group", { group_name: name });
  $("createGroupBtn").disabled = false;

  if (error) {
    showError(errEl, error);
    return;
  }

  $("newGroupName").value = "";
  await loadGroups();
  openGroupDetail(data);
});

$("backToShowsFromGroups").addEventListener("click", async () => {
  showScreen("your-shows");
  setStage("Your shows");
  await loadShows();
});

// ---- Inside a group: its shows ----

let currentGroupShows = [];

async function openGroupDetail(group) {
  currentGroup = group;
  $("groupName").textContent = group.name;
  showScreen("group");
  setStage(group.name);
  await loadGroupShows(group.id);
}

async function loadGroupShows(groupId) {
  const errEl = $("groupDetailErr");
  clearError(errEl);

  const { data, error } = await sb
    .from("shows_public")
    .select("*")
    .eq("group_id", groupId)
    .order("created_at", { ascending: false });

  if (error) {
    showError(errEl, error);
    return;
  }

  currentGroupShows = data || [];
  renderGroupShowList();
}

function renderGroupShowList() {
  const list = $("groupShowList");
  list.innerHTML = "";
  $("noGroupShowsHint").hidden = currentGroupShows.length > 0;

  for (const show of currentGroupShows) {
    const btn = document.createElement("button");
    btn.className = "groupbtn";
    btn.innerHTML = `<span class="gname">${escapeHtml(show.name)}</span>`;
    btn.addEventListener("click", () => openShow(show, { type: "group", group: currentGroup }));
    list.appendChild(btn);
  }
}

$("createShowBtn").addEventListener("click", async () => {
  const name = $("newShowName").value.trim();
  const errEl = $("groupDetailErr");
  clearError(errEl);

  if (!name) {
    showError(errEl, "Give the show a name first.");
    return;
  }
  if (!currentGroup) {
    showError(errEl, "No group selected — go back and pick a group first.");
    return;
  }

  $("createShowBtn").disabled = true;
  const { data, error } = await sb.rpc("create_show", {
    group_id: currentGroup.id,
    show_name: name,
  });
  $("createShowBtn").disabled = false;

  if (error) {
    showError(errEl, error);
    return;
  }

  $("newShowName").value = "";
  await loadGroupShows(currentGroup.id);
  openShow(data, { type: "group", group: currentGroup });
});

$("backToYourGroups").addEventListener("click", () => {
  showScreen("your-groups");
  setStage("Your groups");
  loadGroups();
});

// ---- Uploading and reviewing a script (admin) ----

let scriptState = { characters: [], sequence: [], sceneGroups: [], skippedCount: 0, fileName: "" };
let scriptNextId = 1;
let chosenScriptFile = null;

function refreshStartScriptBtn() {
  $("startScriptBtn").disabled = !(chosenScriptFile && $("certifyBox").checked);
}

function openScriptUpload() {
  chosenScriptFile = null;
  $("fileInput").value = "";
  $("dzText").textContent = "Tap to choose a PDF, or drop one here";
  $("certifyBox").checked = false;
  refreshStartScriptBtn();
  clearError($("uploadScriptErr"));
  showScreen("upload-script");
  setStage("Upload a script");
}

$("uploadScriptBtn").addEventListener("click", openScriptUpload);
$("replaceScriptBtn").addEventListener("click", openScriptUpload);

$("manageScriptBtn").addEventListener("click", openAssignParts);

$("dropzone").addEventListener("click", () => $("fileInput").click());

$("fileInput").addEventListener("change", () => {
  chosenScriptFile = $("fileInput").files[0] || null;
  $("dzText").textContent = chosenScriptFile ? chosenScriptFile.name : "Tap to choose a PDF, or drop one here";
  refreshStartScriptBtn();
});

["dragover", "dragenter"].forEach((evt) =>
  $("dropzone").addEventListener(evt, (e) => {
    e.preventDefault();
    $("dropzone").classList.add("drag");
  })
);
["dragleave", "drop"].forEach((evt) =>
  $("dropzone").addEventListener(evt, (e) => {
    e.preventDefault();
    $("dropzone").classList.remove("drag");
  })
);
$("dropzone").addEventListener("drop", (e) => {
  const f = e.dataTransfer.files[0];
  if (f) {
    chosenScriptFile = f;
    $("dzText").textContent = f.name;
    refreshStartScriptBtn();
  }
});

$("certifyBox").addEventListener("change", refreshStartScriptBtn);

$("backToShowFromUpload").addEventListener("click", () => {
  openShow(currentShow, showBackTarget);
});

$("startScriptBtn").addEventListener("click", async () => {
  clearError($("uploadScriptErr"));
  showScreen("processing-script");
  setStage("Reading…");
  try {
    await runScriptPipeline(chosenScriptFile);
  } catch (err) {
    showScreen("upload-script");
    setStage("Upload a script");
    showError($("uploadScriptErr"), err);
  }
});

// Running without a separate worker thread trades a little speed for a lot
// of reliability: some hosting setups block a library from spinning up a
// background worker from a third-party script, and this would rather be
// slightly slower than silently fail to read a script.
async function extractPdfPages(file) {
  const buf = await file.arrayBuffer();
  const doc = await pdfjsLib.getDocument({ data: buf, disableWorker: true }).promise;
  const pages = [];
  for (let p = 1; p <= doc.numPages; p++) {
    $("processingScriptMsg").textContent = `Reading page ${p} of ${doc.numPages}…`;
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    pages.push(
      content.items.map((it) => ({ str: it.str, x: it.transform[4], y: it.transform[5] }))
    );
  }
  return pages;
}

async function runScriptPipeline(file) {
  scriptState.fileName = file.name;
  const pages = await extractPdfPages(file);
  $("processingScriptMsg").textContent = "Working out who says what…";
  await new Promise((r) => setTimeout(r, 30)); // let the UI paint
  const { sequence, characters, scenes } = ScriptParser.parseScript(pages);

  scriptState.sequence = sequence;
  scriptState.skippedCount = sequence.filter((s) => s.type === "unassigned").length;
  // rawLabel is kept separate from name (below) on purpose: rawLabel is what
  // every line in `sequence` is actually tagged with, and never changes.
  // name is what's shown and editable on the review screen. Keeping them
  // separate means editing a character's name here still correctly relabels
  // every one of their lines when the script is saved, even after an edit.
  scriptState.characters = characters.map((c) => ({
    id: scriptNextId++, rawLabel: c.name, name: c.name, count: c.count,
  }));

  // label: null means "use the parser's own guess (defaultLabel)" — set
  // once the director types something different. dropBoundary: true means
  // "merge this scene into whichever one came before it" (see
  // renderSceneReview / the save handler below for how that's applied).
  scriptState.sceneGroups = scenes.map((s) => ({ ...s, label: null, dropBoundary: false }));

  if (scriptState.characters.length === 0) {
    throw new Error("couldn't find any character names — is this a play script?");
  }

  renderScriptReview();
  renderSceneReview();
  showScreen("review-script");
  setStage("Check the cast list");
}

function renderScriptReview() {
  const totalLines = scriptState.characters.reduce((s, c) => s + c.count, 0);
  $("reviewScriptSummary").textContent =
    `Found ${scriptState.characters.length} characters across ${totalLines} lines in "${scriptState.fileName}". ` +
    `Fix any name that's wrong, or remove a row that shouldn't be there.`;

  if (scriptState.skippedCount > 0) {
    $("skippedScriptNote").hidden = false;
    $("skippedScriptNote").textContent =
      `${scriptState.skippedCount} bits of text (scene dividers, or framing text) weren't attached to a character — that's expected and can be ignored.`;
  } else {
    $("skippedScriptNote").hidden = true;
  }

  const list = $("scriptCharList");
  list.innerHTML = "";
  const sorted = [...scriptState.characters].sort((a, b) => b.count - a.count);

  for (const c of sorted) {
    const card = document.createElement("div");
    card.className = "charcard";

    const nameInput = document.createElement("input");
    nameInput.className = "charname";
    nameInput.value = c.name;
    nameInput.setAttribute("aria-label", "Character name");
    nameInput.addEventListener("input", () => (c.name = nameInput.value));

    const removeBtn = document.createElement("button");
    removeBtn.className = "btn ghost";
    removeBtn.textContent = "Remove";
    removeBtn.title = "Remove this row (its lines will be left out of the cast list)";
    removeBtn.addEventListener("click", () => {
      scriptState.characters = scriptState.characters.filter((x) => x.id !== c.id);
      renderScriptReview();
    });

    const meta = document.createElement("div");
    meta.className = "charmeta";

    const countSpan = document.createElement("span");
    countSpan.className = "linecount";
    countSpan.textContent = `${c.count} line${c.count === 1 ? "" : "s"}`;

    meta.appendChild(countSpan);

    card.appendChild(nameInput);
    card.appendChild(removeBtn);
    card.appendChild(meta);
    list.appendChild(card);
  }
}

// Guessed automatically from the script's own Act/Scene headings — shown
// here so the director can fix a mislabeled scene or merge one that got
// split by mistake, the same review-before-save pattern already used for
// character names above.
function renderSceneReview() {
  const list = $("scriptSceneList");
  list.innerHTML = "";

  if (scriptState.sceneGroups.length === 0) {
    list.innerHTML = `<p class="hint">No Act/Scene headings were found in this script — lines won't be grouped into scenes.</p>`;
    return;
  }

  let lastShownAct;
  let shownAny = false;

  scriptState.sceneGroups.forEach((g, i) => {
    if (g.dropBoundary) return; // merged into an earlier scene — no row of its own

    if (!shownAny || g.act !== lastShownAct) {
      lastShownAct = g.act;
      shownAny = true;
      const header = document.createElement("div");
      header.className = "scene-act-header";
      header.textContent = g.act || "Before any Act heading";
      list.appendChild(header);
    }

    const row = document.createElement("div");
    row.className = "scenecard";

    const input = document.createElement("input");
    input.className = "scenename";
    input.value = g.label != null ? g.label : g.defaultLabel;
    input.setAttribute("aria-label", "Scene label");
    input.addEventListener("input", () => (g.label = input.value));

    const count = document.createElement("span");
    count.className = "linecount";
    count.textContent = `${g.lineCount} line${g.lineCount === 1 ? "" : "s"}`;

    row.appendChild(input);
    row.appendChild(count);

    if (i > 0) {
      const mergeBtn = document.createElement("button");
      mergeBtn.className = "btn ghost";
      mergeBtn.textContent = "Merge into previous scene";
      mergeBtn.addEventListener("click", () => {
        g.dropBoundary = true;
        renderSceneReview();
      });
      row.appendChild(mergeBtn);
    }

    list.appendChild(row);
  });
}

$("backToUploadFromReview").addEventListener("click", () => {
  showScreen("upload-script");
  setStage("Upload a script");
});

let currentParts = [];

$("saveScriptBtn").addEventListener("click", async () => {
  const errEl = $("reviewScriptErr");
  clearError(errEl);

  if (scriptState.characters.length === 0) {
    showError(errEl, "Add at least one character before saving.");
    return;
  }

  const characterNames = scriptState.characters.map((c) => c.name);
  const nameByRawLabel = new Map(scriptState.characters.map((c) => [c.rawLabel, c.name]));

  // Work out each detected scene's FINAL act/scene/sceneSeq after applying
  // any edits and merges from the review screen: a merged scene simply
  // inherits whatever the nearest surviving scene before it resolved to
  // (chaining correctly even if several scenes in a row were merged
  // together), and surviving scenes get fresh, contiguous scene numbers in
  // their original order.
  const effectiveBySeq = new Map();
  let effective = null;
  let nextSceneSeq = 0;
  for (const g of scriptState.sceneGroups) {
    if (g.dropBoundary) {
      effectiveBySeq.set(g.sceneSeq, effective);
    } else {
      effective = { act: g.act, scene: g.label != null ? g.label : g.defaultLabel, sceneSeq: nextSceneSeq++ };
      effectiveBySeq.set(g.sceneSeq, effective);
    }
  }

  const lines = scriptState.sequence.map((item, i) => {
    const eff = item.sceneSeq != null ? effectiveBySeq.get(item.sceneSeq) : null;
    return {
      seq_index: i,
      type: item.type,
      character_name: item.type === "line" ? (nameByRawLabel.get(item.rawLabel) || item.rawLabel) : null,
      text: item.text || "",
      act_label: eff ? eff.act : null,
      scene_label: eff ? eff.scene : null,
      scene_seq: eff ? eff.sceneSeq : null,
    };
  });

  $("saveScriptBtn").disabled = true;
  const { data, error } = await sb.rpc("save_script", {
    target_show_id: currentShow.id,
    script_file_name: scriptState.fileName,
    character_names: characterNames,
    lines,
  });
  $("saveScriptBtn").disabled = false;

  if (error) {
    showError(errEl, error);
    return;
  }

  currentParts = data || [];
  renderPartsList();
  showScreen("assign-parts");
  setStage("Assign parts");
});

// ---- Assigning parts (admin) ----

async function openAssignParts() {
  const errEl = $("partsErr");
  clearError(errEl);

  const { data, error } = await sb
    .from("parts")
    .select("*")
    .eq("show_id", currentShow.id)
    .order("character_name");

  if (error) {
    showError(errEl, error);
    return;
  }

  currentParts = data || [];
  renderPartsList();
  showScreen("assign-parts");
  setStage("Assign parts");
}

function renderPartsList() {
  const list = $("partsList");
  list.innerHTML = "";

  for (const part of currentParts) {
    const card = document.createElement("div");
    card.className = "partcard";

    const nameEl = document.createElement("div");
    nameEl.className = "gname";
    nameEl.textContent = part.character_name;
    card.appendChild(nameEl);

    if (part.claimed_by) {
      const status = document.createElement("p");
      status.className = "hint";
      status.textContent = "Claimed — this part has been picked up.";
      card.appendChild(status);

      const unassignBtn = document.createElement("button");
      unassignBtn.className = "btn ghost";
      unassignBtn.textContent = "Unassign (free this part)";
      unassignBtn.addEventListener("click", () => unassignPart(part.id));
      card.appendChild(unassignBtn);
    } else {
      const link = `${window.location.origin}${window.location.pathname}?code=${part.invite_code}`;

      const status = document.createElement("p");
      status.className = "hint";
      status.textContent = "Not yet claimed — send this link:";
      card.appendChild(status);

      const codeRow = document.createElement("p");
      codeRow.className = "code";
      codeRow.textContent = link;
      card.appendChild(codeRow);

      const btnRow = document.createElement("div");
      btnRow.className = "row-buttons";

      const copyBtn = document.createElement("button");
      copyBtn.className = "btn ghost";
      copyBtn.textContent = "Copy link";
      copyBtn.addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(link);
          copyBtn.textContent = "Copied!";
          setTimeout(() => (copyBtn.textContent = "Copy link"), 1500);
        } catch {
          showError($("partsErr"), "Couldn't copy automatically — select and copy the link above.");
        }
      });

      // These open the admin's OWN phone's messaging/email app, pre-filled —
      // nothing is sent by this app, and no phone number or email address
      // typed in gets stored anywhere in our database.
      const message = `You're playing ${part.character_name}! Join here: ${link}`;
      const textBtn = document.createElement("a");
      textBtn.className = "btn ghost";
      textBtn.textContent = "Text it";
      textBtn.href = "sms:?&body=" + encodeURIComponent(message);

      const emailBtn = document.createElement("a");
      emailBtn.className = "btn ghost";
      emailBtn.textContent = "Email it";
      emailBtn.href =
        "mailto:?subject=" + encodeURIComponent(`You're playing ${part.character_name}`) +
        "&body=" + encodeURIComponent(message);

      btnRow.appendChild(copyBtn);
      btnRow.appendChild(textBtn);
      btnRow.appendChild(emailBtn);
      card.appendChild(btnRow);

      // Lets the director play a part in their own show — either because
      // that's genuinely how this production is cast, or just to try out
      // the cast-member side of the app without signing in as someone
      // else. Uses the exact same claim path an actor's link would.
      const claimSelfBtn = document.createElement("button");
      claimSelfBtn.className = "btn ghost";
      claimSelfBtn.textContent = "Claim this for yourself";
      claimSelfBtn.addEventListener("click", () => claimPartForSelf(part));
      card.appendChild(claimSelfBtn);
    }

    list.appendChild(card);
  }
}

async function claimPartForSelf(part) {
  const errEl = $("partsErr");
  clearError(errEl);

  const { error } = await sb.rpc("claim_part_by_code", { code: part.invite_code });
  if (error) {
    showError(errEl, error);
    return;
  }

  await openAssignParts();
}

async function unassignPart(partId) {
  const errEl = $("partsErr");
  clearError(errEl);

  const { data, error } = await sb.rpc("unassign_part", { part_id: partId });
  if (error) {
    showError(errEl, error);
    return;
  }

  currentParts = currentParts.map((p) => (p.id === data.id ? data : p));
  renderPartsList();
}

$("backToShowFromParts").addEventListener("click", () => {
  // Re-run openShow rather than just switching screens back — a script may
  // have just been uploaded for the first time, which needs to flip the
  // show screen from "Upload script" over to "Manage script & cast".
  openShow(currentShow, showBackTarget);
});

// ---- Shared between Reading mode and Practice mode: grouping a script's
// lines into scenes, and rendering a scene-picker list from that ----

// Collapses an ordered array of script_lines rows into one entry per
// distinct scene (in document order), counting how many of those lines
// belong to `myCharName` (if given) — used both for "Read the script" and
// for the "Practice my lines" scene browser, since both need the same
// Act/Scene breakdown of a script. Lines saved before schema v7 (or before
// any Act heading) have a null scene_seq and are left out of scene
// browsing entirely — there is nothing meaningful to group them under.
function groupSceneRows(lines, myCharName) {
  const groups = [];
  let current = null;
  for (const line of lines) {
    if (line.scene_seq == null) continue;
    if (!current || current.sceneSeq !== line.scene_seq) {
      current = {
        sceneSeq: line.scene_seq, act: line.act_label, scene: line.scene_label,
        totalLineCount: 0, myLineCount: 0,
      };
      groups.push(current);
    }
    if (line.line_type === "line") {
      current.totalLineCount++;
      if (myCharName && line.character_name === myCharName) current.myLineCount++;
    }
  }
  return groups;
}

// Renders a scene-picker into `container`: one button per scene, grouped
// under bold Act headers whenever the act changes.
function renderSceneListInto(container, groups, myCharName, onClickScene) {
  container.innerHTML = "";

  if (groups.length === 0) {
    container.innerHTML = `<p class="hint">No script has been uploaded for this show yet.</p>`;
    return;
  }

  let lastAct;
  let shownAny = false;
  for (const g of groups) {
    if (!shownAny || g.act !== lastAct) {
      lastAct = g.act;
      shownAny = true;
      const header = document.createElement("div");
      header.className = "scene-act-header";
      header.textContent = g.act || "Before any Act heading";
      container.appendChild(header);
    }

    const btn = document.createElement("button");
    btn.className = "groupbtn";
    const sceneName = g.scene || "Scene";
    const mineText = myCharName ? ` · ${g.myLineCount} of your line${g.myLineCount === 1 ? "" : "s"}` : "";
    btn.innerHTML =
      `<span class="gname">${escapeHtml(sceneName)}</span>` +
      `<span class="hint">${g.totalLineCount} line${g.totalLineCount === 1 ? "" : "s"}${mineText}</span>`;
    btn.addEventListener("click", () => onClickScene(g.sceneSeq));
    container.appendChild(btn);
  }
}

// Fetches the current script's lines for this show, in order. Shared by
// Reading mode and Practice mode, since both start from the exact same data.
async function fetchScriptLines() {
  const { data: scriptRows, error: scriptErr } = await sb
    .from("scripts")
    .select("id")
    .eq("show_id", currentShow.id);

  if (scriptErr) return { lines: null, error: scriptErr };
  if (!scriptRows || scriptRows.length === 0) return { lines: [], error: null };

  const { data: lineRows, error: linesErr } = await sb
    .from("script_lines")
    .select("*")
    .eq("script_id", scriptRows[0].id)
    .order("seq_index");

  if (linesErr) return { lines: null, error: linesErr };
  return { lines: lineRows || [], error: null };
}

// ---- Read the script (full text, organized by Act/Scene, anyone with
// access to the show's script — admin or cast) ----

let readState = { lines: [], sceneGroups: [], currentSceneSeq: null, myCharName: null };

async function openReadScript() {
  const errEl = $("readScriptErr");
  clearError(errEl);
  readState.myCharName = currentMyPart ? currentMyPart.character_name : null;

  const { lines, error } = await fetchScriptLines();
  if (error) {
    showError(errEl, error);
    readState.lines = [];
    readState.sceneGroups = [];
  } else {
    readState.lines = lines;
    readState.sceneGroups = groupSceneRows(lines, readState.myCharName);
  }

  renderSceneListInto($("readSceneList"), readState.sceneGroups, readState.myCharName, (sceneSeq) => openReadScene(sceneSeq));
  showScreen("read-script");
  setStage("Read the script");
}

function openReadScene(sceneSeq) {
  readState.currentSceneSeq = sceneSeq;
  renderReadScene();
  showScreen("read-scene");
}

function renderReadScene() {
  const seq = readState.currentSceneSeq;
  const group = readState.sceneGroups.find((g) => g.sceneSeq === seq);
  $("readSceneHeading").textContent = group ? [group.act, group.scene].filter(Boolean).join(" — ") : "Scene";

  const container = $("readSceneContent");
  container.innerHTML = "";
  const linesInScene = readState.lines.filter((l) => l.scene_seq === seq);

  for (const line of linesInScene) {
    if (line.line_type === "unassigned") continue;

    const el = document.createElement("p");
    if (line.line_type === "heading") {
      el.className = "read-heading";
      el.textContent = line.line_text;
    } else if (line.line_type === "direction") {
      el.className = "read-direction";
      el.textContent = line.line_text;
    } else {
      const isMine = readState.myCharName && line.character_name === readState.myCharName;
      el.className = "read-line" + (isMine ? " read-line-mine" : "");
      el.innerHTML = `<span class="cue-name">${escapeHtml(line.character_name || "")}:</span> ${escapeHtml(line.line_text)}`;
    }
    container.appendChild(el);
  }

  const idx = readState.sceneGroups.findIndex((g) => g.sceneSeq === seq);
  $("readPrevSceneBtn").disabled = idx <= 0;
  $("readNextSceneBtn").disabled = idx < 0 || idx >= readState.sceneGroups.length - 1;
}

$("readPrevSceneBtn").addEventListener("click", () => {
  const idx = readState.sceneGroups.findIndex((g) => g.sceneSeq === readState.currentSceneSeq);
  if (idx > 0) openReadScene(readState.sceneGroups[idx - 1].sceneSeq);
});
$("readNextSceneBtn").addEventListener("click", () => {
  const idx = readState.sceneGroups.findIndex((g) => g.sceneSeq === readState.currentSceneSeq);
  if (idx >= 0 && idx < readState.sceneGroups.length - 1) openReadScene(readState.sceneGroups[idx + 1].sceneSeq);
});
$("backToReadListFromScene").addEventListener("click", () => {
  showScreen("read-script");
  setStage("Read the script");
});
$("backToShowFromReadScript").addEventListener("click", () => {
  openShow(currentShow, showBackTarget);
});

// ---- Practice my lines (a cast member's own lines, scene by scene, with
// cue-line context) ----

let myPartState = { part: null, lines: [], lookback: 1, sceneGroups: [], currentSceneSeq: null };

// Whether every one of the current character's lines in the scene being
// practiced is shown in full rather than hidden behind a hint. This is a
// per-visit convenience, not a saved setting: it resets to off each time
// "Practice my lines" is opened fresh, but — per Andy's request — stays on
// as you move from scene to scene within that same visit.
let practiceRevealAll = false;

async function openMyPart(part) {
  const errEl = $("myPartErr");
  clearError(errEl);
  myPartState.part = part;
  $("myPartCharName").textContent = part.character_name;
  practiceRevealAll = false;

  // This person's own saved lead-in preference for this show — remembered
  // per person, per show, not per device, so it follows them if they open
  // the app somewhere else.
  const { data: memberRow } = await sb
    .from("show_members")
    .select("cue_lookback_lines")
    .eq("show_id", currentShow.id)
    .eq("user_id", currentUserId)
    .single();
  myPartState.lookback = (memberRow && memberRow.cue_lookback_lines) || 1;

  const { lines, error } = await fetchScriptLines();
  if (error) {
    showError(errEl, error);
    myPartState.lines = [];
    myPartState.sceneGroups = [];
  } else {
    myPartState.lines = lines;
    myPartState.sceneGroups = groupSceneRows(lines, part.character_name);
  }

  renderMyPartSceneBrowser();
  showScreen("my-part");
  setStage(`Practice: ${part.character_name}`);
}

function renderMyPartSceneBrowser() {
  $("lookback1Btn").classList.toggle("active", myPartState.lookback === 1);
  $("lookback2Btn").classList.toggle("active", myPartState.lookback === 2);
  renderSceneListInto(
    $("myPartSceneList"), myPartState.sceneGroups, myPartState.part.character_name,
    (sceneSeq) => openPracticeScene(sceneSeq)
  );
}

function openPracticeScene(sceneSeq) {
  myPartState.currentSceneSeq = sceneSeq;
  renderPracticeScene();
  showScreen("practice-scene");
}

function renderPracticeScene() {
  const seq = myPartState.currentSceneSeq;
  const group = myPartState.sceneGroups.find((g) => g.sceneSeq === seq);
  $("practiceSceneHeading").textContent = group ? [group.act, group.scene].filter(Boolean).join(" — ") : "Scene";
  $("revealAllBtn").textContent = practiceRevealAll ? "Hide all" : "Reveal all";
  $("revealAllBtn").classList.toggle("active", practiceRevealAll);

  const sceneLines = myPartState.lines.filter((l) => l.scene_seq === seq);
  renderMyPart(sceneLines);

  const idx = myPartState.sceneGroups.findIndex((g) => g.sceneSeq === seq);
  $("practicePrevSceneBtn").disabled = idx <= 0;
  $("practiceNextSceneBtn").disabled = idx < 0 || idx >= myPartState.sceneGroups.length - 1;
}

function renderMyPart(lines) {
  const list = $("myPartList");
  list.innerHTML = "";

  const charName = myPartState.part.character_name;

  lines.forEach((line, i) => {
    if (line.line_type !== "line" || line.character_name !== charName) return;

    // Walk backwards for the last N actual spoken lines (skipping headings
    // and stage directions, whoever said them) as this line's "cue" —
    // scoped to just this scene, since `lines` here is already filtered to
    // one scene's worth.
    const cues = [];
    for (let j = i - 1; j >= 0 && cues.length < myPartState.lookback; j--) {
      if (lines[j].line_type === "line") cues.unshift(lines[j]);
    }

    const item = document.createElement("div");
    item.className = "mypart-item";

    for (const cue of cues) {
      const cueEl = document.createElement("p");
      cueEl.className = "cue-line";
      cueEl.innerHTML = `<span class="cue-name">${escapeHtml(cue.character_name || "")}:</span> ${escapeHtml(cue.line_text)}`;
      item.appendChild(cueEl);
    }

    // The actor's own line starts hidden behind a short hint — tapping it
    // reveals the full line, the same "cover it with your hand" habit as
    // rehearsing with a paper script. "Reveal all" simply skips the hint
    // and shows every line in this scene already open.
    const words = line.line_text.split(/\s+/).filter(Boolean);
    const hint = words.slice(0, 5).join(" ") + (words.length > 5 ? "…" : "");

    const mine = document.createElement("p");
    mine.className = "my-line" + (practiceRevealAll ? " revealed" : "");
    mine.innerHTML = `<span class="cue-name">${escapeHtml(charName)}:</span> <span class="line-text">${escapeHtml(practiceRevealAll ? line.line_text : hint)}</span>`;
    mine.dataset.revealed = practiceRevealAll ? "true" : "false";

    if (!practiceRevealAll) {
      mine.addEventListener("click", () => {
        const revealed = mine.dataset.revealed === "true";
        mine.dataset.revealed = revealed ? "false" : "true";
        mine.querySelector(".line-text").textContent = revealed ? hint : line.line_text;
        mine.classList.toggle("revealed", !revealed);
      });
    }

    item.appendChild(mine);
    list.appendChild(item);
  });

  if (list.children.length === 0) {
    list.innerHTML = `<p class="hint">No lines for ${escapeHtml(charName)} in this scene.</p>`;
  }
}

async function setLookback(lines) {
  const errEl = $("myPartErr");
  clearError(errEl);

  const { error } = await sb.rpc("set_cue_lookback", {
    target_show_id: currentShow.id,
    lines,
  });
  if (error) {
    showError(errEl, error);
    return;
  }

  myPartState.lookback = lines;
  renderMyPartSceneBrowser();
}

$("lookback1Btn").addEventListener("click", () => setLookback(1));
$("lookback2Btn").addEventListener("click", () => setLookback(2));

$("revealAllBtn").addEventListener("click", () => {
  practiceRevealAll = !practiceRevealAll;
  renderPracticeScene();
});

$("practicePrevSceneBtn").addEventListener("click", () => {
  const idx = myPartState.sceneGroups.findIndex((g) => g.sceneSeq === myPartState.currentSceneSeq);
  if (idx > 0) openPracticeScene(myPartState.sceneGroups[idx - 1].sceneSeq);
});
$("practiceNextSceneBtn").addEventListener("click", () => {
  const idx = myPartState.sceneGroups.findIndex((g) => g.sceneSeq === myPartState.currentSceneSeq);
  if (idx >= 0 && idx < myPartState.sceneGroups.length - 1) openPracticeScene(myPartState.sceneGroups[idx + 1].sceneSeq);
});
$("backToScenesFromPractice").addEventListener("click", () => {
  showScreen("my-part");
  setStage(`Practice: ${myPartState.part.character_name}`);
});

$("backToShowFromMyPart").addEventListener("click", () => {
  openShow(currentShow, showBackTarget);
});

// ---- Boot: figure out if we're already signed in ----

async function boot() {
  setStage("Loading…");
  const { data: { session } } = await sb.auth.getSession();

  if (session) {
    currentUserId = session.user.id;
    await enterSignedIn();
  } else {
    showScreen("signin");
    setStage("Sign in");
  }
}

async function enterSignedIn() {
  showScreen("your-shows");
  setStage("Your shows");
  await loadShows();

  // If we arrived here via a personal part link (or one that survived a
  // sign-in round trip via emailRedirectTo), use it now, once, then forget
  // it — this is what lets a director's link do "sign in, join, and get
  // your part" as a single action for the person opening it.
  if (pendingCode) {
    const code = pendingCode;
    pendingCode = null;
    clearCodeFromUrl();
    await attemptClaimOrJoin(code);
  }
}

sb.auth.onAuthStateChange((event, session) => {
  if (event === "SIGNED_IN" && session) {
    currentUserId = session.user.id;
    // Clean the magic-link tokens out of the address bar once used.
    window.history.replaceState({}, document.title, window.location.pathname);
    enterSignedIn();
  }
});

boot();
