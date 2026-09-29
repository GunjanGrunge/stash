import { useCallback, useEffect, useState } from "react";
import type { CapabilityState, DeviceInfo, MountStatus, NativeDropNotice, SourceSummary, TransferStatus, Usage } from "../domain/types";
import type { DesktopGateway } from "../platform/contracts";
import { safeActionError } from "../platform/tauri/gateway";
import { FilesScreen, formatBytes } from "./FilesScreen";
import { HomeScreen } from "./HomeScreen";
import { NavigationRail, type NavItem } from "./NavigationRail";
import { OfflineScreen } from "./OfflineScreen";
import { SearchScreen } from "./SearchScreen";
import { SettingsScreen, type SettingsSection } from "./SettingsScreen";
import { StashItScreen } from "./StashItScreen";
import { TopBar } from "./TopBar";
import { TransfersScreen } from "./TransfersScreen";
import { UnavailableScreen } from "./UnavailableScreen";

type Props = {
  gateway: DesktopGateway;
  username: string;
  onSignOut: () => void;
  signOutError?: string;
  /** Starting screen; the app always starts on Home. Used by the dev screen preview. */
  initialScreen?: NavItem;
  initialStashOpen?: boolean;
  initialSettingsSection?: SettingsSection;
  initialSearchQuery?: string;
};

