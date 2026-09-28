import { useCallback, useEffect, useState } from "react";
import type { CapabilityState, MountStatus, NativeDropNotice, SourceSummary, TransferStatus, Usage } from "../domain/types";
import type { DesktopGateway } from "../platform/contracts";
import { safeActionError } from "../platform/tauri/gateway";
import { FilesScreen, formatBytes } from "./FilesScreen";
import { HomeScreen } from "./HomeScreen";
import { NavigationRail, NAV_ITEMS } from "./NavigationRail";
import { OfflineScreen } from "./OfflineScreen";
import { SearchScreen } from "./SearchScreen";
import { SettingsScreen } from "./SettingsScreen";
import { StashItScreen } from "./StashItScreen";
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
};

type NavItem = typeof NAV_ITEMS[number];

export function Shell({ gateway, username, onSignOut, signOutError = "", initialScreen = "Home", initialStashOpen = false }: Props) {
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

  const loadUsage = () => {
    setUsage({ status: "loading" });
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

  const usageText = usage.status === "ready" || usage.status === "stale" ? `${formatBytes(usage.data.usedBytes)} of ${formatBytes(usage.data.quotaBytes)}` : usage.status === "offline" ? (usage.message || "Storage unavailable") : "Loading storage…";
  const usagePercent = (usage.status === "ready" || usage.status === "stale") && usage.data.quotaBytes ? ((usage.data.usedBytes ?? 0) / usage.data.quotaBytes) * 100 : 0;
  const mounted = (mount.status === "ready" || mount.status === "stale") && mount.data.mounted;
  const mountText = mount.status === "ready" || mount.status === "stale" ? (mount.data.mounted ? `Mounted (${mount.data.letter ?? "S"}:)` : "Not mounted") : mount.status === "offline" ? (mount.message || "Mount unavailable") : "Loading drive…";

  const toggleMount = () => {
    if (mount.status !== "ready" && mount.status !== "stale") return;
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
    setActive(item);
    const capability = item === "Recent Stashes" ? "recent-stashes" : undefined;
    setNotice(capability ? gateway.unavailable(capability) : "");
  };
  const unavailable = (capability: Parameters<DesktopGateway["unavailable"]>[0]) => setNotice(gateway.unavailable(capability) || `${capability} is planned for a later STASH capability. Offline view is not available in this build yet`);
  const stashStatus = useCallback((status: TransferStatus) => setTransfer(status), []);
  const closeStash = () => setStashOpen(false);

  let mainContent;
  if (active === "Home") {
    mainContent = (
      <HomeScreen
        username={username}
        usage={usageText}
        mount={mountText}
        onStashIt={openStash}
        onOpenFiles={() => setActive("Files")}
        onUnavailable={unavailable}
        transfer={transfer}
        dragOver={dragOver}
      />
    );
  } else if (active === "Files") {
    mainContent = <FilesScreen gateway={gateway} onUsage={(data) => setUsage({ status: "ready", data })} onMount={(data) => setMount({ status: "ready", data })} onStash={openStash} />;
  } else if (active === "Search") {
    mainContent = <SearchScreen gateway={gateway} />;
  } else if (active === "Favorites" || active === "Recent Stashes") {
    const title = active === "Recent Stashes" ? "Recent Stashes" : active;
    mainContent = <UnavailableScreen title={title} message={`${title} is not connected in this build yet. STASH will not invent or reuse another view for this destination.`} notice={notice} />;
  } else if (active === "Transfers") {
    mainContent = <TransfersScreen />;
  } else if (active === "Offline") {
    mainContent = <OfflineScreen />;
  } else if (active === "Settings") {
    mainContent = <SettingsScreen username={username} />;
  }

  return (
    <div className="app-main-layout">
      <NavigationRail
        gateway={gateway}
        active={active}
        onNavigate={navigate}
        onStash={openStash}
        mount={mountText}
        mounted={mounted}
        mountBusy={mountBusy}
        mountActionError={mountActionError}
        onToggleMount={toggleMount}
        usage={usageText}
        usagePercent={usagePercent}
        username={username}
        onSignOut={onSignOut}
        signOutError={signOutError}
        notice={notice}
        onUnavailable={unavailable}
        onRetryUsage={loadUsage}
        onRetryMount={loadMount}
      />
      {mainContent}
      {stashOpen && <StashItScreen gateway={gateway} initialSource={droppedSource} onClose={closeStash} onStatus={stashStatus} />}
    </div>
  );
}
