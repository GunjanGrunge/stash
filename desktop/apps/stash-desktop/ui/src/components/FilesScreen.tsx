import { useEffect, useMemo, useState, type FormEvent } from "react";
import type { CapabilityState, ChildItem, FolderLocation, MountStatus, SortDirection, SortKey, Usage } from "../domain/types";
import type { DesktopGateway } from "../platform/contracts";
import { safeActionError } from "../platform/tauri/gateway";
import { Breadcrumb } from "./ui";

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

export function FilesScreen({ gateway, onUsage, onMount, onStash }: { gateway: DesktopGateway; onUsage: (usage: Usage) => void; onMount: (status: MountStatus) => void; onStash: () => void }) {
  const [folderId, setFolderId] = useState("ROOT");
  const [path, setPath] = useState<FolderLocation[]>([]);
  const [filesState, setFilesState] = useState<CapabilityState<ChildItem[]>>({ status: "loading" });
  const [selected, setSelected] = useState<ChildItem | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedType, setSelectedType] = useState<string>("All");
  const [sort, setSort] = useState<{ key: SortKey; direction: SortDirection }>({ key: "name", direction: "ascending" });
  const [isPlaying, setIsPlaying] = useState(false);
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

  // Changes made on S: (or elsewhere) show up when the creator comes back to
  // the app. This reload is quiet: no loading flash, and a selection that
  // still exists stays selected.
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState !== "visible") return;
      void gateway.library.listChildren(folderId).then((result) => {
        const fresh = Array.isArray(result.items) ? result.items : [];
        setFilesState({ status: "ready", data: fresh });
        setSelected((current) => current && (fresh.find((item) => item.entity === current.entity && (item.fileId ?? item.folderId) === (current.fileId ?? current.folderId)) ?? null));
      }).catch(() => undefined);
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
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
    setFolderId(id);
    setPath((current) => [...current, { id, name: item.name }]);
  };

  const goTo = (location: FolderLocation | null, index: number) => {
    setFolderId(location?.id ?? "ROOT");
    setPath(index < 0 ? [] : path.slice(0, index + 1));
  };

  const selectItem = (item: ChildItem) => {
    setSelected(item);
    setIsPlaying(false);
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

      <Breadcrumb
        trail={path}
        onNavigate={(index) => goTo(index < 0 ? null : path[index] ?? null, index)}
        itemCount={filesState.status === "ready" || filesState.status === "stale" ? items.length : undefined}
      />

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
                    onDoubleClick={() => openFolder(item)}
                  >
                    <td>
                      <span className="item-icon">{iconFor(item)}</span>
                      <strong>{item.name}</strong>
                    </td>
                    <td>{mediaKindOf(item)}</td>
                    <td>{kindOf(item) === "Folder" ? "—" : formatBytes(item.sizeBytes)}</td>
                    <td>
                      <div className="row-actions">
                        {(item.entity === "FOLDER" ? item.folderId : item.fileId) && (
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

              {(selected.name.endsWith(".wav") || selected.name.endsWith(".mp3")) && (
                <div className="waveform-box">
                  <div className="waveform-visualizer" aria-hidden="true">
                    <span className={`bar bar-1 ${isPlaying ? "animating" : ""}`} />
                    <span className={`bar bar-2 ${isPlaying ? "animating" : ""}`} />
                    <span className={`bar bar-3 ${isPlaying ? "animating" : ""}`} />
                    <span className={`bar bar-4 ${isPlaying ? "animating" : ""}`} />
                    <span className={`bar bar-5 ${isPlaying ? "animating" : ""}`} />
                    <span className={`bar bar-6 ${isPlaying ? "animating" : ""}`} />
                    <span className={`bar bar-7 ${isPlaying ? "animating" : ""}`} />
                    <span className={`bar bar-8 ${isPlaying ? "animating" : ""}`} />
                  </div>
                  <div className="player-controls">
                    <button
                      type="button"
                      className="play-btn"
                      onClick={() => setIsPlaying(!isPlaying)}
                      aria-label={isPlaying ? "Pause preview" : "Play preview"}
                    >
                      {isPlaying ? "⏸" : "▶"}
                    </button>
                    <span className="time-display">0:00</span>
                  </div>
                </div>
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
