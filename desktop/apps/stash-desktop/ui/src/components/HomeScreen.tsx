import { useEffect, useState } from "react";
import archiveIcon from "../assets/figma/common/archive.svg";
import cloudIcon from "../assets/figma/common/cloud.svg";
import pinIcon from "../assets/figma/common/pin-17.svg";
import plusIcon from "../assets/figma/common/plus.svg";
import reclaimIcon from "../assets/figma/common/reclaim.svg";
import sparklesIcon from "../assets/figma/common/sparkles.svg";
import hardDriveIcon from "../assets/figma/common/stat-hard-drive.svg";
import monitorIcon from "../assets/figma/common/workstation-monitor.svg";
import type { DeviceInfo, StashSummary, StorageBreakdown, TransferStatus, Usage } from "../domain/types";
import type { DesktopGateway } from "../platform/contracts";
import { formatBytes } from "./FilesScreen";
import { EmptyRow, PageHeader, Panel, Screen, StatCard, timeAgo } from "./ui";

type Props = {
  gateway: DesktopGateway;
  usage: Usage | null;
  device: DeviceInfo;
  online: boolean;
  mounted: boolean;
  transfer?: TransferStatus;
  dragOver: boolean;
  onStashIt: () => void;
  onOpenFiles: () => void;
  onOpenRecent: () => void;
  onOpenTransfers: () => void;
  onManageDevices: () => void;
};

/** "MONDAY, 28 SEPTEMBER" and "Good afternoon" for right now. */
export function greetingFor(date: Date): { eyebrow: string; greeting: string } {
  const eyebrow = date.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" }).replace(/^(\w+) /, "$1, ");
  const hour = date.getHours();
  const greeting = hour < 5 ? "Working late" : hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  return { eyebrow, greeting };
}

export function stashTitle(stash: StashSummary): string {
  return stash.name ?? `Stash of ${stash.fileCount.toLocaleString()} ${stash.fileCount === 1 ? "file" : "files"}`;
}

/** Figma "Home dashboard" (6:2), with the signed-in user's real numbers. */
export function HomeScreen({ gateway, usage, device, online, mounted, transfer, dragOver, onStashIt, onOpenFiles, onOpenRecent, onOpenTransfers, onManageDevices }: Props) {
  const [stashes, setStashes] = useState<StashSummary[] | null>(null);
  const [breakdown, setBreakdown] = useState<StorageBreakdown | null>(null);
  useEffect(() => {
    void gateway.library.listStashes().then(setStashes).catch(() => setStashes([]));
    void gateway.library.storageBreakdown().then(setBreakdown).catch(() => undefined);
  }, [gateway]);

  const { eyebrow, greeting } = greetingFor(new Date());
  const description = !online ? `${device.name} can't reach STASH right now. Your files are safe in the cloud.`
    : mounted ? `Your STASH is mounted as S: on ${device.name}.`
    : `Mount S: to open your STASH in File Explorer on ${device.name}.`;
  const recent = (stashes ?? []).filter((s) => s.state !== "open" || s.committedCount > 0).slice(0, 3);
  const running = transfer && transfer.sourceName && ["Preparing", "Stashing", "Verifying"].includes(transfer.phase);

  return (
    <Screen label="Home">
      <PageHeader
        eyebrow={eyebrow}
        title={greeting}
        description={dragOver ? "Release to Stash it. Folders keep their exact structure." : description}
        actions={<button type="button" className="button button-primary" onClick={onStashIt}><img src={plusIcon} width={16} height={16} alt="" />Stash it</button>}
      />
      <div className="ui-stats">
        <StatCard label="Cloud library" icon={cloudIcon} value={usage?.usedBytes != null ? formatBytes(usage.usedBytes) : "—"} sub={breakdown ? `${breakdown.indexedFiles.toLocaleString()} assets` : "Counting assets…"} />
        <StatCard label="Local cache" icon={hardDriveIcon} value="0 B" sub={`On ${device.name}`} />
        <StatCard label="Pinned offline" icon={pinIcon} value="0 B" sub="0 assets" />
        <StatCard label="Space reclaimed" icon={sparklesIcon} value="0 B" sub="Free up space is coming soon" />
      </div>
      <div className="home-body">
        <div className="home-main">
          <div className="ui-section-title">
            <h2>{running ? "Stashing now" : "Continue working"}</h2>
            <button type="button" className="ui-link" onClick={running ? onOpenTransfers : onOpenFiles}>{running ? "Open Transfers" : "Open Files"}</button>
          </div>
          {running && transfer ? (
            <button type="button" className="home-transfer" onClick={onOpenTransfers}>
              <span className="home-transfer-name">{transfer.sourceName}</span>
              <span className="home-transfer-meta">{transfer.completedFileCount.toLocaleString()} of {transfer.fileCount.toLocaleString()} files · {formatBytes(transfer.completedBytes)} of {formatBytes(transfer.totalBytes)}</span>
              <span className="home-transfer-track"><span style={{ width: `${transfer.totalBytes ? (transfer.completedBytes / transfer.totalBytes) * 100 : 0}%` }} /></span>
            </button>
          ) : (
            <EmptyRow title="Files you open will show up here" copy="Open anything from S: or Files and it appears here so you can jump back in." action={<button type="button" className="button button-secondary" onClick={onOpenFiles}>Open Files</button>} />
          )}
          <Panel>
            <div className="ui-section-title">
              <h2>Recent Stashes</h2>
              <button type="button" className="ui-link" onClick={onOpenRecent}>View history</button>
            </div>
            {stashes === null && <p className="home-muted">Loading your Stashes…</p>}
            {stashes !== null && recent.length === 0 && <p className="home-muted">Nothing Stashed yet. Choose Stash it to add your first folder.</p>}
            {recent.map((stash) => (
              <div key={stash.stashId} className="home-stash">
                <span className="home-stash-icon"><img src={archiveIcon} width={18} height={18} alt="" /></span>
                <span className="home-stash-copy">
                  <span className="home-stash-name">{stashTitle(stash)}</span>
                  <span className="home-stash-meta">{stash.committedCount.toLocaleString()} {stash.committedCount === 1 ? "file" : "files"} · {formatBytes(stash.committedBytes)}{stash.state === "cancelled" ? " · canceled" : ""}</span>
                </span>
                <span className="home-stash-time">{timeAgo(stash.startedAt)}</span>
              </div>
            ))}
          </Panel>
        </div>
        <div className="home-side">
          <div className="ui-section-title">
            <h2>Workstations</h2>
            <button type="button" className="ui-link" onClick={onManageDevices}>Manage</button>
          </div>
          <Panel>
            <div className="home-device">
              <span className="home-device-icon"><img src={monitorIcon} width={18} height={18} alt="" /></span>
              <span className="home-device-copy">
                <span className="home-device-name">{device.name}</span>
                <span className="home-device-status">{online ? "Online · this device" : "Offline · this device"}{mounted ? " · S: mounted" : ""}</span>
              </span>
            </div>
            <p className="home-muted">Sign in on another computer to see it here.</p>
          </Panel>
          <div className="home-callout">
            <img src={reclaimIcon} width={24} height={24} alt="" />
            <p className="home-callout-title">Free up space, soon</p>
            <p className="home-callout-copy">STASH will clear local copies of files you haven't opened in a while, once they're verified in the cloud.</p>
            <button type="button" className="button button-primary home-callout-button" onClick={onStashIt}>Stash it</button>
          </div>
        </div>
      </div>
    </Screen>
  );
}
