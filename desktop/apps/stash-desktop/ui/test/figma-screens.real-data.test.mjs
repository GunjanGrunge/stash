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
  assert.match(screen, /title="Launch STASH at sign in"[^\n]*soon[^\n]*disabled/);
  assert.match(screen, /title="Pause on metered networks"[^\n]*soon[^\n]*disabled/);
  assert.match(screen, /<SettingValue>S:\\<\/SettingValue>/);
  assert.match(screen, /gateway\.library\.storageBreakdown\(\)/);
  assert.match(screen, /Signed in as[\s\S]*\{username\}/);
});

test("Offline and the top bar use this device's real name", async () => {
  const [offline, topbar, shell] = await Promise.all([read("../src/components/OfflineScreen.tsx"), read("../src/components/TopBar.tsx"), read("../src/components/Shell.tsx")]);
  assert.match(offline, /eyebrow=\{`Pinned on \$\{deviceName\}`\}/);
  assert.match(topbar, /<span>\{deviceName\}<\/span>/);
  assert.match(shell, /gateway\.device\.info\(\)/);
});
