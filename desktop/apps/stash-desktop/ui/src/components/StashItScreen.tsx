import { useEffect, useRef, useState } from "react";
import downloadIcon from "../assets/figma/stash-it/download.svg";
import folderIcon from "../assets/figma/stash-it/folder.svg";
import folderOpenIcon from "../assets/figma/stash-it/folder-open.svg";
import hardDriveIcon from "../assets/figma/stash-it/hard-drive.svg";
import monitorIcon from "../assets/figma/stash-it/monitor.svg";
import type { SourceSummary, TransferStatus } from "../domain/types";
import type { DesktopGateway, StashStart } from "../platform/contracts";
import { safeActionError } from "../platform/tauri/gateway";
import { formatBytes } from "./FilesScreen";

type Props = {
  gateway: DesktopGateway;
  onClose: () => void;
  onStatus: (status: TransferStatus) => void;
  initialSource?: SourceSummary;
  onOpenFiles?: () => void;
};

const ACTIVE_PHASES = ["Preparing", "Stashing", "Verifying"];

/** Figma "Source shortcut" row: open the picker already inside a known folder. */
const SHORTCUTS: { start: StashStart; label: string; icon: string }[] = [
  { start: "desktop", label: "Desktop", icon: monitorIcon },
  { start: "downloads", label: "Downloads", icon: downloadIcon },
  { start: "documents", label: "Documents", icon: folderIcon },
];

/** A status that belongs to a started Stash, not idle or a source still waiting for "Stash it". */
const isRealTransfer = (status: TransferStatus | null): status is TransferStatus =>
  Boolean(status && status.phase !== "Ready" && status.sourceName && status.fileCount > 0);

const files = (n: number) => `${n.toLocaleString()} ${n === 1 ? "file" : "files"}`;

