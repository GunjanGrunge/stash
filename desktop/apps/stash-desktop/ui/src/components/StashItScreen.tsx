import { useEffect, useRef, useState } from "react";
import type { SourceSummary, TransferStatus } from "../domain/types";
import type { DesktopGateway } from "../platform/contracts";
import { safeActionError } from "../platform/tauri/gateway";
import { formatBytes } from "./FilesScreen";

type Props = { gateway: DesktopGateway; onClose: () => void; onStatus: (status: TransferStatus) => void; initialSource?: SourceSummary };

export function StashItScreen({ gateway, onClose, onStatus, initialSource }: Props) {
  const [source, setSource] = useState<SourceSummary | null>(initialSource ?? null);
  const [status, setStatus] = useState<TransferStatus | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const pollTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    let active = true;
    const poll = () => {
      void gateway.stash.status().then((next) => {
        if (!active) return;
        setStatus(next);
        onStatus(next);
        if (["Preparing", "Stashing", "Verifying"].includes(next.phase)) pollTimer.current = window.setTimeout(poll, 700);
      }).catch(() => undefined);
    };
    poll();
    let unlisten: (() => void) | undefined;
    void gateway.stash.onNativeDrop((notice) => {
      if (!active) return;
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
      active = false;
      if (pollTimer.current !== undefined) window.clearTimeout(pollTimer.current);
      unlisten?.();
    };
  }, [gateway, onStatus]);

  const select = async (kind: "file" | "folder") => {
    setError(""); setBusy(true);
    try { setSource(await gateway.stash.selectSource(kind)); setStatus(null); }
    catch (reason) { setError(safeActionError(reason, "The source picker is unavailable in this build.")); }
    finally { setBusy(false); }
  };
  const confirm = async () => {
    setError(""); setBusy(true);
    try { const next = await gateway.stash.confirm(); setStatus(next); onStatus(next); }
    catch (reason) { setError(safeActionError(reason, "STASH could not start this transfer.")); }
    finally { setBusy(false); }
  };
  const cancel = async () => {
    setBusy(true);
    try { const next = await gateway.stash.cancel(); setStatus(next); onStatus(next); }
    catch { setError("STASH could not confirm cancellation."); }
    finally { setBusy(false); }
  };
  const phaseLabel = status?.phase === "NeedsAttention" ? "Needs attention" : status?.phase ?? "Ready to choose";
  return <div className="stash-overlay" role="dialog" aria-modal="true" aria-labelledby="stash-it-heading">
    <section className="stash-card">
      <header className="stash-card-header"><div><p className="eyebrow">New ingestion event</p><h1 id="stash-it-heading">Stash it</h1></div><button className="icon-button" type="button" aria-label="Close Stash It" onClick={onClose}>×</button></header>
      <div className={`stash-dropzone${dragOver ? " is-drag-over" : ""}`} aria-live="polite">
        <span className="dropzone-symbol" aria-hidden="true">⌁</span>
        <h2>{source ? source.sourceName : dragOver ? "Release to prepare this source" : "Choose the work you want to keep"}</h2>
        <p>{source ? `${source.fileCount} files · ${formatBytes(source.totalBytes)} · original names preserved` : "Drop one file or folder here, or use the keyboard-friendly picker below. Paths stay in the native STASH boundary."}</p>
        <div className="actions"><button className="button button-primary" type="button" disabled={busy} onClick={() => void select("folder")}>Choose folder</button><button className="button button-secondary" type="button" disabled={busy} onClick={() => void select("file")}>Choose file</button></div>
      </div>
      {source && <section className="stash-review" aria-labelledby="review-heading"><div className="panel-heading"><div><p className="eyebrow">Review</p><h2 id="review-heading">{source.folderName}</h2></div><span className="status-badge">{phaseLabel}</span></div><p className="review-meta">{source.fileCount} files · {formatBytes(source.totalBytes)} · paths stay exactly as selected</p>{status?.manifestMatch && <p className="review-meta">Manifest check: <strong>{status.manifestMatch}</strong></p>}<div className="manifest-list" aria-label="Selected source files">{source.entries.slice(0, 8).map((entry) => <div className="manifest-row" key={`${entry.relativePath}:${entry.sizeBytes}`}><span>{entry.relativePath}</span><span>{formatBytes(entry.sizeBytes)}</span></div>)}{source.entries.length > 8 && <p className="status">Showing 8 of {source.entries.length} entries.</p>}</div></section>}
      {status && <section className={`transfer-state transfer-${status.phase.toLowerCase()}`} aria-live="polite"><div><p className="eyebrow">Transfer state</p><h2>{phaseLabel}</h2><p>{status.message ?? (status.phase === "Stashing" ? `${status.completedFileCount} of ${status.fileCount} files verified by the transfer boundary.` : status.phase === "Verifying" ? "STASH is verifying committed objects and the Stash manifest." : "")}</p></div><span className="transfer-count">{status.completedFileCount}/{status.fileCount}</span></section>}
      {error && <p className="status status-error" role="alert">{error}</p>}
      <footer className="stash-actions"><button className="button button-secondary" type="button" onClick={() => void cancel()} disabled={busy || !source || status?.phase === "Stashed"}>Cancel Stash</button><button className="button button-primary" type="button" onClick={() => void confirm()} disabled={busy || !source || ["Stashing", "Verifying", "Stashed", "Canceled"].includes(status?.phase ?? "")}>{status?.phase === "Stashed" ? "Stashed" : "Stash it"}</button></footer>
    </section>
  </div>;
}
