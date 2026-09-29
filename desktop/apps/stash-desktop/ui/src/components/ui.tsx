// Shared Figma components used across screens. Values follow the Figma
// "stash" file; screens compose these instead of restyling each page.
import type { ReactNode } from "react";
import audioWaveformIcon from "../assets/figma/common/audio-waveform.svg";
import dotGreen from "../assets/figma/common/dot-green.svg";
import dotGrey from "../assets/figma/common/dot-grey.svg";
import dotLime from "../assets/figma/common/dot-lime.svg";
import dotViolet from "../assets/figma/common/dot-violet.svg";
import fileIcon from "../assets/figma/common/file.svg";
import filmIcon from "../assets/figma/common/film.svg";
import hardDriveIcon from "../assets/figma/common/hard-drive.svg";
import imageIcon from "../assets/figma/common/image.svg";
import type { SearchKind } from "../domain/types";

/** Figma "Page header": mono lime eyebrow, 32px title, description, actions. */
export function PageHeader({ eyebrow, title, description, actions }: { eyebrow?: string; title: string; description?: string; actions?: ReactNode }) {
  return (
    <header className="ui-page-header">
      <div className="ui-page-header-copy">
        {eyebrow && <p className="ui-eyebrow">{eyebrow}</p>}
        <h1>{title}</h1>
        {description && <p className="ui-page-description">{description}</p>}
      </div>
      {actions && <div className="ui-page-actions">{actions}</div>}
    </header>
  );
}

/** Screen body: Figma "Screen content" (28/32/32 padding, 24 gap). */
export function Screen({ children, label }: { children: ReactNode; label: string }) {
  return <section className="ui-screen" aria-label={label}>{children}</section>;
}

/** Figma "Stat card". */
export function StatCard({ label, icon, value, sub, highlight = false }: { label: string; icon?: string; value: string; sub: string; highlight?: boolean }) {
  return (
    <div className={`ui-stat${highlight ? " is-highlight" : ""}`}>
      <div className="ui-stat-heading">
        <span>{label}</span>
        {icon && <img src={icon} width={17} height={17} alt="" />}
      </div>
      <p className="ui-stat-value">{value}</p>
      <p className="ui-stat-sub">{sub}</p>
    </div>
  );
}

export function Panel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`ui-panel ${className}`}>{children}</div>;
}

/** Figma "Section title": 16px title with a lime aside on the right. */
export function SectionTitle({ title, aside, tone = "accent" }: { title: string; aside?: string; tone?: "accent" | "green" | "muted" }) {
  return (
    <div className="ui-section-title">
      <h2>{title}</h2>
      {aside && <span className={`ui-aside is-${tone}`}>{aside}</span>}
    </div>
  );
}

export type StateTone = "stashing" | "available" | "cloud" | "pinned" | "issue";
const STATE_DOTS: Record<StateTone, string> = { stashing: dotLime, available: dotGreen, cloud: dotGrey, pinned: dotViolet, issue: dotGrey };

/** Figma "State tag": pill with a coloured dot. */
export function StateTag({ tone, label }: { tone: StateTone; label: string }) {
  return (
    <span className={`ui-state is-${tone}`}>
      <img src={STATE_DOTS[tone]} width={6} height={6} alt="" />
      {label}
    </span>
  );
}

/** Figma asset icon for a media kind (colours baked into the exports). */
export function kindIcon(kind: SearchKind | "folder" | undefined): string {
  if (kind === "audio" || kind === "midi") return audioWaveformIcon;
  if (kind === "video") return filmIcon;
  if (kind === "image") return imageIcon;
  return fileIcon;
}

/** Bar heights from the Figma "Waveform" frame. Decorative, not the real audio. */
export const WAVE_BARS = [8, 15, 23, 12, 30, 20, 10, 25, 16, 28, 12, 21, 8, 18];

export function Waveform() {
  return <span className="ui-waveform" aria-hidden="true">{WAVE_BARS.map((h, i) => <span key={i} style={{ height: h }} />)}</span>;
}

