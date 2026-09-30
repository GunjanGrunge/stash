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
  assert.match(shell, /<SearchScreen key=\{searchQuery\.at\} gateway=\{gateway\} initialQuery=\{searchQuery\.text\} mounted=\{mounted\} onOpenFolder=\{\(folders\) => \{ setFilesAt\(\{ folders, at: Date\.now\(\) \}\); setActive\("Files"\); \}\} \/>/);
});

test("the shipped app never contains Figma sample people or old brand chrome", async () => {
  const dir = new URL("../src/components/", import.meta.url);
  const sources = await Promise.all((await readdir(dir)).filter((f) => f.endsWith(".tsx")).map((f) => readFile(new URL(f, dir), "utf8")));
  const all = sources.join("\n");
  assert.doesNotMatch(all, /Maya Chen|Creator Pro/);
  const [titlebar, app] = await Promise.all([read("../src/components/TitleBar.tsx"), read("../src/app/App.tsx")]);
  assert.doesNotMatch(titlebar + app, /Splash<|onToggleTheme|linearGradient/);
});

test("the app wears the brand: gradient symbol, cyan accent, no leftover lime", async () => {
  const [rail, welcome, styles, symbol] = await Promise.all([
    read("../src/components/NavigationRail.tsx"),
    read("../src/components/WelcomeScreen.tsx"),
    read("../src/styles.css"),
    read("../src/assets/brand/stash-symbol.svg"),
  ]);
  assert.match(rail, /<img className="sidebar-brand-mark" src=\{stashSymbol\}/);
  assert.match(welcome, /<img className="welcome-brand-mark" src=\{stashSymbol\}/);
  assert.doesNotMatch(rail + welcome, /brand-mark" aria-hidden="true">S</, "no placeholder S tile");
  // The symbol is the brand kit's artwork and gradient, unaltered.
  assert.match(symbol, /stop-color="#38BDF8"[\s\S]*stop-color="#7C3AED"/);
  assert.match(symbol, /points="298,225 429,225 315,798 184,798"/);
  assert.match(styles, /--accent: #38bdf8;/);
  assert.match(styles, /--accent-ink: #0b1424;/);
  // Nothing lime is left: tokens, hard-coded tints, icons or components.
  const lime = /b7ff3c|183, ?255, ?60|#263716|#101604|#11180b|#3d5a1c/i;
  const sources = async (dir, ext) => Promise.all((await readdir(new URL(dir, import.meta.url), { recursive: true })).filter((f) => f.endsWith(ext)).map((f) => readFile(new URL(`${dir}${f}`, import.meta.url), "utf8")));
  for (const [dir, ext] of [["../src/", ".css"], ["../src/components/", ".tsx"], ["../src/assets/", ".svg"]]) {
    for (const text of await sources(dir, ext)) assert.doesNotMatch(text, lime, `lime left in ${dir}*${ext}`);
  }
});

test("frame icons are local Figma exports", async () => {
  for (const icon of ["house", "folder", "search-nav", "history", "pin", "arrow-up-down", "settings", "avatar", "chevrons-up-down", "search", "online-indicator", "bell"]) {
    const info = await stat(new URL(`../src/assets/figma/shell/${icon}.svg`, import.meta.url));
    assert.ok(info.size > 0, `${icon}.svg is empty`);
  }
});
