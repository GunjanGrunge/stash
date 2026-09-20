import type { DesktopGateway } from "../platform/contracts";
import {
  ClockIcon,
  FolderIcon,
  HomeIcon,
  LogOutIcon,
  RefreshIcon,
  SearchIcon,
  SettingsIcon,
  StarIcon,
  ZapIcon
} from "./icons";

export const NAV_ITEMS = ["Home", "Search", "Files", "Favorites", "Recent Stashes", "Offline", "Transfers", "Settings"] as const;
type NavItem = typeof NAV_ITEMS[number];
type Capability = Parameters<DesktopGateway["unavailable"]>[0];

type Props = {
  gateway: DesktopGateway;
  active: NavItem;
  onNavigate: (item: NavItem) => void;
  onStash: () => void;
  mount: string;
  mounted: boolean;
  mountBusy: boolean;
  mountActionError?: string;
  onToggleMount: () => void;
  usage: string;
  usagePercent: number;
  username: string;
  onSignOut: () => void;
  signOutError?: string;
  notice?: string;
  onUnavailable: (capability: Capability) => void;
  onRetryUsage: () => void;
  onRetryMount: () => void;
};

function initials(name: string): string {
  const parts = name.trim().split(/[\s@.]+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

const NAV_ICONS: Record<NavItem, React.ReactNode> = {
  Home: <HomeIcon size={18} />,
  Search: <SearchIcon size={18} />,
  Files: <FolderIcon size={18} />,
  Favorites: <StarIcon size={18} />,
  "Recent Stashes": <ClockIcon size={18} />,
  Offline: <ZapIcon size={18} />,
  Transfers: <RefreshIcon size={18} />,
  Settings: <SettingsIcon size={18} />
};

export function NavigationRail({
  active,
  onNavigate,
  onStash,
  mount,
  mounted,
  mountBusy,
  mountActionError,
  onToggleMount,
  usage,
  usagePercent,
  username,
  onSignOut,
  signOutError,
  notice,
  onUnavailable,
  onRetryUsage,
  onRetryMount
}: Props) {
  return (
    <aside className="rail" aria-label="STASH navigation">
      {/* Brand Header */}
      <div className="rail-brand">
        <svg className="rail-logo-svg" viewBox="0 0 1200 300" aria-label="STASH Logo">
          <defs>
            <linearGradient id="rail-g" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#38BDF8" />
              <stop offset="100%" stopColor="#7C3AED" />
            </linearGradient>
          </defs>
          <g transform="translate(15 20) scale(.255)">
            <polygon points="298,225 429,225 315,798 184,798" fill="url(#rail-g)" />
            <polygon points="486,225 617,225 503,798 372,798" fill="url(#rail-g)" />
            <polygon points="577,798 714,798 675,661" fill="url(#rail-g)" />
          </g>
          <text x="290" y="190" fill="currentColor" fontFamily="Inter, Arial, sans-serif" fontSize="118" fontWeight="700" letterSpacing="14">
            STASH
          </text>
        </svg>
      </div>

      {/* Primary CTA */}
      <button className="stash-primary-cta" type="button" onClick={onStash}>
        + Stash it
      </button>

      {/* Navigation List */}
      <nav className="nav-list">
        {NAV_ITEMS.map((item) => (
          <button
            key={item}
            className={`nav-item ${active === item ? "is-active" : ""}`}
            type="button"
            aria-current={active === item ? "page" : undefined}
            onClick={() => onNavigate(item)}
          >
            <span className="nav-icon">{NAV_ICONS[item]}</span>
            <span className="nav-label">{item === "Search" ? "Search your STASH..." : item}</span>
          </button>
        ))}
      </nav>
      {notice && <p className="rail-notice" role="status">{notice}</p>}
      {/* Bottom Mount, Profile & Storage Widget */}
      <div className="rail-footer">
        <div className="mount-widget" aria-live="polite">
          <div className="mount-label-row">
            <span>{mount}</span>
          </div>
          <button
            type="button"
            className="button button-primary button-sm mount-toggle"
            onClick={onToggleMount}
            disabled={mountBusy}
          >
            {mountBusy ? (mounted ? "Unmounting…" : "Mounting…") : mounted ? "Unmount STASH" : "Mount STASH"}
          </button>
          {mountActionError && <p className="mount-action-error">{mountActionError}</p>}
          <button type="button" className="link-btn mount-refresh" onClick={onRetryMount}>Refresh mount status</button>
        </div>

        <div className="storage-widget">
          <div className="storage-label-row">
            <span>{usage}</span>
          </div>
          <div className="storage-track">
            <div className="storage-fill" style={{ width: `${Math.min(100, Math.max(0, usagePercent))}%` }} />
          </div>
          <button type="button" className="link-btn storage-refresh" onClick={onRetryUsage}>Refresh storage status</button>
        </div>

        <div className="user-profile-card">
          <div className="user-avatar">{initials(username)}</div>
          <div className="user-details">
            <strong className="user-name">{username}</strong>
          </div>
          <button type="button" className="signout-icon-btn" onClick={onSignOut} title="Sign out" aria-label="Sign out">
            <LogOutIcon size={16} />
          </button>
        </div>
      </div>
    </aside>
  );
}
