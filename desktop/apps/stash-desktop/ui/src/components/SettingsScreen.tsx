import { useEffect, useState, type ReactNode } from "react";
import arrowUpDownIcon from "../assets/figma/common/settings-arrow-up-down.svg";
import bellIcon from "../assets/figma/common/settings-bell.svg";
import databaseIcon from "../assets/figma/common/settings-database.svg";
import deviceLaptopIcon from "../assets/figma/common/device-laptop.svg";
import deviceMonitorIcon from "../assets/figma/common/device-monitor.svg";
import hardDriveDownloadIcon from "../assets/figma/common/hard-drive-download.svg";
import monitorIcon from "../assets/figma/common/settings-monitor.svg";
import plusIcon from "../assets/figma/common/plus.svg";
import refreshIcon from "../assets/figma/common/refresh-cw.svg";
import slidersIcon from "../assets/figma/common/sliders-horizontal.svg";
import userIcon from "../assets/figma/common/user.svg";
import type { DeviceInfo, SearchKind, StorageBreakdown, Usage } from "../domain/types";
import type { DesktopGateway } from "../platform/contracts";
import { safeActionError } from "../platform/tauri/gateway";
import { formatBytes } from "./FilesScreen";
import { MaskIcon } from "./NavigationRail";
import { EmptyRow, PageHeader, Panel, Screen, SectionTitle, SettingRow, SettingValue, Toggle } from "./ui";

export type SettingsSection = "General" | "Storage & cache" | "Transfers" | "Devices" | "Notifications" | "Account";
const SECTIONS: { id: SettingsSection; icon: string }[] = [
  { id: "General", icon: slidersIcon },
  { id: "Storage & cache", icon: databaseIcon },
  { id: "Transfers", icon: arrowUpDownIcon },
  { id: "Devices", icon: monitorIcon },
  { id: "Notifications", icon: bellIcon },
  { id: "Account", icon: userIcon },
];

type Props = {
  gateway: DesktopGateway;
  username: string;
  device: DeviceInfo;
  online: boolean;
  usage: Usage | null;
  mounted: boolean;
  mountBusy: boolean;
  onToggleMount: () => void;
  onSignOut: () => void;
  initialSection?: SettingsSection;
};

