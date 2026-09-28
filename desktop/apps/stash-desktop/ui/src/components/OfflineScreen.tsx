import { useState } from "react";

type OfflineItem = {
  id: string;
  name: string;
  type: string;
  size: string;
  datePinned: string;
  status: string;
};

const SAMPLE_OFFLINE: OfflineItem[] = [
  { id: "1", name: "KSHMR Vol 5", type: "Folder", size: "1.8 GB", datePinned: "Feb 13, 2024", status: "Available offline" },
  { id: "2", name: "Client Reels", type: "Folder", size: "4.2 GB", datePinned: "Feb 12, 2024", status: "Available offline" },
  { id: "3", name: "Cinematics.mp4", type: "Video", size: "1.2 GB", datePinned: "Feb 12, 2024", status: "Available offline" },
  { id: "4", name: "SFX Library", type: "Folder", size: "3.1 GB", datePinned: "Feb 11, 2024", status: "Available offline" },
  { id: "5", name: "Project Files", type: "Folder", size: "428 MB", datePinned: "Feb 10, 2024", status: "Available offline" },
  { id: "6", name: "Brand Guidelines.pdf", type: "Document", size: "12 MB", datePinned: "Feb 9, 2024", status: "Available offline" },
  { id: "7", name: "Moodboard 2024", type: "Image", size: "215 MB", datePinned: "Feb 9, 2024", status: "Available offline" },
  { id: "8", name: "Kick Loop 128bpm.wav", type: "Audio", size: "48 MB", datePinned: "Feb 8, 2024", status: "Available offline" }
];

export function OfflineScreen() {
  const [activeTab, setActiveTab] = useState<"all" | "folders" | "files">("all");

  const items = SAMPLE_OFFLINE.filter((item) => {
    if (activeTab === "folders") return item.type === "Folder";
    if (activeTab === "files") return item.type !== "Folder";
    return true;
  });

  return (
    <section className="screen-container offline-screen">
      <header className="screen-header">
        <div>
          <p className="eyebrow">Offline</p>
          <h1>Keep what you need, always with you</h1>
          <p className="screen-sub">Pinned files and folders available on this device without internet connection.</p>
        </div>
        <button type="button" className="button button-primary">+ Pin Files</button>
      </header>

      <div className="filter-toolbar">
        <div className="filter-tab-bar">
          <button className={`tab-btn ${activeTab === "all" ? "is-active" : ""}`} type="button" onClick={() => setActiveTab("all")}>
            All ({SAMPLE_OFFLINE.length})
          </button>
          <button className={`tab-btn ${activeTab === "folders" ? "is-active" : ""}`} type="button" onClick={() => setActiveTab("folders")}>
            Pinned Folders (4)
          </button>
          <button className={`tab-btn ${activeTab === "files" ? "is-active" : ""}`} type="button" onClick={() => setActiveTab("files")}>
            Pinned Files (4)
          </button>
        </div>
      </div>

      <div className="browser-table-wrap">
        <table className="browser-table">
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Type</th>
              <th scope="col">Size</th>
              <th scope="col">Date Pinned</th>
              <th scope="col">Status</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                <td>
                  <span className="file-icon">{item.type === "Folder" ? "📁" : "📄"}</span>
                  <strong>{item.name}</strong>
                </td>
                <td>{item.type}</td>
                <td>{item.size}</td>
                <td>{item.datePinned}</td>
                <td>
                  <span className="badge-offline">✓ {item.status}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="offline-summary-bar">
        <div className="offline-summary-text">
          <span className="check-circle">✓</span>
          <div>
            <strong>12 items (11.4 GB) available offline</strong>
            <p>These files are stored on this device for quick access.</p>
          </div>
        </div>
        <button type="button" className="button button-secondary">
          🗑 Free Up Space
        </button>
      </div>
    </section>
  );
}
