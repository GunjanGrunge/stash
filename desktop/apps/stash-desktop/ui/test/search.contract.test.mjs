import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("Search is routed to a real screen, not the unavailable placeholder", async () => {
  const shell = await read("../src/components/Shell.tsx");
  assert.match(shell, /active === "Search"\) \{\s*mainContent = <SearchScreen/);
  assert.doesNotMatch(shell, /item === "Search" \? "search"/);
});

test("search gateway calls only the allow-listed native command and validates results", async () => {
  const gateway = await read("../src/platform/tauri/gateway.ts");
  assert.match(gateway, /"search_stash"/);
  assert.match(gateway, /call\("search_stash", \{ query: query\.slice\(0, 200\), refresh \}, searchResponse\)/);
  assert.match(gateway, /search: unavailable/);
});

test("search screen is honest about what it could not use and where it ran", async () => {
  const screen = await read("../src/components/SearchScreen.tsx");
  assert.match(screen, /Search runs on this device/);
  assert.match(screen, /can't tell duration or orientation from file names yet/);
  assert.match(screen, /role="search"/);
  assert.doesNotMatch(screen, /fetch\(|XMLHttpRequest|window\.alert/);
});
