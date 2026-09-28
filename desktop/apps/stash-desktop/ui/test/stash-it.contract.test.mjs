import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("Stash It gateway exposes only safe native command shapes", async () => {
  const [gateway, contracts, types] = await Promise.all([read("../src/platform/tauri/gateway.ts"), read("../src/platform/contracts.ts"), read("../src/domain/types.ts")]);
  for (const command of ["select_stash_source", "confirm_stash", "get_transfer_status", "cancel_stash"]) assert.match(gateway, new RegExp(`\\"${command}\\"`));
  assert.match(contracts, /selectSource\(kind: "file" \| "folder", start\?: StashStart\)/);
  assert.match(gateway, /sourceSummary/);
  const stashSlice = gateway.slice(gateway.indexOf("stash: {"));
  assert.doesNotMatch(stashSlice, /presigned|objectKey|uploadId|etag|checksum|payload/i);
  assert.match(types, /SourceSummary/);
  assert.match(types, /TransferStatus/);
});

test("source review and transfer UI preserve honest phases without fake completion", async () => {
  const [screen, home, shell] = await Promise.all([read("../src/components/StashItScreen.tsx"), read("../src/components/HomeScreen.tsx"), read("../src/components/Shell.tsx")]);
  for (const phase of ["Preparing", "Stashing", "Verifying", "Stashed", "NeedsAttention", "Canceled"]) assert.match(screen, new RegExp(phase));
  assert.match(screen, /names and folders kept exactly as they are/);
  assert.match(screen, /Cancel Stash/);
  assert.match(screen, /transfer && transfer\.phase === "Stashed"/);
  assert.match(home, /History is not connected/);
  assert.match(home, /Offline files and cache controls remain unavailable/);
  assert.match(shell, /initialScreen = "Home"/);
});

test("Files remains hierarchy-preserving and the visual slice adds native Stash It without web APIs", async () => {
  const [files, rail, styles, stash] = await Promise.all([read("../src/components/FilesScreen.tsx"), read("../src/components/NavigationRail.tsx"), read("../src/styles.css"), read("../src/components/StashItScreen.tsx")]);
  for (const marker of ["Folder", "File", "originalRelativePath", "toggleSort"]) assert.match(files, new RegExp(marker));
  assert.match(rail, /onClick=\{onStash\}/);
  assert.match(styles, /\.stash-overlay/);
  assert.match(styles, /\.home-card-transfer/);
  assert.doesNotMatch(`${files}${rail}${stash}`, /fetch|XMLHttpRequest|WebSocket|presigned|objectKey|uploadId/i);
});