/** Figma frame: 232px sidebar, then a 72px top bar over the active screen. */
export function Shell({ gateway, username, onSignOut, signOutError = "", initialScreen = "Home", initialStashOpen = false, initialSettingsSection = "General", initialSearchQuery = "" }: Props) {
  const [active, setActive] = useState<NavItem>(initialScreen);
  const [usage, setUsage] = useState<CapabilityState<Usage>>({ status: "loading" });
  const [mount, setMount] = useState<CapabilityState<MountStatus>>({ status: "loading" });
  const [transfer, setTransfer] = useState<TransferStatus>();
  const [stashOpen, setStashOpen] = useState(initialStashOpen);
  const [notice, setNotice] = useState("");
  const [mountBusy, setMountBusy] = useState(false);
  const [mountActionError, setMountActionError] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [droppedSource, setDroppedSource] = useState<SourceSummary>();
  const [searchQuery, setSearchQuery] = useState({ text: initialSearchQuery, at: 0 });
  const [device, setDevice] = useState<DeviceInfo>({ name: "This computer", os: "Windows", appVersion: "" });
  const [settingsSection, setSettingsSection] = useState<SettingsSection>(initialSettingsSection);

  useEffect(() => { void gateway.device.info().then(setDevice).catch(() => undefined); }, [gateway]);

  const loadUsage = () => {
    // Keep showing the last known usage while it refreshes.
    setUsage((previous) => previous.status === "ready" || previous.status === "stale" ? { status: "stale", data: previous.data, message: "Refreshing storage…" } : { status: "loading" });
    void gateway.library.getUsage().then((data) => setUsage({ status: "ready", data })).catch((error) => setUsage({ status: "offline", message: safeActionError(error, "Storage unavailable") }));
  };

  const loadMount = () => {
    setMount({ status: "loading" });
    void gateway.library.mountStatus().then((data) => setMount({ status: "ready", data })).catch((error) => setMount({ status: "offline", message: safeActionError(error, "Mount unavailable") }));
  };

  useEffect(() => {
    let active = true;
    let unlisten: (() => void) | undefined;
    void gateway.stash.onNativeDrop((notice: NativeDropNotice) => {
      if (!active) return;
      setDragOver(notice.phase === "over");
      if (notice.phase === "accepted" && notice.summary) {
        setDroppedSource(notice.summary);
        setStashOpen(true);
        setNotice("");
      } else if (notice.phase === "rejected") {
        setNotice(notice.message ?? "STASH could not accept that drop.");
      }
    }).then((cleanup) => { unlisten = cleanup; });
    return () => { active = false; unlisten?.(); };
  }, [gateway]);

  useEffect(() => {
    loadUsage();
    loadMount();
  }, [gateway]);

  const usageReady = usage.status === "ready" || usage.status === "stale";
  const usageText = usageReady ? `${formatBytes(usage.data.usedBytes)} of ${formatBytes(usage.data.quotaBytes)}` : usage.status === "offline" ? (usage.message || "Storage unavailable") : "Loading storage…";
  const usagePercent = usageReady && usage.data.quotaBytes ? ((usage.data.usedBytes ?? 0) / usage.data.quotaBytes) * 100 : null;
  const mounted = (mount.status === "ready" || mount.status === "stale") && mount.data.mounted;
  // Online = this PC reached the STASH API for storage usage.
  const online = usage.status !== "offline";
  const mountText = mount.status === "ready" || mount.status === "stale" ? (mount.data.mounted ? `${mount.data.letter ?? "S"}: mounted` : "Mount S:") : mount.status === "offline" ? (mount.message || "Mount unavailable") : "Checking drive…";

  const toggleMount = () => {
    if (mount.status !== "ready" && mount.status !== "stale") { loadMount(); return; }
    const isMounted = mount.data.mounted;
    setMountBusy(true);
    setMountActionError("");
    const action = isMounted ? gateway.library.unmountStash() : gateway.library.mountStash();
    void action
      .then((data) => setMount({ status: "ready", data }))
      .catch((error) => setMountActionError(safeActionError(error, isMounted ? "We couldn't unmount STASH. Try again." : "We couldn't mount STASH. Try again.")))
      .finally(() => setMountBusy(false));
  };

  const openStash = useCallback(() => { setNotice(""); setDroppedSource(undefined); setStashOpen(true); }, []);
  const navigate = (item: NavItem) => {
    setStashOpen(false);
    if (item === "Settings") setSettingsSection("General");
    setActive(item);
    setNotice(item === "Recent Stashes" ? gateway.unavailable("recent-stashes") : "");
  };
  const unavailable = (capability: Parameters<DesktopGateway["unavailable"]>[0]) => setNotice(gateway.unavailable(capability) || `${capability} is planned for a later STASH capability.`);
  const search = (text: string) => { setSearchQuery({ text, at: Date.now() }); setActive("Search"); setNotice(""); };
  const stashStatus = useCallback((status: TransferStatus) => setTransfer(status), []);
  const closeStash = () => setStashOpen(false);

  let mainContent;
  if (active === "Home") {
    mainContent = (
      <HomeScreen
        gateway={gateway}
        usage={usageReady ? usage.data : null}
        device={device}
        online={online}
        mounted={mounted}
        transfer={transfer}
        dragOver={dragOver}
        onStashIt={openStash}
        onOpenFiles={() => setActive("Files")}
        onOpenRecent={() => setActive("Recent Stashes")}
        onOpenTransfers={() => setActive("Transfers")}
        onManageDevices={() => { setSettingsSection("Devices"); setActive("Settings"); }}
      />
    );
  } else if (active === "Files") {
    mainContent = <FilesScreen gateway={gateway} onUsage={(data) => setUsage({ status: "ready", data })} onMount={(data) => setMount({ status: "ready", data })} onStash={openStash} />;
  } else if (active === "Search") {
    mainContent = <SearchScreen key={searchQuery.at} gateway={gateway} initialQuery={searchQuery.text} />;
  } else if (active === "Recent Stashes") {
    mainContent = <UnavailableScreen title="Recent Stashes" message="Recent Stashes is not connected in this build yet. STASH will not invent or reuse another view for this destination." notice={notice} />;
  } else if (active === "Transfers") {
    mainContent = <TransfersScreen gateway={gateway} deviceName={device.name} onStashIt={openStash} onOpenFiles={() => setActive("Files")} />;
  } else if (active === "Offline") {
    mainContent = <OfflineScreen deviceName={device.name} onManageCache={() => { setSettingsSection("Storage & cache"); setActive("Settings"); }} onOpenFiles={() => setActive("Files")} />;
  } else if (active === "Settings") {
    mainContent = <SettingsScreen key={settingsSection} gateway={gateway} username={username} device={device} online={online} usage={usageReady ? usage.data : null} mounted={mounted} mountBusy={mountBusy} onToggleMount={toggleMount} onSignOut={onSignOut} initialSection={settingsSection} />;
  }

  return (
    <div className="app-frame">
      <NavigationRail
        active={active}
        onNavigate={navigate}
        onStash={openStash}
        usage={usageText}
        usagePercent={usagePercent}
        onRetryUsage={loadUsage}
        username={username}
        onSignOut={onSignOut}
        signOutError={signOutError}
      />
      <div className="app-workspace">
        <TopBar onSearch={search} deviceName={device.name} online={online} mounted={mounted} mountBusy={mountBusy} mountText={mountText} mountActionError={mountActionError} onToggleMount={toggleMount} />
        {notice && active !== "Recent Stashes" && <p className="app-notice" role="status">{notice}</p>}
        <div className="app-screen">
          {stashOpen
            ? <StashItScreen gateway={gateway} initialSource={droppedSource} onClose={closeStash} onStatus={stashStatus} onOpenFiles={() => { closeStash(); setActive("Files"); }} />
            : mainContent}
        </div>
      </div>
    </div>
  );
}
