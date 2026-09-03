(function () {
  "use strict";

  // Running without a separate worker thread trades a little speed for a lot
  // of reliability: some hosting setups block a library from spinning up a
  // background worker from a third-party script, and this prototype would
  // rather be slightly slower than silently fail to read a script.
  const $ = (id) => document.getElementById(id);

  const screens = {
    upload: $("screen-upload"),
    processing: $("screen-processing"),
    review: $("screen-review"),
    pick: $("screen-pick"),
    ready: $("screen-ready"),
  };
  const stageLabels = {
    upload: "Upload a script",
    processing: "Reading…",
    review: "Check the cast list",
    pick: "Pick your part",
    ready: "Ready to rehearse",
  };

  function showScreen(name) {
    Object.entries(screens).forEach(([k, el]) => (el.hidden = k !== name));
    $("stageLabel").textContent = stageLabels[name];
  }

  // ---- state ----------------------------------------------------------
  let nextId = 1;
  let state = { characters: [], sequence: [], skippedCount: 0, fileName: "" };

  // ---- screen 1: upload -------------------------------------------------
  const fileInput = $("fileInput");
  const dropzone = $("dropzone");
  const certifyBox = $("certifyBox");
  const startBtn = $("startBtn");
  const dzText = $("dzText");
  let chosenFile = null;

  function refreshStartBtn() {
    startBtn.disabled = !(chosenFile && certifyBox.checked);
  }

  fileInput.addEventListener("change", () => {
    chosenFile = fileInput.files[0] || null;
    dzText.textContent = chosenFile ? chosenFile.name : "Tap to choose a PDF, or drop one here";
    refreshStartBtn();
  });

  ["dragover", "dragenter"].forEach((evt) =>
    dropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      dropzone.classList.add("drag");
    })
  );
  ["dragleave", "drop"].forEach((evt) =>
    dropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      dropzone.classList.remove("drag");
    })
  );
  dropzone.addEventListener("drop", (e) => {
    const f = e.dataTransfer.files[0];
    if (f) {
      chosenFile = f;
      dzText.textContent = f.name;
      refreshStartBtn();
    }
  });

  certifyBox.addEventListener("change", refreshStartBtn);

  startBtn.addEventListener("click", async () => {
    $("uploadErr").hidden = true;
    showScreen("processing");
    try {
      await runPipeline(chosenFile);
    } catch (err) {
      console.error(err);
      showScreen("upload");
      $("uploadErr").hidden = false;
      $("uploadErr").textContent =
        "Something went wrong reading that PDF (" + (err && err.message ? err.message : "unknown error") + "). Try a different file, or let Andy know what happened.";
    }
  });

  // ---- pdf -> text items ------------------------------------------------
  async function extractPages(file) {
    const buf = await file.arrayBuffer();
    const doc = await pdfjsLib.getDocument({ data: buf, disableWorker: true }).promise;
    const pages = [];
    for (let p = 1; p <= doc.numPages; p++) {
      $("processingMsg").textContent = `Reading page ${p} of ${doc.numPages}…`;
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      pages.push(
        content.items.map((it) => ({
          str: it.str,
          x: it.transform[4],
          y: it.transform[5],
        }))
      );
    }
    return pages;
  }

  async function runPipeline(file) {
    state.fileName = file.name;
    const pages = await extractPages(file);
    $("processingMsg").textContent = "Working out who says what…";
    await new Promise((r) => setTimeout(r, 30)); // let the UI paint
    const { sequence, characters } = ScriptParser.parseScript(pages);

    state.sequence = sequence;
    state.skippedCount = sequence.filter((s) => s.type === "unassigned").length;
    state.characters = characters.map((c) => ({
      id: nextId++,
      name: c.name,
      count: c.count,
    }));

    if (state.characters.length === 0) {
      throw new Error("couldn't find any character names — is this a play script?");
    }

    renderReview();
    showScreen("review");
  }

  // ---- screen 3: review ---------------------------------------------------
  function renderReview() {
    const totalLines = state.characters.reduce((s, c) => s + c.count, 0);
    $("reviewSummary").textContent =
      `Found ${state.characters.length} characters across ${totalLines} lines in "${state.fileName}". ` +
      `Fix any name that's wrong, or remove a row that shouldn't be there. If the script uses more than one name for the same person, don't worry about it here — you'll be able to select all of them as yours on the next screen.`;

    if (state.skippedCount > 0) {
      $("skippedNote").hidden = false;
      $("skippedNote").textContent =
        `${state.skippedCount} bits of text (scene dividers, or framing text like a prologue/epilogue) weren't attached to a character — that's expected and can be ignored.`;
    } else {
      $("skippedNote").hidden = true;
    }

    const list = $("charList");
    list.innerHTML = "";
    const sorted = [...state.characters].sort((a, b) => b.count - a.count);

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
      removeBtn.title = "Remove this row (its lines will be left out)";
      removeBtn.addEventListener("click", () => {
        state.characters = state.characters.filter((x) => x.id !== c.id);
        renderReview();
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

  $("backToUpload").addEventListener("click", () => {
    chosenFile = null;
    dzText.textContent = "Tap to choose a PDF, or drop one here";
    fileInput.value = "";
    refreshStartBtn();
    showScreen("upload");
  });

  $("confirmCast").addEventListener("click", () => {
    renderPickScreen();
    showScreen("pick");
  });

  // ---- screen 4: pick your part(s) ---------------------------------------
  let selectedIds = new Set();

  function renderPickScreen() {
    selectedIds = new Set();
    const list = $("partList");
    list.innerHTML = "";
    const sorted = [...state.characters].sort((a, b) => b.count - a.count);
    for (const c of sorted) {
      const btn = document.createElement("button");
      btn.className = "partbtn";
      btn.setAttribute("aria-pressed", "false");
      btn.innerHTML =
        `<span class="check" aria-hidden="true"></span>` +
        `${escapeHtml(c.name)}<span class="pcount">${c.count} line${c.count === 1 ? "" : "s"}</span>`;
      btn.addEventListener("click", () => {
        if (selectedIds.has(c.id)) selectedIds.delete(c.id);
        else selectedIds.add(c.id);
        btn.classList.toggle("selected", selectedIds.has(c.id));
        btn.setAttribute("aria-pressed", String(selectedIds.has(c.id)));
        $("confirmParts").disabled = selectedIds.size === 0;
      });
      list.appendChild(btn);
    }
    $("confirmParts").disabled = true;
  }

  $("confirmParts").addEventListener("click", () => {
    const chosen = state.characters.filter((c) => selectedIds.has(c.id));
    if (chosen.length === 0) return;
    renderReadyScreen(chosen);
    showScreen("ready");
  });

  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  // ---- screen 5: ready ----------------------------------------------------
  function renderReadyScreen(chosenCharacters) {
    const names = chosenCharacters.map((c) => c.name);
    $("readyName").textContent = names.join(", ");
    const yourLines = chosenCharacters.reduce((s, c) => s + c.count, 0);
    const totalLines = state.characters.reduce((s, c) => s + c.count, 0);
    $("readyStats").textContent =
      `script:            ${state.fileName}\n` +
      `your part(s):      ${names.join(", ")}\n` +
      `your lines:        ${yourLines}\n` +
      `total characters:  ${state.characters.length}\n` +
      `total spoken lines:${" "}${totalLines}`;
  }

  $("restart").addEventListener("click", () => {
    state = { characters: [], sequence: [], skippedCount: 0, fileName: "" };
    chosenFile = null;
    fileInput.value = "";
    certifyBox.checked = false;
    dzText.textContent = "Tap to choose a PDF, or drop one here";
    refreshStartBtn();
    showScreen("upload");
  });

  showScreen("upload");
})();
