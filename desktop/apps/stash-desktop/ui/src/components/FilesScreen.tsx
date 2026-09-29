import { useEffect, useMemo, useState, type FormEvent } from "react";
import type { CapabilityState, ChildItem, FolderLocation, MountStatus, SortDirection, SortKey, Usage } from "../domain/types";
import { canGoBack, canGoForward, currentPlace, goBack, goForward, startHistory, visit, type History } from "../domain/history";
import type { DesktopGateway } from "../platform/contracts";
import { safeActionError } from "../platform/tauri/gateway";
import { AssetDetailsScreen } from "./AssetDetailsScreen";
import { Breadcrumb, LocationBar, StateTag, type HistoryNav } from "./ui";

/** Where Files is: a folder, and the file open in Asset details (if any). */
type FilesPlace = { path: FolderLocation[]; preview: ChildItem | null };

/** Finds folders by name from the top of STASH (Search knows paths, not ids). Stops at the deepest one found. */
export async function resolveFolders(listChildren: DesktopGateway["library"]["listChildren"], names: readonly string[]): Promise<FolderLocation[]> {
  const path: FolderLocation[] = [];
  for (const name of names) {
    const result = await listChildren(path.at(-1)?.id ?? "ROOT");
    const folder = (result.items ?? []).find((item) => item.entity === "FOLDER" && item.folderId && item.name.toLowerCase() === name.toLowerCase());
    if (!folder?.folderId) break;
    path.push({ id: folder.folderId, name: folder.name });
  }
  return path;
}

