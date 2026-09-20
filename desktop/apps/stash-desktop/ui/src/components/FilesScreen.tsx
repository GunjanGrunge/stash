import { useEffect, useMemo, useState } from "react";
import type { CapabilityState, ChildItem, FolderLocation, MountStatus, SortDirection, SortKey, Usage } from "../domain/types";
import type { DesktopGateway } from "../platform/contracts";
import { safeActionError } from "../platform/tauri/gateway";
import { FileIcon, FolderIcon } from "./icons";

export function formatBytes(value?: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—";
  if (value < 1024) return `${value} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let amount = value;
  let unit = -1;
  do { amount /= 1024; unit += 1; } while (amount >= 1024 && unit < units.length - 1);
  return `${amount.toFixed(amount >= 10 ? 0 : 1)} ${units[unit]}`;
}

const kindOf = (item: ChildItem) => (item.entity === "FOLDER" ? "Folder" : "File");

export function FilesScreen({ gateway, onUsage, onMount }: { gateway: DesktopGateway; onUsage: (usage: Usage) => void; onMount: (status: MountStatus) => void }) {
  const [folderId, setFolderId] = useState("ROOT");
  const [path, setPath] = useState<FolderLocation[]>([]);
  const [filesState, setFilesState] = useState<CapabilityState<ChildItem[]>>({ status: "loading" });
  const [selected, setSelected] = useState<ChildItem | null>(null);
  const [sort, setSort] = useState<{ key: SortKey; direction: SortDirection }>({ key: "name", direction: "ascending" });
  const [isPlaying, setIsPlaying] = useState(false);

  const loadChildren = () => {
    setFilesState({ status: "loading" });
    setSelected(null);
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

  const items = filesState.status === "ready" || filesState.status === "stale" ? (filesState.data ?? []) : [];
  const sortedItems = useMemo(() => [...items].sort((left, right) => {
    const a = sort.key === "size" ? left.sizeBytes ?? 0 : sort.key === "kind" ? kindOf(left) : left.name;
    const b = sort.key === "size" ? right.sizeBytes ?? 0 : sort.key === "kind" ? kindOf(right) : right.name;
    const result = a < b ? -1 : a > b ? 1 : 0;
    return sort.direction === "ascending" ? result : -result;
  }), [items, sort]);

  const toggleSort = (key: SortKey) => setSort((current) => current.key === key ? { key, direction: current.direction === "ascending" ? "descending" : "ascending" } : { key, direction: "ascending" });
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

  return (
    <section className="workspace files-workspace" aria-labelledby="files-heading">
      <header className="workspace-header">
        <div>
          <p className="eyebrow">Library</p>
          <h1 id="files-heading">Your files</h1>
          <nav className="breadcrumb" aria-label="Breadcrumb">
            <button type="button" onClick={() => goTo(null, -1)}>Files</button>
            {path.map((folder, index) => (
              <span key={`${folder.id}-${index}`}>
                &nbsp;&rsaquo;&nbsp;<button type="button" onClick={() => goTo(folder, index)}>{folder.name}</button>
              </span>
            ))}
          </nav>
        </div>

        <div className="workspace-actions">
          <input type="search" placeholder="Search your STASH... ⌘K" className="search-input" />
        </div>
      </header>

      {filesState.status === "stale" && (
        <div className="status-banner banner-warning">Data may be stale</div>
      )}

      <div className="files-layout-grid">
        {/* Table View */}
        <div className="file-table-wrap">
          {filesState.status === "loading" ? (
            <div className="empty-state-message">Loading your STASH…</div>
          ) : filesState.status === "offline" ? (
            <div className="empty-state-message error-text">{filesState.message || "We couldn't load this folder. Try again."}</div>
          ) : sortedItems.length === 0 ? (
            <div className="empty-state-message">This folder is empty.</div>
          ) : (
            <table className="file-table">
              <thead>
                <tr>
                  <th scope="col"><button type="button" onClick={() => toggleSort("name")}>Name</button></th>
                  <th scope="col"><button type="button" onClick={() => toggleSort("kind")}>Type</button></th>
                  <th scope="col"><button type="button" onClick={() => toggleSort("size")}>Size</button></th>
                  <th scope="col">State</th>
                </tr>
              </thead>
              <tbody>
                {sortedItems.map((item) => (
                  <tr
                    key={`${item.entity}-${item.name}-${item.fileId || item.folderId}`}
                    className={selected === item ? "is-selected" : ""}
                    onClick={() => {
                      setSelected(item);
                      if (kindOf(item) === "Folder") openFolder(item);
                    }}
                  >
                    <td>
                      <span className="item-icon">{kindOf(item) === "Folder" ? <FolderIcon size={16} /> : <FileIcon size={16} />}</span>
                      <strong>{item.name}</strong>
                    </td>
                    <td>{kindOf(item)}</td>
                    <td>{kindOf(item) === "Folder" ? "—" : formatBytes(item.sizeBytes)}</td>
                    <td>{item.state || "Synced"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Asset Details Preview Drawer */}
        <aside className="asset-details-drawer">
          {selected ? (
            <>
              <div className="drawer-header">
                <span className="file-type-icon">{kindOf(selected) === "Folder" ? <FolderIcon size={24} /> : <FileIcon size={24} />}</span>
                <h3>{selected.name}</h3>
                <p className="drawer-sub">{kindOf(selected)} &bull; {formatBytes(selected.sizeBytes)}</p>
              </div>

              {selected.name.endsWith(".wav") || selected.name.endsWith(".mp3") ? (
                <div className="waveform-box">
                  <div className="waveform-visualizer">
                    <span className="bar bar-1" />
                    <span className="bar bar-2" />
                    <span className="bar bar-3" />
                    <span className="bar bar-4" />
                    <span className="bar bar-5" />
                  </div>
                  <div className="player-controls">
                    <button type="button" className="play-btn" onClick={() => setIsPlaying(!isPlaying)}>
                      {isPlaying ? "⏸" : "▶"}
                    </button>
                    <span className="time-display">0:00</span>
                  </div>
                </div>
              ) : null}

              <div className="metadata-list">
                <div className="meta-row"><span className="meta-label">Type:</span> <span>{kindOf(selected)}</span></div>
                <div className="meta-row"><span className="meta-label">Size:</span> <span>{formatBytes(selected.sizeBytes)}</span></div>
                {selected.originalRelativePath && (
                  <div className="meta-row"><span className="meta-label">Path:</span> <span>{selected.originalRelativePath}</span></div>
                )}
              </div>
            </>
          ) : (
            <div className="drawer-placeholder">
              <p>Select a file or folder to view details</p>
            </div>
          )}
        </aside>
      </div>
    </section>
  );
}

