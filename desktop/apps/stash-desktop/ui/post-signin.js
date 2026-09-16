/* Authenticated library view. All data and actions cross the Rust IPC boundary. */
(function () {
  const screen = document.querySelector("#browser-screen");
  if (!screen) return;
  const invoke = window.__TAURI__?.core?.invoke;
  const list = document.querySelector("#file-list");
  const status = document.querySelector("#browser-status");
  const breadcrumb = document.querySelector("#breadcrumb");
  const usage = document.querySelector("#usage");
  const details = document.querySelector("#selection-details");
  const mountStatus = document.querySelector("#mount-status");
  const mountAction = document.querySelector("#mount-action");
  let parentId = "ROOT";
  let path = [];
  let items = [];
  let sortBy = "name";

  const setStatus = (message, tone) => { status.textContent = message; if (tone) status.dataset.tone = tone; else delete status.dataset.tone; };
  const formatBytes = (n) => { if (!Number.isFinite(n)) return "—"; if (n < 1024) return `${n} B`; const units = ["KB", "MB", "GB", "TB"]; let i = -1; do { n /= 1024; i += 1; } while (n >= 1024 && i < units.length - 1); return `${n.toFixed(n >= 10 ? 0 : 1)} ${units[i]}`; };
  function renderBreadcrumb() {
    breadcrumb.replaceChildren();
    const root = document.createElement("button"); root.type = "button"; root.textContent = "STASH"; root.addEventListener("click", () => openFolder("ROOT", [])); breadcrumb.append(root);
    path.forEach((folder, index) => { const separator = document.createTextNode(" / "); breadcrumb.append(separator); const button = document.createElement("button"); button.type = "button"; button.textContent = folder.name; button.addEventListener("click", () => openFolder(folder.id, path.slice(0, index + 1))); breadcrumb.append(button); });
  }
  function renderRows() {
    list.replaceChildren();
    [...items].sort((a, b) => { const av = sortBy === "size" ? (a.sizeBytes || 0) : String(a[sortBy] || a.name); const bv = sortBy === "size" ? (b.sizeBytes || 0) : String(b[sortBy] || b.name); return av < bv ? -1 : av > bv ? 1 : 0; }).forEach((item) => {
      const row = document.createElement("tr"); row.dataset.entity = item.entity || item.kind || ""; row.tabIndex = 0;
      const name = document.createElement("td"); name.textContent = `${item.entity === "FOLDER" || item.kind === "Folder" ? "▸ " : ""}${item.name}`;
      const kind = document.createElement("td"); kind.textContent = item.entity === "FOLDER" || item.kind === "Folder" ? "Folder" : "File";
      const size = document.createElement("td"); size.textContent = item.entity === "FOLDER" || item.kind === "Folder" ? "—" : formatBytes(item.sizeBytes);
      row.append(name, kind, size); const select = () => { list.querySelectorAll(".is-selected").forEach((r) => r.classList.remove("is-selected")); row.classList.add("is-selected"); details.textContent = kind.textContent === "Folder" ? `${item.name} — folder` : `${item.name} — ${formatBytes(item.sizeBytes)}`; };
      row.addEventListener("click", () => { select(); if (kind.textContent === "Folder") openFolder(item.folderId || item.id, [...path, { id: item.folderId || item.id, name: item.name }]); }); row.addEventListener("keydown", (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); row.click(); } }); list.append(row);
    });
  }
  async function loadChildren() {
    if (!invoke) { setStatus("Library connection is unavailable in this build.", "error"); return; }
    setStatus("Loading your STASH…"); list.replaceChildren();
    try { const result = await invoke("list_children", { folderId: parentId }); items = Array.isArray(result?.items) ? result.items : []; renderRows(); setStatus(items.length ? "" : "This folder is empty."); } catch (_) { setStatus("We couldn't load this folder. Try again.", "error"); }
  }
  async function loadUsage() { if (!invoke) return; try { const result = await invoke("get_usage"); usage.textContent = result?.provisioned === false ? "Storage not provisioned" : `${formatBytes(result?.usedBytes)} of ${formatBytes(result?.quotaBytes)}`; } catch (_) { usage.textContent = "Storage unavailable"; } }
  function applyMountStatus(result) { const letter = result?.letter || result?.driveLetter; const mounted = Boolean(result?.mounted && letter); mountStatus.textContent = mounted ? `STASH (${letter}:)` : "Not mounted"; mountAction.textContent = mounted ? "Unmount STASH" : "Mount STASH"; mountAction.dataset.mounted = mounted ? "true" : "false"; mountAction.disabled = false; }
  async function loadMount() { if (!invoke) return; try { applyMountStatus(await invoke("mount_status")); } catch (_) { mountStatus.textContent = "Drive unavailable"; mountAction.textContent = "Mount STASH"; mountAction.disabled = true; } }
  async function toggleMount() { if (!invoke) return; const mounted = mountAction.dataset.mounted === "true"; mountAction.disabled = true; mountAction.textContent = mounted ? "Unmounting…" : "Mounting…"; try { const result = await invoke(mounted ? "unmount_stash" : "mount_stash"); applyMountStatus(result); setStatus(mounted ? "STASH was unmounted. Your files and cache were kept." : "STASH is mounted."); } catch (_) { mountAction.disabled = false; mountAction.textContent = mounted ? "Unmount STASH" : "Mount STASH"; setStatus(mounted ? "We couldn't unmount STASH. Try again." : "We couldn't mount STASH. Try again.", "error"); } }
  function openFolder(id, nextPath) { parentId = id; path = nextPath; renderBreadcrumb(); loadChildren(); }
  document.querySelectorAll("[data-sort]").forEach((button) => button.addEventListener("click", () => { sortBy = button.dataset.sort; renderRows(); }));
  mountAction?.addEventListener("click", toggleMount);
  window.STASHBrowser = { show() { screen.hidden = false; renderBreadcrumb(); loadChildren(); loadUsage(); loadMount(); }, openFolder };
  window.addEventListener?.("stash:signed-in", () => window.STASHBrowser.show());
})();
