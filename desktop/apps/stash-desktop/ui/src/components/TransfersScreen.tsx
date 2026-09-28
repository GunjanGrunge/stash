import { useState } from "react";

type TransferItem = {
  id: string;
  name: string;
  size: string;
  status: "uploading" | "completed" | "failed" | "queued";
  progressPct: number;
  speed?: string;
  eta?: string;
  fileCount?: string;
};

const SAMPLE_TRANSFERS: TransferItem[] = [
  { id: "1", name: "KSHMR Vol 5", size: "12.4 GB", status: "uploading", progressPct: 61, speed: "78 MB/s", eta: "2 min left", fileCount: "342 of 842 files" },
  { id: "2", name: "Client Reels", size: "4.8 GB", status: "uploading", progressPct: 25, speed: "24 MB/s", eta: "5 min left", fileCount: "12 of 48 files" },
  { id: "3", name: "Stock Footage", size: "126 GB", status: "queued", progressPct: 0, eta: "Waiting to start" },
  { id: "4", name: "SFX Library", size: "31.2 GB", status: "completed", progressPct: 100, eta: "Completed · Just now", fileCount: "312 of 312 files" },
  { id: "5", name: "Brand Guidelines.pdf", size: "4.6 MB", status: "completed", progressPct: 100, eta: "Completed · 2 min ago", fileCount: "1 of 1 file" },
  { id: "6", name: "Drum Kit 02", size: "3.9 GB", status: "failed", progressPct: 0, eta: "Failed — Network connection lost" }
];

export function TransfersScreen() {
  const [filter, setFilter] = useState<"all" | "uploading" | "completed" | "failed">("all");

  const items = SAMPLE_TRANSFERS.filter((item) => {
    if (filter === "uploading") return item.status === "uploading" || item.status === "queued";
    if (filter === "completed") return item.status === "completed";
    if (filter === "failed") return item.status === "failed";
    return true;
  });

  return (
    <section className="screen-container transfers-screen">
      <header className="screen-header">
        <div>
          <p className="eyebrow">Transfers</p>
          <h1>Upload, download and sync status</h1>
          <p className="screen-sub">Track active uploads, completed syncs, and network activity.</p>
        </div>
        <div className="cloud-sync-badge">
          <span className="dot-active" /> Cloud sync active
        </div>
      </header>

      <div className="filter-tab-bar">
        <button className={`tab-btn ${filter === "all" ? "is-active" : ""}`} type="button" onClick={() => setFilter("all")}>
          All ({SAMPLE_TRANSFERS.length})
        </button>
        <button className={`tab-btn ${filter === "uploading" ? "is-active" : ""}`} type="button" onClick={() => setFilter("uploading")}>
          Uploading (3)
        </button>
        <button className={`tab-btn ${filter === "completed" ? "is-active" : ""}`} type="button" onClick={() => setFilter("completed")}>
          Completed (2)
        </button>
        <button className={`tab-btn ${filter === "failed" ? "is-active" : ""}`} type="button" onClick={() => setFilter("failed")}>
          Failed (1)
        </button>
      </div>

      <div className="transfers-list">
        {items.map((item) => (
          <div key={item.id} className={`transfer-card status-${item.status}`}>
            <div className="transfer-icon-area">
              <span className="folder-symbol">📁</span>
            </div>
            <div className="transfer-main-info">
              <div className="transfer-title-row">
                <span className="transfer-name">{item.name}</span>
                <span className="transfer-size">{item.size}</span>
              </div>
              <div className="transfer-meta-row">
                <span className="transfer-status-text">
                  {item.status === "uploading" && `Uploading ${item.fileCount || ""}`}
                  {item.status === "queued" && "Queued…"}
                  {item.status === "completed" && `Completed · ${item.fileCount || ""}`}
                  {item.status === "failed" && item.eta}
                </span>
                {item.speed && <span className="transfer-speed">{item.speed} &bull; {item.eta}</span>}
              </div>
              {item.status === "uploading" && (
                <div className="transfer-progress-track">
                  <div className="transfer-progress-fill" style={{ width: `${item.progressPct}%` }} />
                </div>
              )}
            </div>
            <div className="transfer-actions">
              {item.status === "uploading" && <button type="button" className="icon-btn" title="Pause">⏸</button>}
              {item.status === "completed" && <span className="checkmark-icon">✓</span>}
              {item.status === "failed" && <button type="button" className="button button-secondary button-sm">Retry</button>}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