/** Figma "Settings" (6:3); Storage & cache (6:9) and Devices (6:15) open as their own pages. */
export function SettingsScreen({ gateway, username, device, online, usage, mounted, mountBusy, onToggleMount, onSignOut, initialSection = "General" }: Props) {
  const [section, setSection] = useState<SettingsSection>(initialSection);
  const back = <button type="button" className="button button-secondary" onClick={() => setSection("General")}>Back to Settings</button>;

  if (section === "Storage & cache") return <StorageScreen gateway={gateway} device={device} usage={usage} back={back} />;
  if (section === "Devices") return <DevicesScreen device={device} online={online} mounted={mounted} mountBusy={mountBusy} onToggleMount={onToggleMount} back={back} />;

  return (
    <Screen label="Settings">
      <PageHeader title="Settings" description="Tune how STASH mounts, caches, and transfers on this workstation." actions={<button type="button" className="button button-primary" disabled title="Nothing to save yet">Save changes</button>} />
      <div className="settings-body">
        <nav className="settings-nav" aria-label="Settings sections">
          {SECTIONS.map((item) => (
            <button key={item.id} type="button" className={`settings-nav-item${section === item.id ? " is-active" : ""}`} aria-current={section === item.id ? "page" : undefined} onClick={() => setSection(item.id)}>
              <MaskIcon src={item.icon} size={16} />
              <span className="settings-nav-label">{item.id}</span>
            </button>
          ))}
        </nav>
        <div className="settings-content">
          {(section === "General" || section === "Transfers") && (
            <>
              {section === "General" && (
                <Panel className="settings-group">
                  <GroupHeading title="General" copy={`Behavior for STASH on ${device.name}.`} />
                  <SettingRow title="Launch STASH at sign in" copy="Mount your cloud drive automatically when Windows starts." soon control={<Toggle checked={false} disabled label="Launch STASH at sign in" />} />
                  <SettingRow title="Drive letter" copy="Where STASH appears in File Explorer." control={<SettingValue>S:\</SettingValue>} />
                  <SettingRow title="Open files on demand" copy="Download cloud-only assets when another app requests them." control={<Toggle checked disabled label="Open files on demand" />} />
                  <SettingRow title="Show status badges" copy="Display cloud, available, pinned, syncing, and issue states in File Explorer." soon control={<Toggle checked={false} disabled label="Show status badges" />} />
                </Panel>
              )}
              <Panel className="settings-group">
                <GroupHeading title="Transfers" copy="Control bandwidth and verification behavior." />
                <SettingRow title="Bandwidth" copy="Limit upload and download rate on this workstation." control={<SettingValue>Unlimited</SettingValue>} />
                <SettingRow title="Pause on metered networks" copy="Avoid large transfers over capped or mobile connections." soon control={<Toggle checked={false} disabled label="Pause on metered networks" />} />
                <SettingRow title="Verify before Free up space" copy="Always run a final byte-for-byte cloud integrity check." soon control={<Toggle checked={false} disabled label="Verify before Free up space" />} />
              </Panel>
              <p className="settings-footnote">STASH does not reorganize, rename, or merge your folders automatically.</p>
            </>
          )}
          {section === "Notifications" && (
            <Panel className="settings-group">
              <GroupHeading title="Notifications" copy="What STASH tells you about on this workstation." />
              <SettingRow title="Stash finished or needs attention" copy="Show a notification when a Stash completes or can't continue." soon control={<Toggle checked={false} disabled label="Stash notifications" />} />
            </Panel>
          )}
          {section === "Account" && (
            <Panel className="settings-group">
              <GroupHeading title="Account" copy="The STASH account signed in on this workstation." />
              <SettingRow title="Signed in as" copy="Your STASH account." control={<SettingValue>{username}</SettingValue>} />
              <SettingRow title="Plan" copy={usage?.quotaBytes ? `${formatBytes(usage.quotaBytes)} of cloud storage.` : "Cloud storage quota."} control={<SettingValue>Private beta</SettingValue>} />
              <SettingRow title="Sign out" copy="Unmounts S: and forgets this sign-in on this workstation." control={<button type="button" className="button button-secondary" onClick={onSignOut}>Sign out</button>} />
            </Panel>
          )}
        </div>
      </div>
    </Screen>
  );
}

function GroupHeading({ title, copy }: { title: string; copy: string }) {
  return <div className="settings-group-heading"><h2>{title}</h2><p>{copy}</p></div>;
}

const CATEGORY: Record<SearchKind, { label: string; color: string }> = {
  video: { label: "Video", color: "#a987ff" },
  audio: { label: "Audio", color: "#55a7ff" },
  midi: { label: "Audio", color: "#55a7ff" },
  document: { label: "Project resources", color: "#b7ff3c" },
  image: { label: "Graphics", color: "#ffb84a" },
  other: { label: "LUTs + other", color: "#949ba8" },
};

/** Groups raw kind totals into Figma's five storage categories, largest first. */
export function storageCategories(kinds: StorageBreakdown["kinds"]): { label: string; color: string; bytes: number }[] {
  const merged = new Map<string, { label: string; color: string; bytes: number }>();
  for (const entry of kinds) {
    const category = CATEGORY[entry.kind];
    const current = merged.get(category.label) ?? { ...category, bytes: 0 };
    current.bytes += entry.bytes;
    merged.set(category.label, current);
  }
  return [...merged.values()].filter((c) => c.bytes > 0).sort((a, b) => b.bytes - a.bytes);
}

