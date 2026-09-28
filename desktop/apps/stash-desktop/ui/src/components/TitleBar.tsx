import type { DesktopGateway } from "../platform/contracts";

type Props = {
  gateway: DesktopGateway;
};

/**
 * The frameless window's drag strip and window controls. Not part of the
 * Figma frames (they show the app without window chrome), so it stays thin
 * and in the frame's own surface colour.
 */
export function TitleBar({ gateway }: Props) {
  return (
    <header
      className="titlebar"
      data-window-drag-region
      onMouseDown={(event) => {
        if ((event.target as HTMLElement).closest("button, a, input")) return;
        void gateway.window.startDragging();
      }}
    >
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
    </header>
  );
}
