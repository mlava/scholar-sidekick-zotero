// addon/chrome/content/dialog.js
//
// View script for the import-boundary verifier modal. Loaded via
// <script src="dialog.js"> in dialog.xhtml — kept external so Firefox's
// chrome-doc CSP doesn't block it (Zotero 9 enforces no-inline-script
// for plugin-served XHTML).
//
// All Zotero / DOM glue is in the controller passed via
// window.arguments[0] from src/ui/dialog.ts. This file only renders
// state and forwards events.

(function () {
  // Zotero 9 on macOS ignores width/height in openDialog features and
  // opens the window at the parent main pane's width (often >1500px).
  // Force the intended size + recenter on the active screen.
  try {
    const W = 820;
    const H = 620;
    window.resizeTo(W, H);
    const sw = window.screen.availWidth;
    const sh = window.screen.availHeight;
    window.moveTo(Math.max(0, Math.round((sw - W) / 2)), Math.max(0, Math.round((sh - H) / 2)));
  } catch (_err) {
    /* non-fatal — some sandboxed contexts disallow resize/move */
  }

  const args = window.arguments && window.arguments[0];
  const controller = args && args.wrappedJSObject ? args.wrappedJSObject : args;
  if (!controller) {
    document.getElementById("empty").textContent = "No controller — open via Tools menu.";
    return;
  }

  const $ = (id) => document.getElementById(id);
  const paste = $("paste");
  const pickBtn = $("pick-file");
  const verifyBtn = $("verify");
  const importBtn = $("import");
  const cancelBtn = $("cancel");
  const selectAll = $("select-all");
  const table = $("results-table");
  const tbody = $("results-body");
  const empty = $("empty");
  const progress = $("progress");
  const progressLabel = $("progress-label");
  const progressBar = $("progress-bar");
  const collectionBtn = $("collection-btn");
  const collectionLabel = $("collection-label");
  const collectionList = $("collection-list");
  const apiStatus = $("api-status");

  let rows = [];
  const selected = new Set();
  // Selected import target: "_unfiled" or a numeric collection id (as string).
  let selectedCollection = "_unfiled";

  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function setProgress(done, total) {
    if (!total) {
      progress.removeAttribute("data-active");
      return;
    }
    progress.setAttribute("data-active", "1");
    progressLabel.textContent = "Verifying " + done + " of " + total + "…";
    progressBar.style.width = Math.round((done / total) * 100) + "%";
  }

  function updateImportButton() {
    importBtn.disabled = selected.size === 0;
    importBtn.textContent = "Import " + selected.size + " selected";
  }

  function rowHtml(row) {
    const flags = [];
    if (row.retractionBanner) {
      const cls = row.retractionBanner.tone === "red" ? "retracted" : "concern";
      flags.push(
        '<span class="flag ' + cls + '">' + escapeHtml(row.retractionBanner.label) + "</span>",
      );
    }
    if (row.oaLink) {
      flags.push(
        '<span class="flag oa">OA · <a href="' +
          escapeHtml(row.oaLink.url) +
          '" target="_blank">' +
          escapeHtml(row.oaLink.label) +
          "</a></span>",
      );
    }
    const mismatchList =
      row.badge.kind === "mismatch" && row.badge.fields && row.badge.fields.length
        ? '<ul class="mismatch-list"><li>' +
          row.badge.fields.map(escapeHtml).join("</li><li>") +
          "</li></ul>"
        : "";
    const errorLine = row.errorMessage
      ? '<div class="mismatch-list">Error: ' + escapeHtml(row.errorMessage) + "</div>"
      : "";
    return (
      '<tr data-row-id="' +
      escapeHtml(row.rowId) +
      '">' +
      '<td><input type="checkbox" data-row-id="' +
      escapeHtml(row.rowId) +
      '"/></td>' +
      '<td><span class="badge ' +
      escapeHtml(row.badge.kind) +
      '">' +
      escapeHtml(row.badge.label) +
      "</span>" +
      (row.confidence ? '<div class="identifier">' + escapeHtml(row.confidence) + "</div>" : "") +
      "</td>" +
      '<td><div class="title">' +
      escapeHtml(row.title) +
      "</div>" +
      mismatchList +
      errorLine +
      (flags.length ? '<div class="flags">' + flags.join("") + "</div>" : "") +
      "</td>" +
      '<td><span class="identifier">' +
      escapeHtml(row.identifier || "—") +
      "</span></td>" +
      "</tr>"
    );
  }

  function renderRows(next) {
    rows = next || [];
    selected.clear();
    for (const r of rows) {
      if (
        r.badge.kind === "verified" ||
        r.badge.kind === "resolved" ||
        r.badge.kind === "ambiguous"
      ) {
        selected.add(r.rowId);
      }
    }
    if (!rows.length) {
      table.style.display = "none";
      empty.style.display = "";
      empty.textContent = "Nothing to verify — try a .bib file or paste at least one identifier.";
      updateImportButton();
      return;
    }
    empty.style.display = "none";
    table.style.display = "";
    tbody.innerHTML = rows.map(rowHtml).join("");
    for (const cb of tbody.querySelectorAll('input[type="checkbox"]')) {
      cb.checked = selected.has(cb.dataset.rowId);
      cb.addEventListener("change", () => {
        if (cb.checked) selected.add(cb.dataset.rowId);
        else selected.delete(cb.dataset.rowId);
        updateImportButton();
        selectAll.checked = selected.size === rows.length;
      });
    }
    selectAll.checked = selected.size === rows.length;
    updateImportButton();
  }

  selectAll.addEventListener("change", () => {
    if (selectAll.checked) for (const r of rows) selected.add(r.rowId);
    else selected.clear();
    for (const cb of tbody.querySelectorAll('input[type="checkbox"]')) {
      cb.checked = selectAll.checked;
    }
    updateImportButton();
  });

  pickBtn.addEventListener("click", async () => {
    try {
      const text = await controller.pickFile();
      if (text) paste.value = text;
    } catch (err) {
      empty.textContent = "Couldn't read file: " + (err && err.message ? err.message : String(err));
    }
  });

  verifyBtn.addEventListener("click", async () => {
    const raw = paste.value.trim();
    if (!raw) return;
    verifyBtn.disabled = true;
    importBtn.disabled = true;
    empty.style.display = "";
    empty.textContent = "Verifying…";
    table.style.display = "none";
    setProgress(0, 1);
    try {
      const { rows: result } = await controller.runVerify(raw, (done, total) =>
        setProgress(done, total),
      );
      renderRows(result);
    } catch (err) {
      empty.textContent =
        "Verification failed: " + (err && err.message ? err.message : String(err));
    } finally {
      setProgress(0, 0);
      verifyBtn.disabled = false;
    }
  });

  importBtn.addEventListener("click", async () => {
    if (!selected.size) return;
    importBtn.disabled = true;
    const ids = Array.from(selected);
    const collectionId = selectedCollection === "_unfiled" ? null : Number(selectedCollection);
    try {
      const result = await controller.importSelected(ids, collectionId);
      empty.style.display = "";
      empty.textContent =
        "Imported " +
        result.importedIds.length +
        (result.skipped.length ? " · skipped " + result.skipped.length : "") +
        ". You can close this window or verify another batch.";
      table.style.display = "none";
      paste.value = "";
      rows = [];
      selected.clear();
      updateImportButton();
    } catch (err) {
      empty.textContent = "Import failed: " + (err && err.message ? err.message : String(err));
      importBtn.disabled = false;
    }
  });

  cancelBtn.addEventListener("click", () => window.close());

  // ---- Custom collection combobox (opaque, in-dialog) -------------------
  function closeCombo() {
    collectionList.removeAttribute("data-open");
    collectionBtn.setAttribute("aria-expanded", "false");
  }
  function openCombo() {
    collectionList.setAttribute("data-open", "1");
    collectionBtn.setAttribute("aria-expanded", "true");
  }
  function chooseCollection(value, label) {
    selectedCollection = value;
    collectionLabel.textContent = label;
    for (const opt of collectionList.querySelectorAll(".combo-opt")) {
      opt.setAttribute("aria-selected", opt.dataset.value === value ? "1" : "0");
    }
    closeCombo();
  }
  function addComboOption(value, label, indent) {
    const opt = document.createElement("div");
    opt.className = "combo-opt";
    opt.setAttribute("role", "option");
    opt.dataset.value = value;
    opt.textContent = (indent ? "  ".repeat(indent) : "") + label;
    opt.addEventListener("click", () => chooseCollection(value, label));
    collectionList.appendChild(opt);
  }
  collectionBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (collectionList.getAttribute("data-open") === "1") closeCombo();
    else openCombo();
  });
  // Click anywhere else closes the list.
  window.addEventListener("click", () => closeCombo());
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeCombo();
  });

  (async function init() {
    try {
      const collections = await controller.getCollections();
      collectionList.innerHTML = "";
      addComboOption("_unfiled", "My Library (unfiled)", 0);
      for (const c of collections) addComboOption(String(c.id), c.label, c.depth || 0);
      chooseCollection("_unfiled", "My Library (unfiled)");
    } catch (_err) {
      // Non-fatal — the user can still import into the unfiled bucket.
    }
    try {
      const status = controller.getApiKeyStatus();
      apiStatus.textContent = status && status.hasKey ? "Authenticated tier" : "Anonymous tier";
    } catch (_err) {
      apiStatus.textContent = "";
    }
  })();
})();
