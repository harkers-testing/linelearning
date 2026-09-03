// Rehearsal Group — groups (theatres/companies, admin-only) containing
// shows (individual productions, what cast members actually join).
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
  const redirectTo = window.location.origin + window.location.pathname;
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

  const { data, error } = await sb
    .from("shows")
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

$("joinShowBtn").addEventListener("click", async () => {
  const code = $("joinCode").value.trim();
  const errEl = $("showsErr");
  clearError(errEl);

  if (!code) {
    showError(errEl, "Enter an invite code first.");
    return;
  }

  $("joinShowBtn").disabled = true;
  const { data, error } = await sb.rpc("join_show_by_code", { code });
  $("joinShowBtn").disabled = false;

  if (error) {
    showError(errEl, error);
    return;
  }

  $("joinCode").value = "";
  await loadShows();
  openShow(data, { type: "shows" });
});

$("goToYourGroups").addEventListener("click", () => {
  showScreen("your-groups");
  setStage("Your groups");
  loadGroups();
});

// ---- A single show ----

async function openShow(show, backTarget) {
  showBackTarget = backTarget;
  $("showName").textContent = show.name;
  $("showInviteCode").textContent = show.invite_code;

  const { count } = await sb
    .from("show_members")
    .select("*", { count: "exact", head: true })
    .eq("show_id", show.id);

  $("showStats").textContent = `${count ?? "?"} member${count === 1 ? "" : "s"}`;
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
    .from("shows")
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

// ---- Boot: figure out if we're already signed in ----

async function boot() {
  setStage("Loading…");
  const { data: { session } } = await sb.auth.getSession();

  if (session) {
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
}

sb.auth.onAuthStateChange((event, session) => {
  if (event === "SIGNED_IN" && session) {
    // Clean the magic-link tokens out of the address bar once used.
    window.history.replaceState({}, document.title, window.location.pathname);
    enterSignedIn();
  }
});

boot();
