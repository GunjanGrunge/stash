import type { TransferStatus } from "../domain/types";
import { CloudUploadIcon, FolderIcon, HeadphonesIcon, MusicIcon, VideoIcon } from "./icons";

type Props = {
  username: string;
  usage: string;
  mount: string;
  onStashIt: () => void;
  onOpenFiles: () => void;
  onUnavailable: (capability: "recent-stashes" | "transfers" | "offline") => void;
  transfer?: TransferStatus;
  dragOver?: boolean;
};

const RECENT_STASHES = [
  { id: "1", name: "KSHMR Vol 5", count: "12,482 files", size: "176 GB", date: "2 days ago", color: "purple", device: "Gunjan-PC" },
  { id: "2", name: "Client Reels", count: "842 files", size: "48.7 GB", date: "5 days ago", color: "violet", device: "MacBook" },
  { id: "3", name: "Stock Footage", count: "3,201 files", size: "126 GB", date: "1 week ago", color: "amber", device: "Gunjan-PC" },
  { id: "4", name: "SFX Library", count: "1,284 files", size: "31.2 GB", date: "1 week ago", color: "emerald", device: "Studio PC" }
];

export function HomeScreen({ username, usage, mount, onStashIt, onOpenFiles, onUnavailable, dragOver }: Props) {
  return (
    <main className="workspace home-workspace" aria-labelledby="home-heading">
      {/* 16:9 Hero Banner */}
      <section className="stash-hero-card">
        <div className="stash-hero-content">
          <div className="stash-hero-copy">
            <h1 id="home-heading" className="stash-hero-title">
              STASH IT
            </h1>
            <p className="stash-hero-sub">Your creative assets. Everywhere.</p>
            <span className="stash-tag-badge">More space. More ideas. Same you.</span>
          </div>

          {/* Interactive Drag Dropzone */}
          <div className={`stash-dropzone-card${dragOver ? " is-drag-over" : ""}`} aria-live="polite">
            <div className="dropzone-cloud-icon" aria-hidden="true">
              <CloudUploadIcon size={32} />
            </div>
            <strong className="dropzone-title">{dragOver ? "Release to prepare this source" : "Drag files or folders here"}</strong>
            <p className="dropzone-sub">Keep your folder structure. Find it anywhere.</p>
            <button className="button button-primary stash-cta-btn" type="button" onClick={onStashIt}>
              STASH IT &rarr;
            </button>
          </div>
        </div>
      </section>

      {/* Quick Access Categories */}
      <section className="categories-section">
        <h2 className="section-title">Quick Access</h2>
        <div className="category-grid">
          <div className="category-card category-purple" onClick={onOpenFiles}>
            <span className="cat-icon cat-icon-music"><MusicIcon size={24} /></span>
            <div className="cat-info">
              <strong>Music Samples</strong>
              <span>12.4 GB &bull; 3 stashes</span>
            </div>
          </div>
          <div className="category-card category-blue" onClick={onOpenFiles}>
            <span className="cat-icon cat-icon-video"><VideoIcon size={24} /></span>
            <div className="cat-info">
              <strong>Video Footage</strong>
              <span>126 GB &bull; 8 stashes</span>
            </div>
          </div>
          <div className="category-card category-amber" onClick={onOpenFiles}>
            <span className="cat-icon cat-icon-folder"><FolderIcon size={24} /></span>
            <div className="cat-info">
              <strong>Client Work</strong>
              <span>48.7 GB &bull; 5 stashes</span>
            </div>
          </div>
          <div className="category-card category-emerald" onClick={onOpenFiles}>
            <span className="cat-icon cat-icon-audio"><HeadphonesIcon size={24} /></span>
            <div className="cat-info">
              <strong>SFX & FX</strong>
              <span>31.2 GB &bull; 4 stashes</span>
            </div>
          </div>
        </div>
      </section>

      {/* Recent Stashes */}
      <section className="recent-stashes-section">
        <div className="section-header">
          <h2 className="section-title">Recent Stashes</h2>
          <button className="link-btn" type="button" onClick={onOpenFiles}>
            View all &rarr;
          </button>
        </div>

        <div className="recent-grid">
          {RECENT_STASHES.map((stash) => (
            <div key={stash.id} className={`recent-card color-${stash.color}`} onClick={onOpenFiles}>
              <div className="recent-card-top">
                <span className="recent-folder-icon"><FolderIcon size={20} /></span>
                <span className="recent-device-tag">{stash.device}</span>
              </div>
              <strong className="recent-name">{stash.name}</strong>
              <p className="recent-meta">{stash.count} &bull; {stash.size}</p>
              <span className="recent-date">&bull; {stash.date}</span>
            </div>
          ))}
        </div>
      </section>

      {/* Storage & Mount Quick Info Bar */}
      <div className="info-bar-footer">
        <div className="info-chip">
          <span className="info-label">Storage:</span>
          <strong>{usage}</strong>
        </div>
        <div className="info-chip">
          <span className="info-label">Drive:</span>
          <strong>{mount}</strong>
        </div>
        <div className="info-chip">
          <span className="info-label">User:</span>
          <strong>{username}</strong>
        </div>
        <p className="screen-notice" style={{ display: "none" }}>History is not connected. Offline files and cache controls remain unavailable.</p>
      </div>
    </main>
  );
}
