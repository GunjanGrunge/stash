import { useState } from "react";

type Props = {
  username: string;
};

export function SettingsScreen({ username }: Props) {
  const [activeTab, setActiveTab] = useState<"account" | "storage" | "devices" | "appearance">("account");
  const [autoCache, setAutoCache] = useState(true);

  return (
    <section className="screen-container settings-screen">
      <header className="screen-header">
        <div>
          <p className="eyebrow">Settings</p>
          <h1>Manage your account, devices, and preferences</h1>
        </div>
      </header>

      <div className="filter-tab-bar">
        <button className={`tab-btn ${activeTab === "account" ? "is-active" : ""}`} type="button" onClick={() => setActiveTab("account")}>
          Account
        </button>
        <button className={`tab-btn ${activeTab === "storage" ? "is-active" : ""}`} type="button" onClick={() => setActiveTab("storage")}>
          Storage & Cache
        </button>
        <button className={`tab-btn ${activeTab === "devices" ? "is-active" : ""}`} type="button" onClick={() => setActiveTab("devices")}>
          Devices
        </button>
        <button className={`tab-btn ${activeTab === "appearance" ? "is-active" : ""}`} type="button" onClick={() => setActiveTab("appearance")}>
          Appearance
        </button>
      </div>

      {activeTab === "account" && (
        <div className="settings-section">
          <div className="profile-card">
            <div className="avatar-circle">GJ</div>
            <div>
              <h3>Gunjan</h3>
              <p className="profile-email">gunjan@stash.com</p>

              <div className="plan-badge-row">
                <span className="badge-creator">Creator Pro &bull; Active</span>
                <span className="quota-text">624 GB of 1 TB used</span>
              </div>
            </div>
          </div>

          <div className="card-box">
            <h3>Authorized Devices</h3>
            <p className="screen-sub">Manage devices that can access your STASH.</p>
            <div className="device-list">
              <div className="device-row">
                <div>
                  <strong>Gunjan-PC</strong>
                  <p className="device-meta">Windows 11 &bull; Active now (Current device)</p>
                </div>
                <span className="badge-current">Current device</span>
              </div>
              <div className="device-row">
                <div>
                  <strong>MacBook Pro</strong>
                  <p className="device-meta">macOS Sonoma &bull; Last seen 2 hours ago</p>
                </div>
                <button type="button" className="button button-secondary button-sm">Revoke</button>
              </div>
              <div className="device-row">
                <div>
                  <strong>iPhone 15</strong>
                  <p className="device-meta">iOS 17 &bull; Last seen 1 day ago</p>
                </div>
                <button type="button" className="button button-secondary button-sm">Revoke</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {activeTab === "storage" && (
        <div className="settings-section">
          <div className="card-box">
            <h3>Cloud Storage Breakdown</h3>
            <div className="storage-breakdown-bar">
              <div className="bar-segment seg-video" style={{ width: "40%" }} title="Video 40%" />
              <div className="bar-segment seg-audio" style={{ width: "24%" }} title="Audio 24%" />
              <div className="bar-segment seg-images" style={{ width: "15%" }} title="Images 15%" />
              <div className="bar-segment seg-docs" style={{ width: "13%" }} title="Documents 13%" />
              <div className="bar-segment seg-projects" style={{ width: "8%" }} title="Projects 8%" />
            </div>

            <div className="storage-legend-grid">
              <div className="legend-item"><span className="dot dot-video" /> Video: 248 GB (40%)</div>
              <div className="legend-item"><span className="dot dot-audio" /> Audio: 152 GB (24%)</div>
              <div className="legend-item"><span className="dot dot-images" /> Images: 96 GB (15%)</div>
              <div className="legend-item"><span className="dot dot-docs" /> Documents: 68 GB (13%)</div>
              <div className="legend-item"><span className="dot dot-projects" /> Projects: 48 GB (8%)</div>
              <div className="legend-item"><span className="dot dot-other" /> Free: 376 GB</div>
            </div>
          </div>

          <div className="card-box">
            <h3>Local Cache</h3>
            <div className="cache-info-grid">
              <div>
                <p className="eyebrow">Cache size</p>
                <strong className="text-xl">8.4 GB</strong>
              </div>
              <div>
                <p className="eyebrow">Cache location</p>
                <code>/Users/gunjan/Library/Application Support/STASH</code>
              </div>
              <div>
                <p className="eyebrow">Cached items</p>
                <strong>1,248 files</strong>
              </div>
            </div>

            <div className="toggle-row">
              <div>
                <strong>Auto-manage cache</strong>
                <p className="screen-sub">Automatically remove old cache files when local disk space is low.</p>
              </div>
              <input
                type="checkbox"
                checked={autoCache}
                onChange={(e) => setAutoCache(e.target.checked)}
                className="toggle-checkbox"
              />
            </div>

            <div className="action-row">
              <button type="button" className="button button-secondary">Clear Cache (8.4 GB)</button>
            </div>
          </div>
        </div>
      )}

      {(activeTab === "devices" || activeTab === "appearance") && (
        <div className="card-box">
          <h3>Preferences</h3>
          <p>STASH matches your system light/dark theme preference automatically.</p>
        </div>
      )}
    </section>
  );
}
