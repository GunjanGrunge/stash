import { useEffect, useRef, useState } from "react";
import arrowRightIcon from "../assets/figma/common/arrow-right.svg";
import fileIcon from "../assets/figma/common/file.svg";
import hardDriveIcon from "../assets/figma/common/hard-drive.svg";
import laptopIcon from "../assets/figma/common/laptop.svg";
import type { TransferStatus } from "../domain/types";
import type { DesktopGateway } from "../platform/contracts";
import { formatBytes } from "./FilesScreen";
import { EmptyRow, PageHeader, Panel, Screen, SectionTitle, StateTag, type StateTone } from "./ui";

type Props = { gateway: DesktopGateway; deviceName: string; onStashIt: () => void; onOpenFiles: () => void };

const ACTIVE = ["Preparing", "Stashing", "Verifying"];

/** Bytes per second from successive progress samples (last ~10 s). */
export function measureRate(samples: { at: number; bytes: number }[]): number | null {
  if (samples.length < 2) return null;
  const first = samples[0];
  const last = samples[samples.length - 1];
  const seconds = (last.at - first.at) / 1000;
  if (seconds < 1 || last.bytes <= first.bytes) return null;
  return (last.bytes - first.bytes) / seconds;
}

export function formatEta(seconds: number): string {
  if (seconds < 60) return `about ${Math.max(1, Math.round(seconds))} seconds left`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `about ${minutes} min left`;
  return `about ${Math.round(minutes / 60)} h left`;
}

const tagFor = (phase: TransferStatus["phase"]): { tone: StateTone; label: string } =>
  phase === "Stashed" ? { tone: "available", label: "Stashed" }
  : phase === "NeedsAttention" ? { tone: "issue", label: "Needs attention" }
  : phase === "Canceled" ? { tone: "cloud", label: "Canceled" }
  : { tone: "stashing", label: phase === "Verifying" ? "Verifying" : "Stashing" };

/** Figma "Active Stash transfer" (6:6), driven by the live transfer status. */
export function TransfersScreen({ gateway, deviceName, onStashIt, onOpenFiles }: Props) {
  const [status, setStatus] = useState<TransferStatus | null>(null);
  const [online, setOnline] = useState(true);
  const samples = useRef<{ at: number; bytes: number }[]>([]);

  useEffect(() => {
    let alive = true;
    let timer: number | undefined;
    const poll = () => {
      void gateway.stash.status()
        .then((next) => {
          if (!alive) return;
          setOnline(true);
          setStatus(next);
          if (ACTIVE.includes(next.phase) && next.fileCount > 0) {
            samples.current = [...samples.current, { at: Date.now(), bytes: next.completedBytes }].filter((s) => Date.now() - s.at <= 10_000);
          } else {
            samples.current = [];
          }
        })
        .catch(() => { if (alive) setOnline(false); })
        .finally(() => { if (alive) timer = window.setTimeout(poll, 1000); });
    };
    poll();
    return () => { alive = false; if (timer !== undefined) window.clearTimeout(timer); };
  }, [gateway]);

  const real = status && status.sourceName && status.fileCount > 0 ? status : null;

  if (!real) {
    return (
      <Screen label="Transfers">
        <PageHeader eyebrow="Transfers" title="Nothing is Stashing right now" description="Stashes you start on this workstation show their progress here." actions={<button type="button" className="button button-primary" onClick={onStashIt}>+&nbsp;&nbsp;Stash it</button>} />
        <div className="ui-list">
          <EmptyRow title="No active transfers" copy="Choose a file or folder with Stash it. STASH verifies every file before it is marked Stashed." action={<button type="button" className="button button-secondary" onClick={onStashIt}>Stash it</button>} />
        </div>
      </Screen>
    );
  }

  const running = ACTIVE.includes(real.phase);
  const percent = real.totalBytes > 0 ? Math.min(100, Math.round((real.completedBytes / real.totalBytes) * 100)) : 0;
  const rate = running ? measureRate(samples.current) : null;
  const remaining = rate ? (real.totalBytes - real.completedBytes) / rate : null;
  const tag = tagFor(real.phase);
  const eyebrow = running ? (real.phase === "Verifying" ? "Verifying" : "Stashing") : real.phase === "Stashed" ? "Stashed" : real.phase === "Canceled" ? "Canceled" : "Needs attention";

  return (
    <Screen label="Transfers">
      <PageHeader
        eyebrow={eyebrow}
        title={real.sourceName ?? "Stash"}
        description={running ? `Uploading from ${deviceName} to STASH. You can keep working while this finishes.` : real.message ?? ""}
        actions={running
          ? <button type="button" className="button button-secondary" onClick={() => void gateway.stash.cancel().then(setStatus)}>Cancel Stash</button>
          : real.phase === "Stashed" ? <button type="button" className="button button-secondary" onClick={onOpenFiles}>Open in Files</button> : <button type="button" className="button button-primary" onClick={onStashIt}>Stash it</button>}
      />
      <div className="transfer-overview">
        <div className="transfer-progress-card">
          <div className="transfer-progress-heading">
            <div>
              <p className="transfer-percent">{percent}%</p>
              <p className="transfer-counts">{formatBytes(real.completedBytes)} of {formatBytes(real.totalBytes)} · {real.completedFileCount.toLocaleString()} of {real.fileCount.toLocaleString()} files</p>
            </div>
            <div className="transfer-rate">
              <p className="transfer-rate-value">{rate ? `${formatBytes(rate)}/s` : running ? "Measuring…" : "—"}</p>
              <p className="transfer-rate-eta">{remaining ? formatEta(remaining) : running ? "Estimating time left" : ""}</p>
            </div>
          </div>
          <div className="transfer-track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}><span style={{ width: `${percent}%` }} /></div>
          <div className="transfer-route">
            <div className="transfer-endpoint"><img src={laptopIcon} width={18} height={18} alt="" /><span><span className="transfer-endpoint-name">{deviceName}</span><span className="transfer-endpoint-path">{real.sourceName}</span></span></div>
            <img src={arrowRightIcon} width={18} height={18} alt="" />
            <div className="transfer-endpoint"><img src={hardDriveIcon} width={18} height={18} alt="" /><span><span className="transfer-endpoint-name">STASH</span><span className="transfer-endpoint-path">{real.sourceName}</span></span></div>
          </div>
        </div>
        <Panel className="transfer-health">
          <h2>Transfer health</h2>
          <div className="transfer-metric"><span>Connection</span><span className={online ? "is-green" : "is-muted"}>{online ? "Connected" : "Reconnecting…"}</span></div>
          <div className="transfer-metric"><span>Verification</span><span className="is-accent">Every file</span></div>
          <div className="transfer-metric"><span>Encryption</span><span className="is-blue">In transit + at rest</span></div>
          <p className="transfer-health-note">The folder becomes Stashed only after the final integrity check.</p>
        </Panel>
      </div>
      <SectionTitle title={running ? "Stashing now" : "This Stash"} aside={`${real.completedFileCount.toLocaleString()} complete · ${Math.max(0, real.fileCount - real.completedFileCount).toLocaleString()} remaining`} />
      <div className="ui-list">
        <div className="transfer-queue-item">
          <img src={fileIcon} width={18} height={18} alt="" />
          <span className="transfer-queue-name">{real.sourceName}</span>
          <span className="transfer-queue-meta">{formatBytes(real.totalBytes)} · {percent}%</span>
          <StateTag tone={tag.tone} label={tag.label} />
        </div>
      </div>
    </Screen>
  );
}
