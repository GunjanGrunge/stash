import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("no screen ships invented devices, people, dates or speeds", async () => {
  const dir = new URL("../src/components/", import.meta.url);
  const all = (await Promise.all((await readdir(dir)).filter((f) => f.endsWith(".tsx")).map((f) => readFile(new URL(f, dir), "utf8")))).join("\n");
  for (const fake of ["MacBook Pro", "iPhone 15", "gunjan@stash.com", "Gunjan-PC", "Feb 13, 2024", "78 MB/s", "Uploading 342 of 842", "macOS Sonoma", "Client Reels", "Stock Footage", "Music Samples"]) {
    assert.doesNotMatch(all, new RegExp(fake.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `fake content "${fake}" is back`);
  }
});

test("Transfers shows the live Stash and a measured speed, never a fixed one", async () => {
  const screen = await read("../src/components/TransfersScreen.tsx");
  assert.match(screen, /gateway\.stash\.status\(\)/);
  assert.match(screen, /export function measureRate/);
  assert.match(screen, /const rate = running \? measureRate\(samples\.current\) : null;/);
  assert.match(screen, /Nothing is Stashing right now/);
  assert.doesNotMatch(screen, /End-to-end/, "STASH does not do end-to-end encryption");
});

test("Settings only offers what works today; the rest says Coming soon", async () => {
  const screen = await read("../src/components/SettingsScreen.tsx");
  // Startup and reconnecting S: are real, saved on this workstation.
  assert.match(screen, /title="Launch STASH at sign in"[^\n]*checked=\{prefs\?\.launchAtLogin[^\n]*onChange=/);
  assert.match(screen, /title="Mount S: when STASH starts"[^\n]*checked=\{prefs\?\.mountAtLaunch[^\n]*onChange=/);
  assert.match(screen, /gateway\.device\.preferences\(\)/);
  assert.doesNotMatch(screen, /title="Launch STASH at sign in"[^\n]*soon/);
  assert.match(screen, /title="Pause on metered networks"[^\n]*soon[^\n]*disabled/);
  assert.match(screen, /<SettingValue>S:\\<\/SettingValue>/);
  assert.match(screen, /gateway\.library\.storageBreakdown\(\)/);
  assert.match(screen, /Signed in as[\s\S]*\{username\}/);
});

test("Files stays live: STASH's change signal, focus, and a poll for other devices", async () => {
  const [files, gateway] = await Promise.all([read("../src/components/FilesScreen.tsx"), read("../src/platform/tauri/gateway.ts")]);
  assert.match(files, /gateway\.library\.onLibraryChanged\(soon\)/);
  assert.match(files, /window\.setInterval\(refresh, OTHER_DEVICES_POLL_MS\)/);
  assert.match(files, /OTHER_DEVICES_POLL_MS = 15_000/);
  assert.match(gateway, /listen\("stash-library"/);
  // Files still uploading from S: show as such and can't be trashed yet.
  assert.match(files, /isInFlight\(item\) \? <StateTag tone="stashing"/);
  assert.match(files, /!isInFlight\(item\) && \(item\.entity === "FOLDER"/);
});

test("Asset details previews real files and shows only real details", async () => {
  const [asset, files, conf] = await Promise.all([
    read("../src/components/AssetDetailsScreen.tsx"),
    read("../src/components/FilesScreen.tsx"),
    read("../../src-tauri/tauri.conf.json"),
  ]);
  // Files opens it (double-click or Preview); the old animated fake player is gone.
  assert.match(files, /canPreview\(item\) && setPreviewing\(item\)/);
  assert.doesNotMatch(files, /isPlaying|waveform-visualizer/);
  // Every detail comes from STASH, the name, or the media itself.
  assert.match(asset, /gateway\.library\.describeFile\(asset\.fileId\)/);
  assert.match(asset, /context\.decodeAudioData/);
  assert.doesNotMatch(asset, /Pinned|Free up space|MacBook|Windows Laptop|Yesterday/);
  // The window may load previews only from the app's own protocol.
  const csp = JSON.parse(conf).app.security.csp;
  for (const directive of ["media-src http://stash.localhost", "frame-src http://stash.localhost", "object-src 'none'"]) assert.ok(csp.includes(directive), directive);
  assert.doesNotMatch(csp, /amazonaws|\*/);
});

test("Offline and the top bar use this device's real name", async () => {
  const [offline, topbar, shell] = await Promise.all([read("../src/components/OfflineScreen.tsx"), read("../src/components/TopBar.tsx"), read("../src/components/Shell.tsx")]);
  assert.match(offline, /eyebrow=\{`Pinned on \$\{deviceName\}`\}/);
  assert.match(topbar, /<span>\{deviceName\}<\/span>/);
  assert.match(shell, /gateway\.device\.info\(\)/);
});
