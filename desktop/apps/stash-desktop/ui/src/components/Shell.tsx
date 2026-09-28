import { useCallback, useEffect, useState } from "react";
import type { CapabilityState, MountStatus, NativeDropNotice, SourceSummary, TransferStatus, Usage } from "../domain/types";
import type { DesktopGateway } from "../platform/contracts";
import { safeActionError } from "../platform/tauri/gateway";
import { FilesScreen, formatBytes } from "./FilesScreen";
import { HomeScreen } from "./HomeScreen";
import { NavigationRail, type NavItem } from "./NavigationRail";
import { OfflineScreen } from "./OfflineScreen";
import { SearchScreen } from "./SearchScreen";
import { SettingsScreen } from "./SettingsScreen";
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
};

/** Figma frame: 232px sidebar, then a 72px top bar over the active screen. */
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
  const [searchQuery, setSearchQuery] = useState({ text: "", at: 0 });

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

  const usageReady = usage.status === "ready" || usage.status === "stale";
  const usageText = usageReady ? `${formatBytes(usage.data.usedBytes)} of ${formatBytes(usage.data.quotaBytes)}` : usage.status === "offline" ? (usage.message || "Storage unavailable") : "Loading storage…";
  const usagePercent = usageReady && usage.data.quotaBytes ? ((usage.data.usedBytes ?? 0) / usage.data.quotaBytes) * 100 : null;
  const mounted = (mount.status === "ready" || mount.status === "stale") && mount.data.mounted;
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
    mainContent = <SearchScreen key={searchQuery.at} gateway={gateway} initialQuery={searchQuery.text} />;
  } else if (active === "Recent Stashes") {
    mainContent = <UnavailableScreen title="Recent Stashes" message="Recent Stashes is not connected in this build yet. STASH will not invent or reuse another view for this destination." notice={notice} />;
  } else if (active === "Transfers") {
    mainContent = <TransfersScreen />;
  } else if (active === "Offline") {
    mainContent = <OfflineScreen />;
  } else if (active === "Settings") {
    mainContent = <SettingsScreen username={username} />;
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
        <TopBar onSearch={search} mounted={mounted} mountBusy={mountBusy} mountText={mountText} mountActionError={mountActionError} onToggleMount={toggleMount} />
        {notice && active !== "Recent Stashes" && <p className="app-notice" role="status">{notice}</p>}
        <div className="app-screen">{mainContent}</div>
      </div>
      {stashOpen && <StashItScreen gateway={gateway} initialSource={droppedSource} onClose={closeStash} onStatus={stashStatus} />}
    </div>
  );
}