/** Figma "Storage and cache usage" (6:9). */
function StorageScreen({ gateway, device, usage, back }: { gateway: DesktopGateway; device: DeviceInfo; usage: Usage | null; back: ReactNode }) {
  const [breakdown, setBreakdown] = useState<StorageBreakdown | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    void gateway.library.storageBreakdown().then(setBreakdown).catch((reason) => setError(safeActionError(reason, "Storage details are unavailable right now.")));
  }, [gateway]);
  const used = usage?.usedBytes ?? 0;
  const quota = usage?.quotaBytes ?? 0;
  const categories = breakdown ? storageCategories(breakdown.kinds) : [];
  return (
    <Screen label="Storage and cache">
      <PageHeader eyebrow="Storage & cache" title={quota ? `${formatBytes(used)} of ${formatBytes(quota)}` : "Storage"} description="Cloud storage and workstation cache are managed independently." actions={back} />
      <div className="storage-overview">
        <Panel className="storage-cloud">
          <SectionTitle title="Cloud storage" aside={quota ? `${formatBytes(Math.max(0, quota - used))} available` : undefined} />
          <div className="storage-bar" aria-label="Cloud storage by category">
            {categories.map((c) => <span key={c.label} style={{ width: `${quota ? (c.bytes / quota) * 100 : 0}%`, background: c.color }} title={`${c.label}: ${formatBytes(c.bytes)}`} />)}
          </div>
          <div className="storage-legend">
            {breakdown === null && !error && <span className="storage-legend-note">Adding up your files…</span>}
            {error && <span className="storage-legend-note">{error}</span>}
            {breakdown && categories.length === 0 && <span className="storage-legend-note">Nothing Stashed yet.</span>}
            {categories.map((c) => (
              <span key={c.label} className="storage-category">
                <span className="storage-category-heading"><span className="storage-dot" style={{ background: c.color }} />{c.label}</span>
                <span className="storage-category-value">{formatBytes(c.bytes)}</span>
              </span>
            ))}
          </div>
        </Panel>
        <Panel className="storage-cache">
          <SectionTitle title="Local cache" aside={device.name} />
          <p className="storage-cache-value">0 B</p>
          <div className="storage-cache-bar"><span style={{ width: "0%" }} /></div>
          <p className="storage-cache-note">Files open straight from the cloud today. A local cache that keeps recent files on this device is coming soon.</p>
        </Panel>
      </div>
      <SectionTitle title="Ready to free up" aside="0 B reclaimable" />
      <div className="ui-list">
        <EmptyRow title="Nothing to free up" copy="Free up space removes local copies that are safely Stashed. There are no local copies on this device yet." />
      </div>
      <div className="storage-footer">
        <p>Only verified cloud copies are eligible. Pinned assets are excluded.</p>
        <button type="button" className="button button-primary" disabled><img src={hardDriveDownloadIcon} width={16} height={16} alt="" />Free up 0 B</button>
      </div>
    </Screen>
  );
}

/** Figma "Devices" (6:15). Only this workstation is known to the app today. */
function DevicesScreen({ device, online, mounted, mountBusy, onToggleMount, back }: { device: DeviceInfo; online: boolean; mounted: boolean; mountBusy: boolean; onToggleMount: () => void; back: ReactNode }) {
  return (
    <Screen label="Devices">
      <PageHeader eyebrow="Multi-device continuity" title="Devices" description="STASH mounts the same hierarchy across all your creator workstations." actions={<>{back}<button type="button" className="button button-primary" disabled title="Install STASH on another computer and sign in with this account"><img src={plusIcon} width={16} height={16} alt="" />Connect device</button></>} />
      <div className="devices-cards">
        <div className="device-card is-current">
          <div className="device-card-heading">
            <span className="device-icon"><img src={device.os === "Windows" ? deviceMonitorIcon : deviceLaptopIcon} width={23} height={23} alt="" /></span>
            <span className="device-badge">THIS DEVICE</span>
          </div>
          <div className="device-identity">
            <span className="device-name">{device.name}</span>
            <span className="device-os">{device.os}{device.appVersion ? ` · STASH ${device.appVersion}` : ""}</span>
          </div>
          <span className="device-status"><span className={`device-dot${online ? " is-online" : ""}`} />{online ? "Online now" : "Offline"}</span>
          <div className="device-metrics">
            <span>{mounted ? "S: mounted" : "S: not mounted"}</span>
            <span>0 B pinned</span>
          </div>
          <div className="device-actions">
            <button type="button" className="button button-secondary" disabled={mountBusy} onClick={onToggleMount}>{mounted ? "Unmount S:" : "Mount S:"}</button>
          </div>
        </div>
        <div className="device-card is-placeholder">
          <p className="device-placeholder-title">Your other workstations</p>
          <p className="device-placeholder-copy">Install STASH on another Windows or Mac computer and sign in with this account. It will appear here.</p>
        </div>
      </div>
      <Panel className="continuity">
        <div className="continuity-heading">
          <div><h2>Recent continuity</h2><p>Assets opened across devices keep one source of truth.</p></div>
        </div>
        <div className="continuity-empty"><img src={refreshIcon} width={16} height={16} alt="" />Activity across your devices appears here once another workstation signs in.</div>
      </Panel>
    </Screen>
  );
}
