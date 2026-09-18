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

  if (isAdmin) {
    $("showInviteCode").textContent = show.invite_code;
    const { data: scriptRows } = await sb.from("scripts").select("id").eq("show_id", show.id);
    const hasScript = !!(scriptRows && scriptRows.length > 0);
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

let scriptState = { characters: [], sequence: [], skippedCount: 0, fileName: "" };
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
  const { sequence, characters } = ScriptParser.parseScript(pages);

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

  if (scriptState.characters.length === 0) {
    throw new Error("couldn't find any character names — is this a play script?");
  }

  renderScriptReview();
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
  const lines = scriptState.sequence.map((item, i) => ({
    seq_index: i,
    type: item.type,
    character_name: item.type === "line" ? (nameByRawLabel.get(item.rawLabel) || item.rawLabel) : null,
    text: item.text || "",
  }));

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

// ---- My Part (a cast member's own lines, with cue-line context) ----

let myPartState = { part: null, lines: [], lookback: 1 };

async function openMyPart(part) {
  const errEl = $("myPartErr");
  clearError(errEl);
  myPartState.part = part;
  $("myPartCharName").textContent = part.character_name;

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

  const { data: scriptRows, error: scriptErr } = await sb
    .from("scripts")
    .select("id")
    .eq("show_id", currentShow.id);

  if (scriptErr) {
    showError(errEl, scriptErr);
    myPartState.lines = [];
  } else if (!scriptRows || scriptRows.length === 0) {
    myPartState.lines = [];
  } else {
    const { data: lineRows, error: linesErr } = await sb
      .from("script_lines")
      .select("*")
      .eq("script_id", scriptRows[0].id)
      .order("seq_index");
    if (linesErr) {
      showError(errEl, linesErr);
      myPartState.lines = [];
    } else {
      myPartState.lines = lineRows || [];
    }
  }

  renderMyPart();
  showScreen("my-part");
  setStage(`My part: ${part.character_name}`);
}

function renderMyPart() {
  $("lookback1Btn").classList.toggle("active", myPartState.lookback === 1);
  $("lookback2Btn").classList.toggle("active", myPartState.lookback === 2);

  const list = $("myPartList");
  list.innerHTML = "";

  const lines = myPartState.lines;
  const charName = myPartState.part.character_name;

  lines.forEach((line, i) => {
    if (line.line_type !== "line" || line.character_name !== charName) return;

    // Walk backwards for the last N actual spoken lines (skipping headings
    // and stage directions, whoever said them) as this line's "cue".
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
    // rehearsing with a paper script.
    const words = line.line_text.split(/\s+/).filter(Boolean);
    const hint = words.slice(0, 5).join(" ") + (words.length > 5 ? "…" : "");

    const mine = document.createElement("p");
    mine.className = "my-line";
    mine.innerHTML = `<span class="cue-name">${escapeHtml(charName)}:</span> <span class="line-text">${escapeHtml(hint)}</span>`;
    mine.dataset.revealed = "false";
    mine.addEventListener("click", () => {
      const revealed = mine.dataset.revealed === "true";
      mine.dataset.revealed = revealed ? "false" : "true";
      mine.querySelector(".line-text").textContent = revealed ? hint : line.line_text;
      mine.classList.toggle("revealed", !revealed);
    });

    item.appendChild(mine);
    list.appendChild(item);
  });

  if (list.children.length === 0) {
    list.innerHTML = `<p class="hint">No lines found for ${escapeHtml(charName)} yet — check back once a script has been uploaded.</p>`;
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
  renderMyPart();
}

$("lookback1Btn").addEventListener("click", () => setLookback(1));
$("lookback2Btn").addEventListener("click", () => setLookback(2));

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
