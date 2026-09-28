import { useState } from "react";
import databaseIcon from "../assets/figma/common/database.svg";
import infoIcon from "../assets/figma/common/info.svg";
import pinButtonIcon from "../assets/figma/common/pin-16.svg";
import pinIcon from "../assets/figma/common/pin-17.svg";
import settingsIcon from "../assets/figma/common/settings-2.svg";
import shieldIcon from "../assets/figma/common/shield-check.svg";
import wifiOffIcon from "../assets/figma/common/wifi-off.svg";
import { EmptyRow, InfoBar, PageHeader, Screen, StatCard } from "./ui";

type Filter = "All pinned" | "Audio" | "Video" | "Projects";
const FILTERS: Filter[] = ["All pinned", "Audio", "Video", "Projects"];

type Props = { deviceName: string; onManageCache: () => void; onOpenFiles: () => void };

/**
 * Figma "Offline pinned assets" (6:5). "Keep on this device" isn't built
 * yet, so every figure is the true zero and the list says so plainly.
 */
export function OfflineScreen({ deviceName, onManageCache, onOpenFiles }: Props) {
  const [filter, setFilter] = useState<Filter>("All pinned");
  return (
    <Screen label="Offline assets">
      <PageHeader
        eyebrow={`Pinned on ${deviceName}`}
        title="Offline assets"
        description="These files stay local and ready even when your workstation loses connection."
        actions={<button type="button" className="button button-secondary" onClick={onManageCache}><img src={settingsIcon} width={16} height={16} alt="" />Manage cache</button>}
      />
      <div className="ui-stats">
        <StatCard label="Pinned offline" icon={pinIcon} value="0 B" sub="0 assets" />
        <StatCard label="Available cache" icon={databaseIcon} value="0 B" sub="Nothing cached on this device yet" />
        <StatCard label="Last verified" icon={shieldIcon} value="—" sub="Nothing pinned to verify" />
        <div className="ui-readiness">
          <div className="ui-readiness-heading">
            <img src={wifiOffIcon} width={18} height={18} alt="" />
            <span>NOT READY OFFLINE</span>
          </div>
          <p className="ui-readiness-title">Nothing is kept here yet</p>
          <p className="ui-readiness-copy">Keep on this device is coming soon. Until then, files open from the cloud.</p>
        </div>
      </div>
      <div className="ui-toolbar">
        {FILTERS.map((item) => (
          <button key={item} type="button" className={`button button-secondary ui-filter${filter === item ? " is-active" : ""}`} aria-pressed={filter === item} onClick={() => setFilter(item)}>
            {item === "All pinned" && <img src={pinButtonIcon} width={16} height={16} alt="" />}
            {item}
          </button>
        ))}
        <span className="ui-toolbar-spacer" />
        <span className="ui-toolbar-count">0 assets</span>
      </div>
      <div className="ui-list">
        <EmptyRow
          title={filter === "All pinned" ? "Nothing is pinned on this device" : `No ${filter.toLowerCase()} pinned on this device`}
          copy="Pinning (Keep on this device) is coming soon. Your Stashed files are all in the cloud and open on demand from S:."
          action={<button type="button" className="button button-secondary" onClick={onOpenFiles}>Browse Files</button>}
        />
      </div>
      <InfoBar icon={infoIcon} action={<button type="button" className="button button-secondary" disabled>Unpin selected</button>}>
        Pinned assets never leave this device automatically. Unpin to make them eligible for cache cleanup.
      </InfoBar>
    </Screen>
  );
}
