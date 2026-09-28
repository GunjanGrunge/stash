import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir, stat } from "node:fs/promises";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("sidebar has exactly the Figma navigation, in order", async () => {
  const rail = await read("../src/components/NavigationRail.tsx");
  assert.match(rail, /NAV_ITEMS = \["Home", "Files", "Search", "Recent Stashes", "Offline", "Transfers", "Settings"\] as const/);
  assert.doesNotMatch(rail, /Favorites/);
});

test("profile menu signs out and the top bar searches and controls the drive", async () => {
  const [rail, topbar, shell] = await Promise.all([read("../src/components/NavigationRail.tsx"), read("../src/components/TopBar.tsx"), read("../src/components/Shell.tsx")]);
  assert.match(rail, /role="menuitem" onClick=\{\(\) => \{ setMenuOpen\(false\); onSignOut\(\); \}\}>Sign out</);
  assert.match(topbar, /event\.key\.toLowerCase\(\) === "k"/);
  assert.match(topbar, /onClick=\{onToggleMount\}/);
  assert.match(shell, /<SearchScreen key=\{searchQuery\.at\} gateway=\{gateway\} initialQuery=\{searchQuery\.text\} \/>/);
});

test("the shipped app never contains Figma sample people or old brand chrome", async () => {
  const dir = new URL("../src/components/", import.meta.url);
  const sources = await Promise.all((await readdir(dir)).filter((f) => f.endsWith(".tsx")).map((f) => readFile(new URL(f, dir), "utf8")));
  const all = sources.join("\n");
  assert.doesNotMatch(all, /Maya Chen|Creator Pro/);
  const [titlebar, app] = await Promise.all([read("../src/components/TitleBar.tsx"), read("../src/app/App.tsx")]);
  assert.doesNotMatch(titlebar + app, /Splash<|onToggleTheme|linearGradient/);
});

test("frame icons are local Figma exports", async () => {
  for (const icon of ["house", "folder", "search-nav", "history", "pin", "arrow-up-down", "settings", "avatar", "chevrons-up-down", "search", "online-indicator", "bell"]) {
    const info = await stat(new URL(`../src/assets/figma/shell/${icon}.svg`, import.meta.url));
    assert.ok(info.size > 0, `${icon}.svg is empty`);
  }
});
