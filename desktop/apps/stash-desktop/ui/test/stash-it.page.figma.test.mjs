import test from "node:test";
import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("Stash it is a full page in the app frame, not a pop-up", async () => {
  const [shell, screen] = await Promise.all([read("../src/components/Shell.tsx"), read("../src/components/StashItScreen.tsx")]);
  assert.match(shell, /<div className="app-screen">\s*\{stashOpen\s*\? <StashItScreen/);
  assert.doesNotMatch(screen, /stash-overlay|aria-modal/);
  for (const copy of ["Make room without breaking your flow", "Drop it into the vault", "Choose files or folders", "What happens next", "Byte-for-byte upload", "Hierarchy preserved", "You choose cleanup", "Destination"]) {
    assert.match(screen, new RegExp(copy));
  }
});

test("the idle backend status never shows as a running Stash", async () => {
  const screen = await read("../src/components/StashItScreen.tsx");
  assert.match(screen, /Boolean\(status && status\.sourceName && status\.fileCount > 0\)/);
  assert.match(screen, /const transfer = isRealTransfer\(status\) \? status : null;/);
});

test("shortcuts only ask for allow-listed starting folders; destination is the real one", async () => {
  const [screen, gateway] = await Promise.all([read("../src/components/StashItScreen.tsx"), read("../src/platform/tauri/gateway.ts")]);
  assert.match(screen, /start: "desktop"[\s\S]*start: "downloads"[\s\S]*start: "documents"/);
  assert.match(gateway, /\["desktop", "downloads", "documents"\]\.includes\(start\) \? start : null/);
  assert.match(screen, /`STASH \/ \$\{source\.folderName\}`/);
  assert.doesNotMatch(screen, /Incoming|available to Stash|Windows Desktop/);
});

test("Stash it icons are local Figma exports", async () => {
  for (const icon of ["folder-open", "monitor", "download", "folder", "hard-drive"]) {
    assert.ok((await stat(new URL(`../src/assets/figma/stash-it/${icon}.svg`, import.meta.url))).size > 0, icon);
  }
});