/** Figma "Asset row" (60px) used on Home, Offline and Search. */
export function AssetRow({ kind, name, meta, type, tag, waveform = false, onOpen }: { kind?: SearchKind | "folder"; name: string; meta: string; type: string; tag?: ReactNode; waveform?: boolean; onOpen?: () => void }) {
  return (
    <div className="ui-asset-row" onDoubleClick={onOpen}>
      <span className="ui-asset-icon"><img src={kindIcon(kind)} width={18} height={18} alt="" /></span>
      <span className="ui-asset-identity">
        <span className="ui-asset-name" title={name}>{name}</span>
        <span className="ui-asset-meta" title={meta}>{meta}</span>
      </span>
      <span className="ui-asset-preview">{waveform && <Waveform />}</span>
      <span className="ui-asset-type">{type}</span>
      <span className="ui-asset-state">{tag}</span>
    </div>
  );
}

/** A Figma-styled row that says, plainly, that there is nothing here yet. */
export function EmptyRow({ title, copy, action }: { title: string; copy: string; action?: ReactNode }) {
  return (
    <div className="ui-empty">
      <span className="ui-empty-copy">
        <span className="ui-empty-title">{title}</span>
        <span className="ui-empty-text">{copy}</span>
      </span>
      {action}
    </div>
  );
}

/** Figma "Toggle" (38×22, lime when on). */
export function Toggle({ checked, disabled = false, onChange, label }: { checked: boolean; disabled?: boolean; onChange?: (next: boolean) => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} className={`ui-toggle${checked ? " is-on" : ""}`} disabled={disabled} onClick={() => onChange?.(!checked)}>
      <span />
    </button>
  );
}

/** Figma "Setting row": title + description, control on the right. */
export function SettingRow({ title, copy, control, soon = false }: { title: string; copy: string; control: ReactNode; soon?: boolean }) {
  return (
    <div className="ui-setting-row">
      <span className="ui-setting-copy">
        <span className="ui-setting-title">{title}{soon && <span className="ui-soon">Coming soon</span>}</span>
        <span className="ui-setting-text">{copy}</span>
      </span>
      {control}
    </div>
  );
}

/** Figma "Setting value": read-only value chip. */
export function SettingValue({ children }: { children: ReactNode }) {
  return <span className="ui-setting-value">{children}</span>;
}

/** Figma footer / info bar. */
export function InfoBar({ icon, children, action }: { icon: string; children: ReactNode; action?: ReactNode }) {
  return (
    <div className="ui-infobar">
      <img src={icon} width={18} height={18} alt="" />
      <p>{children}</p>
      {action}
    </div>
  );
}

/**
 * Figma "Filesystem browser" breadcrumb: STASH root, each parent folder as a
 * link back, the open folder as the current page, and its item count.
 * `onNavigate(-1)` returns to the root; `onNavigate(i)` to `trail[i]`.
 */
export function Breadcrumb({ trail, onNavigate, itemCount }: { trail: readonly { id: string; name: string }[]; onNavigate: (index: number) => void; itemCount?: number }) {
  const last = trail.length - 1;
  return (
    <nav className="ui-breadcrumb" aria-label="Folder path">
      <ol>
        <li>
          {last < 0 ? (
            <span className="ui-breadcrumb-root" aria-current="page"><img src={hardDriveIcon} width={16} height={16} alt="" />STASH</span>
          ) : (
            <button type="button" className="ui-breadcrumb-root" onClick={() => onNavigate(-1)}><img src={hardDriveIcon} width={16} height={16} alt="" />STASH</button>
          )}
        </li>
        {trail.map((crumb, index) => (
          <li key={`${crumb.id}-${index}`}>
            {index === last ? (
              <span aria-current="page" title={crumb.name}>{crumb.name}</span>
            ) : (
              <button type="button" title={crumb.name} onClick={() => onNavigate(index)}>{crumb.name}</button>
            )}
          </li>
        ))}
      </ol>
      {itemCount !== undefined && <span className="ui-breadcrumb-count">{itemCount.toLocaleString()} {itemCount === 1 ? "item" : "items"}</span>}
    </nav>
  );
}

/** Relative time like Figma's "2 min ago", from an ISO timestamp. */
export function timeAgo(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "";
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return "";
  const minutes = Math.max(0, Math.round((now - then) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? "yesterday" : `${days} days ago`;
}