/** Figma "Stash it picker" (node 6:8), shown as a full page in the app frame. */
export function StashItScreen({ gateway, onClose, onStatus, initialSource, onOpenFiles }: Props) {
  const [source, setSource] = useState<SourceSummary | null>(initialSource ?? null);
  const [status, setStatus] = useState<TransferStatus | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const pollTimer = useRef<number | undefined>(undefined);
  const active = useRef(true);

  const poll = () => {
    void gateway.stash.status().then((next) => {
      if (!active.current) return;
      setStatus(next);
      onStatus(next);
      if (ACTIVE_PHASES.includes(next.phase)) pollTimer.current = window.setTimeout(poll, 700);
    }).catch(() => undefined);
  };

  useEffect(() => {
    active.current = true;
    poll();
    let unlisten: (() => void) | undefined;
    void gateway.stash.onNativeDrop((notice) => {
      if (!active.current) return;
      setDragOver(notice.phase === "over");
      if (notice.phase === "accepted" && notice.summary) {
        setSource(notice.summary);
        setStatus(null);
        setError("");
      } else if (notice.phase === "rejected") {
        setError(notice.message ?? "STASH could not accept that drop.");
      }
    }).then((cleanup) => { unlisten = cleanup; });
    return () => {
      active.current = false;
      if (pollTimer.current !== undefined) window.clearTimeout(pollTimer.current);
      unlisten?.();
    };
  }, [gateway]);

  const select = async (kind: "file" | "folder", start?: StashStart) => {
    setMenuOpen(false);
    setError(""); setBusy(true);
    try { setSource(await gateway.stash.selectSource(kind, start)); setStatus(null); }
    catch (reason) {
      const message = safeActionError(reason, "The picker couldn't open. Try again.");
      if (!/No source selected/i.test(message)) setError(message);
    }
    finally { setBusy(false); }
  };
  const confirm = async () => {
    setError(""); setBusy(true);
    try {
      const next = await gateway.stash.confirm();
      setStatus(next); onStatus(next);
      if (pollTimer.current !== undefined) window.clearTimeout(pollTimer.current);
      pollTimer.current = window.setTimeout(poll, 700);
    }
    catch (reason) { setError(safeActionError(reason, "STASH could not start this Stash.")); }
    finally { setBusy(false); }
  };
  const cancel = async () => {
    setBusy(true);
    try { const next = await gateway.stash.cancel(); setStatus(next); onStatus(next); }
    catch { setError("STASH could not confirm cancellation."); }
    finally { setBusy(false); }
  };
  const reset = () => { setSource(null); setStatus(null); setError(""); };

  const transfer = isRealTransfer(status) ? status : null;
  const running = Boolean(transfer && ACTIVE_PHASES.includes(transfer.phase));
  const percent = transfer && transfer.totalBytes > 0 ? Math.min(100, (transfer.completedBytes / transfer.totalBytes) * 100) : 0;
  const destination = source ? `STASH / ${source.folderName}` : "STASH / top level";

  let zone;
  if (transfer && transfer.phase === "Stashed") {
    zone = (
      <>
        <Vault />
        <h2 className="stash-zone-title">Stashed</h2>
        <p className="stash-zone-copy">{files(transfer.fileCount)} · {formatBytes(transfer.totalBytes)} verified and committed. Folder names and structure are exactly as you had them.</p>
        <div className="stash-zone-actions">
          {onOpenFiles && <button type="button" className="button button-primary" onClick={onOpenFiles}>Open in Files</button>}
          <button type="button" className="button button-secondary" onClick={reset}>Stash something else</button>
        </div>
      </>
    );
  } else if (transfer && (transfer.phase === "NeedsAttention" || transfer.phase === "Canceled")) {
    zone = (
      <>
        <Vault />
        <h2 className="stash-zone-title">{transfer.phase === "Canceled" ? "Stash canceled" : "This Stash needs attention"}</h2>
        <p className="stash-zone-copy">{transfer.message ?? "Nothing was marked Stashed that STASH hadn't verified."}</p>
        <div className="stash-zone-actions">
          {source && transfer.phase === "NeedsAttention" && <button type="button" className="button button-primary" disabled={busy} onClick={() => void confirm()}>Try again</button>}
          <button type="button" className="button button-secondary" onClick={reset}>Choose something else</button>
        </div>
      </>
    );
  } else if (running && transfer) {
    const label = transfer.phase === "Verifying" ? "Verifying" : transfer.phase === "Preparing" ? "Preparing" : "Stashing";
    zone = (
      <>
        <Vault />
        <h2 className="stash-zone-title">{label} {transfer.sourceName}</h2>
        <div className="stash-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(percent)}><span style={{ width: `${percent}%` }} /></div>
        <p className="stash-zone-copy">
          {transfer.phase === "Verifying" ? "STASH is verifying every committed file before calling it Stashed." : `${transfer.completedFileCount.toLocaleString()} of ${files(transfer.fileCount)} verified · ${formatBytes(transfer.completedBytes)} of ${formatBytes(transfer.totalBytes)}`}
        </p>
      </>
    );
  } else if (source) {
    zone = (
      <>
        <Vault />
        <h2 className="stash-zone-title">{source.sourceName}</h2>
        <p className="stash-zone-copy">{files(source.fileCount)} · {formatBytes(source.totalBytes)} · names and folders kept exactly as they are</p>
        <ul className="stash-entries" aria-label="Selected files">
          {source.entries.slice(0, 5).map((entry) => <li key={`${entry.relativePath}:${entry.sizeBytes}`}><span>{entry.relativePath}</span><span>{formatBytes(entry.sizeBytes)}</span></li>)}
          {source.entries.length > 5 && <li className="stash-entries-more">and {(source.entries.length - 5).toLocaleString()} more</li>}
        </ul>
        <div className="stash-zone-actions">
          <button type="button" className="button button-primary" disabled={busy} onClick={() => void confirm()}>Stash it</button>
          <button type="button" className="button button-secondary" disabled={busy} onClick={reset}>Choose something else</button>
        </div>
      </>
    );
  } else {
    zone = (
      <>
        <Vault />
        <h2 className="stash-zone-title">{dragOver ? "Release to Stash it" : "Drop it into the vault"}</h2>
        <p className="stash-zone-copy stash-zone-lede">Folders stay exactly as you built them. STASH stores the hierarchy, verifies every byte, then frees local space when you choose.</p>
        <div className="stash-choose">
          <button type="button" className="button button-primary" disabled={busy} aria-haspopup="menu" aria-expanded={menuOpen} onClick={() => setMenuOpen((open) => !open)}>
            <img src={folderOpenIcon} width={16} height={16} alt="" />
            Choose files or folders
          </button>
          {menuOpen && (
            <div className="stash-choose-menu" role="menu">
              <button type="button" role="menuitem" onClick={() => void select("folder")}>Choose folder</button>
              <button type="button" role="menuitem" onClick={() => void select("file")}>Choose file</button>
            </div>
          )}
        </div>
      </>
    );
  }

  return (
    <section className="stash-page" aria-labelledby="stash-it-heading">
      <header className="stash-page-header">
        <div>
          <p className="stash-eyebrow">Stash it</p>
          <h1 id="stash-it-heading">Make room without breaking your flow</h1>
          <p>Choose files or folders from this workstation. Your hierarchy stays untouched.</p>
        </div>
        {running
          ? <button type="button" className="button stash-cancel" disabled={busy} onClick={() => void cancel()}>Cancel Stash</button>
          : <button type="button" className="button stash-cancel" onClick={onClose}>Cancel</button>}
      </header>

      <div className="stash-workspace">
        <div className="stash-drop-area">
          <div className={`stash-zone${dragOver ? " is-drag-over" : ""}`} aria-live="polite">{zone}</div>
          {!source && !transfer && (
            <div className="stash-shortcuts">
              {SHORTCUTS.map((shortcut) => (
                <button key={shortcut.start} type="button" className="stash-shortcut" disabled={busy} onClick={() => void select("folder", shortcut.start)}>
                  <img src={shortcut.icon} width={18} height={18} alt="" />
                  <span>
                    <span className="stash-shortcut-name">{shortcut.label}</span>
                    <span className="stash-shortcut-detail">Choose a folder from {shortcut.label}</span>
                  </span>
                </button>
              ))}
            </div>
          )}
          {error && <p className="stash-error" role="alert">{error}</p>}
        </div>

        <aside className="stash-summary">
          <div className="stash-panel">
            <h2>What happens next</h2>
            <Step n={1} title="Byte-for-byte upload" copy="We verify every file before it is Stashed." />
            <Step n={2} title="Hierarchy preserved" copy="Folders remain exactly where you put them." />
            <Step n={3} title="You choose cleanup" copy="Local originals stay until you select Free up space." />
          </div>
          <div className="stash-panel">
            <h2 className="stash-destination-label">Destination</h2>
            <div className="stash-destination-path">
              <img src={hardDriveIcon} width={18} height={18} alt="" />
              <span>{destination}</span>
            </div>
            <p className="stash-destination-note">New Stashes appear in Recent Stashes.</p>
          </div>
        </aside>
      </div>
    </section>
  );
}

/** Figma "Vault mouth" (node 3:24082): built from CSS, not an image. */
function Vault() {
  return <div className="stash-vault" aria-hidden="true"><span /></div>;
}

function Step({ n, title, copy }: { n: number; title: string; copy: string }) {
  return (
    <div className="stash-step">
      <span className="stash-step-number">{n}</span>
      <span className="stash-step-copy">
        <span className="stash-step-title">{title}</span>
        <span className="stash-step-description">{copy}</span>
      </span>
    </div>
  );
}