export function formatBytes(value?: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—";
  if (value < 1024) return `${value} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let amount = value;
  let unit = -1;
  do { amount /= 1024; unit += 1; } while (amount >= 1024 && unit < units.length - 1);
  return `${amount.toFixed(amount >= 10 ? 0 : 1).replace(/\.0$/, "")} ${units[unit]}`;
}

const kindOf = (item: ChildItem) => item.entity === "FOLDER" ? "Folder" : "File";

const LIVE_REFRESH_DEBOUNCE_MS = 300;
/** Changes from other devices have no local signal; check this often while visible. */
const OTHER_DEVICES_POLL_MS = 15_000;

/** A file copied onto S: that has not finished uploading (rows the app adds locally). */
export const isInFlight = (item: ChildItem) => item.state === "uploading" || item.state === "queued";

/** A Stashed file (not a folder, not still uploading) can open in Asset details. */
const canPreview = (item: ChildItem) => item.entity === "FILE" && Boolean(item.fileId) && !isInFlight(item);

const mediaKindOf = (item: ChildItem): string =>
  item.entity === "FOLDER" ? "Folder"
  : item.name.endsWith(".wav") || item.name.endsWith(".mp3") ? "Audio"
  : item.name.endsWith(".mp4") || item.name.endsWith(".mov") ? "Video"
  : item.name.endsWith(".pdf") || item.name.endsWith(".doc") ? "Document"
  : "File";

const iconFor = (item: ChildItem): string =>
  item.entity === "FOLDER" ? "📁"
  : item.name.endsWith(".wav") || item.name.endsWith(".mp3") ? "🎵"
  : item.name.endsWith(".mp4") || item.name.endsWith(".mov") ? "📹"
  : "📄";

export function FilesScreen({ gateway, mounted, onUsage, onMount, onStash, openAt }: { gateway: DesktopGateway; mounted: boolean; onUsage: (usage: Usage) => void; onMount: (status: MountStatus) => void; onStash: () => void; /** Folder names to open first, e.g. from a Search breadcrumb. */ openAt?: readonly string[] }) {
  const [history, setHistory] = useState<History<FilesPlace>>(() => startHistory({ path: [], preview: null }));
  const { path, preview: previewing } = currentPlace(history);
  const folderId = path.at(-1)?.id ?? "ROOT";
  const go = (place: FilesPlace) => setHistory((current) => visit(current, place));
  const nav: HistoryNav = {
    canBack: canGoBack(history),
    canForward: canGoForward(history),
    onBack: () => setHistory(goBack),
    onForward: () => setHistory(goForward),
  };
  const [filesState, setFilesState] = useState<CapabilityState<ChildItem[]>>({ status: "loading" });
  const [selected, setSelected] = useState<ChildItem | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedType, setSelectedType] = useState<string>("All");
  const [sort, setSort] = useState<{ key: SortKey; direction: SortDirection }>({ key: "name", direction: "ascending" });
  const [showNewFolderModal, setShowNewFolderModal] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [folderError, setFolderError] = useState("");
  const [confirmTrash, setConfirmTrash] = useState<ChildItem | null>(null);
  const [trashingFolder, setTrashingFolder] = useState(false);
  const [isFavorite, setIsFavorite] = useState(false);
  const [tags, setTags] = useState<string[]>([]);
  const [tagDraft, setTagDraft] = useState("");

  const loadChildren = () => {
    setFilesState({ status: "loading" });
    setSelected(null);
    setConfirmTrash(null);
    void gateway.library.listChildren(folderId).then((result) => {
      const itemsList = Array.isArray(result.items) ? result.items : [];
      setFilesState({ status: "ready", data: itemsList });
    }).catch((error) => {
      setFilesState({ status: "offline", message: safeActionError(error, "We couldn't load this folder. Try again."), data: [] });
    });
  };

  useEffect(() => {
    loadChildren();
  }, [folderId, gateway]);

  // Opened from a Search breadcrumb: go straight to that folder.
  useEffect(() => {
    if (!openAt?.length) return;
    let active = true;
    void resolveFolders(gateway.library.listChildren, openAt).then((found) => {
      if (active && found.length) setHistory(startHistory({ path: found, preview: null }));
    }).catch(() => undefined);
    return () => { active = false; };
  }, [gateway, openAt]);

  // The folder stays live like Explorer: it refreshes the moment STASH says
  // something changed (a delete or copy on S:, an upload landing, an action
  // here), when the window comes back into view, and every few seconds for
  // changes made on other devices. Refreshes are quiet: no loading flash, and
  // a selection that still exists stays selected.
  useEffect(() => {
    let active = true;
    let pending: number | undefined;
    const refresh = () => {
      if (!active || document.visibilityState !== "visible") return;
      void gateway.library.listChildren(folderId).then((result) => {
        if (!active) return;
        const fresh = Array.isArray(result.items) ? result.items : [];
        setFilesState({ status: "ready", data: fresh });
        setSelected((current) => current && (fresh.find((item) => item.entity === current.entity && (item.fileId ?? item.folderId) === (current.fileId ?? current.folderId)) ?? null));
      }).catch(() => undefined);
    };
    // A folder copy announces hundreds of changes; one refresh covers a burst.
    const soon = () => { window.clearTimeout(pending); pending = window.setTimeout(refresh, LIVE_REFRESH_DEBOUNCE_MS); };
    let unlisten: (() => void) | undefined;
    void gateway.library.onLibraryChanged(soon).then((cleanup) => { if (active) unlisten = cleanup; else cleanup(); });
    const poll = window.setInterval(refresh, OTHER_DEVICES_POLL_MS);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      active = false;
      unlisten?.();
      window.clearTimeout(pending);
      window.clearInterval(poll);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [folderId, gateway]);

  const items = filesState.status === "ready" || filesState.status === "stale" ? (filesState.data ?? []) : [];

  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      const matchesSearch = searchQuery === "" || item.name.toLowerCase().includes(searchQuery.toLowerCase());
      if (!matchesSearch) return false;
      if (selectedType === "Audio") return item.name.endsWith(".wav") || item.name.endsWith(".mp3");
      if (selectedType === "Video") return item.name.endsWith(".mp4") || item.name.endsWith(".mov");
      if (selectedType === "Documents") return item.name.endsWith(".pdf") || item.name.endsWith(".doc");
      if (selectedType === "Folders") return item.entity === "FOLDER";
      return true;
    });
  }, [items, searchQuery, selectedType]);

  const sortedItems = useMemo(() => [...filteredItems].sort((left, right) => {
    const a = sort.key === "size" ? left.sizeBytes ?? 0 : sort.key === "kind" ? kindOf(left) : left.name;
    const b = sort.key === "size" ? right.sizeBytes ?? 0 : sort.key === "kind" ? kindOf(right) : right.name;
    const result = a < b ? -1 : a > b ? 1 : 0;
    return sort.direction === "ascending" ? result : -result;
  }), [filteredItems, sort]);

  const toggleSort = (key: SortKey) => setSort((current) => current.key === key ? { key, direction: current.direction === "ascending" ? "descending" : "ascending" } : { key, direction: "ascending" });

  const createFolder = async () => {
    const name = newFolderName.trim();
    if (!name) return;
    setCreatingFolder(true);
    setFolderError("");
    try {
      await gateway.library.createFolder(name, folderId);
      setNewFolderName("");
      setShowNewFolderModal(false);
      loadChildren();
    } catch (error) {
      setFolderError(safeActionError(error, "STASH couldn't create that folder."));
    } finally {
      setCreatingFolder(false);
    }
  };

  const trashItem = async () => {
    const target = confirmTrash;
    if (!target) return;
    const isFolder = target.entity === "FOLDER";
    const id = isFolder ? target.folderId : target.fileId;
    if (!id) return;
    setTrashingFolder(true);
    setFolderError("");
    try {
      if (isFolder) await gateway.library.trashFolder(id);
      else await gateway.library.trashFile(id);
      if (selected === target) setSelected(null);
      setConfirmTrash(null);
      loadChildren();
    } catch (error) {
      setFolderError(safeActionError(error, isFolder ? "STASH couldn't move that folder to Trash." : "STASH couldn't move that file to Trash."));
    } finally {
      setTrashingFolder(false);
    }
  };

  const openFolder = (item: ChildItem) => {
    const id = item.folderId;
    if (kindOf(item) !== "Folder" || !id) return;
    go({ path: [...path, { id, name: item.name }], preview: null });
  };

  /** A breadcrumb link: -1 is the top of STASH. */
  const goTo = (index: number) => go({ path: index < 0 ? [] : path.slice(0, index + 1), preview: null });

  const setPreviewing = (item: ChildItem) => go({ path, preview: item });

  const selectItem = (item: ChildItem) => {
    setSelected(item);
    setIsFavorite(false);
    setTags([]);
    setTagDraft("");
  };

  const addTag = () => {
    const tag = tagDraft.trim();
    setTagDraft("");
    if (!tag || tags.includes(tag)) return;
    setTags((current) => [...current, tag]);
  };

  const handleCreateFolder = (e: FormEvent) => {
    e.preventDefault();
    void createFolder();
  };

  if (previewing?.fileId) {
    const asset = { fileId: previewing.fileId, name: previewing.name, sizeBytes: previewing.sizeBytes ?? 0, folders: path.map((location) => location.name) };
    return <AssetDetailsScreen gateway={gateway} asset={asset} mounted={mounted} nav={nav} onOpenFolder={(depth) => goTo(depth - 1)} />;
  }

  return (
    <section className="workspace files-workspace" aria-labelledby="files-heading">
      <header className="workspace-header">
        <div>
          <p className="eyebrow">Library</p>
          <h1 id="files-heading">Your files</h1>
        </div>

        <div className="workspace-actions">
          <button type="button" className="button button-primary" onClick={onStash}>
            + Upload Files
          </button>
          <button type="button" className="button button-secondary" onClick={() => { setFolderError(""); setShowNewFolderModal(true); }}>
            + New Folder
          </button>
          <input
            type="search"
            placeholder="Search files... ⌘K"
            className="search-input"
            aria-label="Search files"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
      </header>

      <LocationBar nav={nav}>
        <Breadcrumb
          trail={path}
          onNavigate={goTo}
          itemCount={filesState.status === "ready" || filesState.status === "stale" ? items.length : undefined}
        />
      </LocationBar>

      {folderError && !showNewFolderModal && <div className="status-banner banner-warning" role="alert">{folderError}</div>}

      {filesState.status === "stale" && (
        <div className="status-banner banner-warning">Data may be stale. Reconnect to refresh.</div>
      )}

      {confirmTrash && (
        <div className="status-banner banner-warning" role="alert">
          <span>Move <strong>{confirmTrash.name}</strong>{confirmTrash.entity === "FOLDER" ? " and everything inside it" : ""} to Trash? It can be restored for 30 days.</span>
          <span className="banner-actions">
            <button type="button" className="button button-danger button-sm" disabled={trashingFolder} onClick={() => void trashItem()}>
              {trashingFolder ? "Moving…" : "Move to Trash"}
            </button>
            <button type="button" className="button button-secondary button-sm" disabled={trashingFolder} onClick={() => setConfirmTrash(null)}>Cancel</button>
          </span>
        </div>
      )}

      <div className="filter-tab-bar" role="group" aria-label="Filter files by type">
        {["All", "Audio", "Video", "Documents", "Folders"].map((type) => (
          <button
            key={type}
            className={`tab-btn ${selectedType === type ? "is-active" : ""}`}
            type="button"
            aria-pressed={selectedType === type}
            onClick={() => setSelectedType(type)}
          >
            {type}
          </button>
        ))}
      </div>

      <div className="files-layout-grid">
        <div className="file-table-wrap">
          {filesState.status === "loading" ? (
            <div className="empty-state-message">Loading your STASH…</div>
          ) : filesState.status === "offline" || filesState.status === "unavailable" ? (
            <div className="empty-state-message error-text">{filesState.message || "We couldn't load this folder. Try again."}</div>
          ) : sortedItems.length === 0 ? (
            <div className="empty-state-message">{items.length === 0 ? "This folder is empty." : "No files match your filters."}</div>
          ) : (
            <table className="file-table">
              <thead>
                <tr>
                  <th scope="col"><button type="button" onClick={() => toggleSort("name")}>Name</button></th>
                  <th scope="col"><button type="button" onClick={() => toggleSort("kind")}>Type</button></th>
                  <th scope="col"><button type="button" onClick={() => toggleSort("size")}>Size</button></th>
                  <th scope="col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {sortedItems.map((item) => (
                  <tr
                    key={`${item.entity}-${item.name}-${item.fileId || item.folderId}`}
                    className={selected === item ? "is-selected" : ""}
                    onClick={() => selectItem(item)}
                    onDoubleClick={() => (item.entity === "FOLDER" ? openFolder(item) : canPreview(item) && setPreviewing(item))}
                  >
                    <td>
                      <span className="item-icon">{iconFor(item)}</span>
                      <strong>{item.name}</strong>
                    </td>
                    <td>{isInFlight(item) ? <StateTag tone="stashing" label={item.state === "uploading" ? "Uploading" : "Queued"} /> : mediaKindOf(item)}</td>
                    <td>{kindOf(item) === "Folder" ? "—" : formatBytes(item.sizeBytes)}</td>
                    <td>
                      <div className="row-actions">
                        {!isInFlight(item) && (item.entity === "FOLDER" ? item.folderId : item.fileId) && (
                          <button
                            type="button"
                            className="icon-action-btn"
                            title={item.entity === "FOLDER" ? "Move folder to Trash" : "Move file to Trash"}
                            aria-label={`Move ${item.name} to Trash`}
                            onClick={(e) => { e.stopPropagation(); setConfirmTrash(item); }}
                          >
                            🗑
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <aside className="asset-details-drawer">
          {selected ? (
            <>
              <div className="drawer-header">
                <span className="file-type-icon">{iconFor(selected)}</span>
                <div>
                  <h3>{selected.name}</h3>
                  <p className="drawer-sub">{mediaKindOf(selected)} &bull; {formatBytes(selected.sizeBytes)}</p>
                </div>
              </div>

              {canPreview(selected) && (
                <button type="button" className="button button-primary" onClick={() => setPreviewing(selected)}>Preview</button>
              )}

              <div className="metadata-list">
                <div className="meta-row"><span className="meta-label">Type:</span> <span>{kindOf(selected)}</span></div>
                <div className="meta-row"><span className="meta-label">Size:</span> <span>{formatBytes(selected.sizeBytes)}</span></div>
                <div className="meta-row">
                  <span className="meta-label">Path:</span>
                  <span>{selected.originalRelativePath || `/${[...path.map((location) => location.name), selected.name].join("/")}`}</span>
                </div>
                <div className="meta-row"><span className="meta-label">Status:</span> <span>{selected.state || "—"}</span></div>
              </div>

              <div className="tag-section">
                <span className="meta-label">Tags:</span>
                <div className="tag-pills">
                  {tags.map((tag) => (
                    <span key={tag} className="tag-pill">{tag}</span>
                  ))}
                  <input
                    type="text"
                    className="tag-input"
                    placeholder="Add tag"
                    aria-label="Add tag"
                    value={tagDraft}
                    maxLength={64}
                    onChange={(e) => setTagDraft(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") addTag(); }}
                  />
                  <button type="button" className="add-tag-btn" onClick={addTag}>+ Add</button>
                </div>
              </div>

              <button
                type="button"
                className={`button button-secondary fav-btn ${isFavorite ? "is-fav" : ""}`}
                aria-pressed={isFavorite}
                onClick={() => setIsFavorite(!isFavorite)}
              >
                {isFavorite ? "★ In Favorites" : "☆ Add to Favorites"}
              </button>
            </>
          ) : (
            <div className="drawer-placeholder">
              <p>Select a file or folder to view details</p>
            </div>
          )}
        </aside>
      </div>

      {showNewFolderModal && (
        <div className="modal-backdrop" onClick={() => setShowNewFolderModal(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="new-folder-title">
            <h3 id="new-folder-title">Create New Folder</h3>
            <form onSubmit={handleCreateFolder}>
              <label className="visually-hidden" htmlFor="new-folder-name">Folder name</label>
              <input
                id="new-folder-name"
                type="text"
                placeholder="Folder name (e.g. Beats 2026)"
                value={newFolderName}
                maxLength={255}
                onChange={(e) => setNewFolderName(e.target.value)}
                autoFocus
                className="modal-input"
              />
              {folderError && <p className="modal-error" role="alert">{folderError}</p>}
              <div className="modal-actions">
                <button type="button" className="button button-secondary" onClick={() => setShowNewFolderModal(false)}>
                  Cancel
                </button>
                <button type="submit" className="button button-primary" disabled={creatingFolder || !newFolderName.trim()}>
                  {creatingFolder ? "Creating…" : "Create Folder"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </section>
  );
}
