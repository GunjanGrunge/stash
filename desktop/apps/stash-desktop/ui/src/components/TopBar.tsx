import { useEffect, useRef, useState } from "react";
import bellIcon from "../assets/figma/shell/bell.svg";
import onlineIndicator from "../assets/figma/shell/online-indicator.svg";
import searchIcon from "../assets/figma/shell/search.svg";

type Props = {
  /** Opens Search with the typed query. */
  onSearch: (query: string) => void;
  mounted: boolean;
  mountBusy: boolean;
  /** e.g. "S: mounted", "Not mounted", or why mount status is unavailable. */
  mountText: string;
  mountActionError?: string;
  onToggleMount: () => void;
};

/**
 * Figma "Top bar" (node 3:24433). Figma's device-status slot shows this
 * PC's S: drive: the drive is the device's connection to STASH, and it
 * needs a control somewhere in the frame.
 */
export function TopBar({ onSearch, mounted, mountBusy, mountText, mountActionError, onToggleMount }: Props) {
  const [query, setQuery] = useState("");
  const [bellOpen, setBellOpen] = useState(false);
  const input = useRef<HTMLInputElement>(null);

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
        <button type="button" className={`topbar-device${mounted ? " is-mounted" : ""}`} onClick={onToggleMount} disabled={mountBusy} title={mounted ? "Unmount the S: drive" : "Mount STASH as the S: drive"}>
          {mounted ? <img src={onlineIndicator} width={7} height={7} alt="" /> : <span className="topbar-device-dot" aria-hidden="true" />}
          <span>{mountBusy ? (mounted ? "Unmounting…" : "Mounting…") : mountText}</span>
        </button>
        <div className="topbar-bell-wrap">
          <button type="button" className="topbar-bell" aria-label="Notifications" aria-expanded={bellOpen} onClick={() => setBellOpen((open) => !open)}>
            <img src={bellIcon} width={17} height={17} alt="" />
          </button>
          {bellOpen && <div className="topbar-popover" role="status">You're all caught up.</div>}
        </div>
      </div>
      {mountActionError && <p className="topbar-error" role="alert">{mountActionError}</p>}
    </header>
  );
}
