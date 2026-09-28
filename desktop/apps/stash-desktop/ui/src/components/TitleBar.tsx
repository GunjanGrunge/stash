import type { DesktopGateway } from "../platform/contracts";

type Props = {
  gateway: DesktopGateway;
  theme: "dark" | "light";
  onToggleTheme: () => void;
  onReplaySplash?: () => void;
};

export function TitleBar({ gateway, theme, onToggleTheme, onReplaySplash }: Props) {
  return (
    <header
      className="titlebar"
      data-window-drag-region
      onMouseDown={(event) => {
        if ((event.target as HTMLElement).closest("button, a, input")) return;
        void gateway.window.startDragging();
      }}
    >
      <div className="titlebar-brand">
        <svg className="titlebar-logo-svg" viewBox="0 0 1200 300" aria-label="STASH Logo">
          <defs>
            <linearGradient id="tb-g" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#38BDF8" />
              <stop offset="100%" stopColor="#7C3AED" />
            </linearGradient>
          </defs>
          <g transform="translate(15 20) scale(.255)">
            <polygon points="298,225 429,225 315,798 184,798" fill="url(#tb-g)" />
            <polygon points="486,225 617,225 503,798 372,798" fill="url(#tb-g)" />
            <polygon points="577,798 714,798 675,661" fill="url(#tb-g)" />
          </g>
          <text x="290" y="190" fill="currentColor" fontFamily="Inter, Arial, sans-serif" fontSize="118" fontWeight="700" letterSpacing="14">
            STASH
          </text>
        </svg>
      </div>

      <div className="titlebar-actions">
        {onReplaySplash && (
          <button
            type="button"
            className="titlebar-action-btn"
            onClick={onReplaySplash}
            title="Replay Splash Screen Animation"
          >
            ✨ Splash
          </button>
        )}

        <button
          type="button"
          className="theme-toggle-btn"
          onClick={onToggleTheme}
          title={`Switch to ${theme === "dark" ? "Light" : "Dark"} Mode`}
        >
          {theme === "dark" ? "☀️ Light" : "🌙 Dark"}
        </button>

        <div className="window-controls" aria-label="Window controls">
          <button className="window-control" type="button" aria-label="Minimize window" title="Minimize" onClick={() => void gateway.window.act("minimize")}>
            <svg className="window-icon" viewBox="0 0 12 12" aria-hidden="true"><path d="M2 6h8" /></svg>
          </button>
          <button className="window-control" type="button" aria-label="Maximize or restore window" title="Maximize or restore" onClick={() => void gateway.window.act("toggle-maximize")}>
            <svg className="window-icon" viewBox="0 0 12 12" aria-hidden="true"><rect x="2" y="2" width="8" height="8" /></svg>
          </button>
          <button className="window-control window-control-close" type="button" aria-label="Hide STASH to tray" title="Hide STASH to tray" onClick={() => void gateway.window.act("close")}>
            <svg className="window-icon" viewBox="0 0 12 12" aria-hidden="true"><path d="m2.5 2.5 7 7m0-7-7 7" /></svg>
          </button>
        </div>
      </div>
    </header>
  );
}
