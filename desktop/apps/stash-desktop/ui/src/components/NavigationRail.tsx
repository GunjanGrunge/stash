import { useEffect, useRef, useState } from "react";
import stashSymbol from "../assets/brand/stash-symbol.svg";
import arrowUpDownIcon from "../assets/figma/shell/arrow-up-down.svg";
import avatarImage from "../assets/figma/shell/avatar.svg";
import chevronsIcon from "../assets/figma/shell/chevrons-up-down.svg";
import folderIcon from "../assets/figma/shell/folder.svg";
import historyIcon from "../assets/figma/shell/history.svg";
import houseIcon from "../assets/figma/shell/house.svg";
import pinIcon from "../assets/figma/shell/pin.svg";
import searchIcon from "../assets/figma/shell/search-nav.svg";
import settingsIcon from "../assets/figma/shell/settings.svg";

/** Figma sidebar order (node 3:24395). */
export const NAV_ITEMS = ["Home", "Files", "Search", "Recent Stashes", "Offline", "Transfers", "Settings"] as const;
export type NavItem = typeof NAV_ITEMS[number];

const NAV_ICONS: Record<NavItem, string> = {
  Home: houseIcon,
  Files: folderIcon,
  Search: searchIcon,
  "Recent Stashes": historyIcon,
  Offline: pinIcon,
  Transfers: arrowUpDownIcon,
  Settings: settingsIcon,
};

type Props = {
  active: NavItem;
  onNavigate: (item: NavItem) => void;
  onStash: () => void;
  /** e.g. "624 GB of 1 TB", or why storage is unavailable. */
  usage: string;
  /** 0–100, or null while unknown. */
  usagePercent: number | null;
  onRetryUsage: () => void;
  username: string;
  onSignOut: () => void;
  signOutError?: string;
};

/** Monochrome Figma icon, tinted by `currentColor` so the active item turns lime. */
export function MaskIcon({ src, size }: { src: string; size: number }) {
  return <span className="mask-icon" aria-hidden="true" style={{ width: size, height: size, WebkitMaskImage: `url("${src}")`, maskImage: `url("${src}")` }} />;
}

/** Figma "Sidebar" (node 3:24388). */
export function NavigationRail({ active, onNavigate, onStash, usage, usagePercent, onRetryUsage, username, onSignOut, signOutError }: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const profile = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (event: MouseEvent) => { if (!profile.current?.contains(event.target as Node)) setMenuOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [menuOpen]);

  const known = usagePercent !== null;
  return (
    <aside className="sidebar" aria-label="STASH navigation">
      <div className="sidebar-brand">
        <img className="sidebar-brand-mark" src={stashSymbol} width={26} height={28} alt="" />
        <span className="sidebar-brand-name">STASH</span>
      </div>

      <button className="button button-primary sidebar-stash" type="button" onClick={onStash}>
        +&nbsp;&nbsp;Stash it
      </button>

      <nav className="sidebar-nav">
        {NAV_ITEMS.map((item) => (
          <button
            key={item}
            className={`sidebar-nav-item${active === item ? " is-active" : ""}`}
            type="button"
            aria-current={active === item ? "page" : undefined}
            onClick={() => onNavigate(item)}
          >
            <MaskIcon src={NAV_ICONS[item]} size={18} />
            <span className="sidebar-nav-label">{item}</span>
            {active === item && <span className="sidebar-active-mark" aria-hidden="true" />}
          </button>
        ))}
      </nav>

      <div className="sidebar-spacer" />

      <button type="button" className="sidebar-storage" onClick={onRetryUsage} title="Refresh storage">
        <span className="sidebar-storage-heading">
          <span>Storage</span>
          {known && <span className="sidebar-storage-percent">{Math.round(usagePercent)}%</span>}
        </span>
        <span className="sidebar-storage-bar" aria-hidden="true">
          <span style={{ width: `${Math.min(100, Math.max(0, usagePercent ?? 0))}%` }} />
        </span>
        <span className="sidebar-storage-value">{usage}</span>
      </button>

      <div className="sidebar-profile" ref={profile}>
        <button type="button" className="sidebar-profile-button" aria-haspopup="menu" aria-expanded={menuOpen} onClick={() => setMenuOpen((open) => !open)}>
          <img src={avatarImage} width={30} height={30} alt="" />
          <span className="sidebar-profile-copy">
            <span className="sidebar-profile-name">{username}</span>
            <span className="sidebar-profile-plan">Private beta</span>
          </span>
          <img src={chevronsIcon} width={14} height={14} alt="" />
        </button>
        {menuOpen && (
          <div className="sidebar-profile-menu" role="menu">
            <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); onSignOut(); }}>Sign out</button>
          </div>
        )}
        {signOutError && <p className="sidebar-error" role="alert">{signOutError}</p>}
      </div>
    </aside>
  );
}
