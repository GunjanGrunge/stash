import { useEffect, useRef, useState } from "react";
import bellIcon from "../assets/figma/shell/bell.svg";
import onlineIndicator from "../assets/figma/shell/online-indicator.svg";
import searchIcon from "../assets/figma/shell/search.svg";

type Props = {
  /** Opens Search with the typed query. */
  onSearch: (query: string) => void;
  /** This workstation's name, shown in Figma's device-status slot. */
  deviceName: string;
  /** Whether this PC can currently reach STASH. */
  online: boolean;
  mounted: boolean;
  mountBusy: boolean;
  /** e.g. "S: mounted", "Mount S:", or why mount status is unavailable. */
  mountText: string;
  mountActionError?: string;
  onToggleMount: () => void;
};

function useDismiss(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => { if (!ref.current?.contains(event.target as Node)) close(); };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open, close]);
  return ref;
}

/** Figma "Top bar" (node 3:24433). */
export function TopBar({ onSearch, deviceName, online, mounted, mountBusy, mountText, mountActionError, onToggleMount }: Props) {
  const [query, setQuery] = useState("");
  const [menu, setMenu] = useState<"device" | "bell" | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const deviceRef = useDismiss(menu === "device", () => setMenu(null));
  const bellRef = useDismiss(menu === "bell", () => setMenu(null));

  useEffect(() => {
    const focusSearch = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        input.current?.focus();
      }
    };
    window.addEventListener("keydown", focusSearch);
    return () => window.removeEventListener("keydown", focusSearch);
  }, []);

  return (
    <header className="topbar">
      <form className="topbar-search" role="search" onSubmit={(event) => { event.preventDefault(); if (query.trim()) onSearch(query.trim()); }}>
        <img src={searchIcon} width={17} height={17} alt="" />
        <input ref={input} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search your STASH…" aria-label="Search your STASH" maxLength={200} spellCheck={false} />
        <kbd>Ctrl K</kbd>
      </form>
      <div className="topbar-actions">
        <div className="topbar-menu-wrap" ref={deviceRef}>
          <button type="button" className="topbar-device" aria-haspopup="dialog" aria-expanded={menu === "device"} onClick={() => setMenu(menu === "device" ? null : "device")} title={online ? `${deviceName} is online` : `${deviceName} can't reach STASH`}>
            {online ? <img src={onlineIndicator} width={7} height={7} alt="" /> : <span className="topbar-device-dot" aria-hidden="true" />}
            <span>{deviceName}</span>
          </button>
          {menu === "device" && (
            <div className="topbar-popover topbar-device-menu" role="dialog" aria-label="This device">
              <p className="topbar-popover-title">{deviceName}</p>
              <p>{online ? "Online · connected to STASH" : "Offline · can't reach STASH"}</p>
              <div className="topbar-drive-row">
                <span><strong>S: drive</strong> · {mountBusy ? (mounted ? "Unmounting…" : "Mounting…") : mounted ? "Mounted in File Explorer" : "Not mounted"}</span>
                <button type="button" className="button button-secondary button-sm" disabled={mountBusy} onClick={onToggleMount}>{mounted ? "Unmount" : "Mount"}</button>
              </div>
              {!mounted && !mountBusy && mountText !== "Mount S:" && <p className="topbar-popover-note">{mountText}</p>}
              {mountActionError && <p className="topbar-popover-error" role="alert">{mountActionError}</p>}
            </div>
          )}
        </div>
        <div className="topbar-menu-wrap" ref={bellRef}>
          <button type="button" className="topbar-bell" aria-label="Notifications" aria-expanded={menu === "bell"} onClick={() => setMenu(menu === "bell" ? null : "bell")}>
            <img src={bellIcon} width={17} height={17} alt="" />
          </button>
          {menu === "bell" && <div className="topbar-popover" role="status">You're all caught up.</div>}
        </div>
      </div>
    </header>
  );
}
