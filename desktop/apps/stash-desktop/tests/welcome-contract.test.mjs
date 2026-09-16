import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");
const readBytes = (path) => readFile(new URL(path, import.meta.url));
const sha256 = (contents) => createHash("sha256").update(contents).digest("hex");
const testDirectory = dirname(fileURLToPath(import.meta.url));

async function shellFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? (["target", "gen"].includes(entry.name) ? [] : shellFiles(path)) : [path];
  }));
  return files.flat();
}

async function runWelcomeScript(actions) {
  const status = { textContent: "" };
  const document = {
    querySelector: (selector) => selector === "#account-status" ? status : null,
    querySelectorAll: () => actions,
  };
  const source = await read("../ui/welcome.js");
  new Function("document", source)(document);
  return status;
}

test("the welcome screen exposes two harmless account actions", async () => {
  const [html, script] = await Promise.all([read("../ui/index.html"), read("../ui/welcome.js")]);
  assert.match(html, /<button[^>]*data-account-action="sign-in"[^>]*>Sign in<\/button>/);
  assert.match(html, /<button[^>]*data-account-action="create-account"[^>]*>Create account<\/button>/);
  assert.match(html, /aria-live="polite"/);
  assert.match(script, /No account connection has been made/);
});

test("click and keyboard activation both remain harmless at runtime", async () => {
  const createAction = (accountAction) => ({
    dataset: { accountAction },
    addEventListener: (type, listener) => { assert.equal(type, "click"); createAction.listeners.push(listener); },
  });
  createAction.listeners = [];
  const signIn = createAction("sign-in");
  const createAccount = createAction("create-account");
  const status = await runWelcomeScript([signIn, createAccount]);

  // Native buttons dispatch a click for both pointer activation and Enter/Space.
  createAction.listeners[0]({ type: "click", source: "pointer" });
  assert.equal(status.textContent, "Sign in is coming next. No account connection has been made.");
  createAction.listeners[1]({ type: "click", source: "keyboard" });
  assert.equal(status.textContent, "Create account is coming next. No account connection has been made.");
});

test("the screen uses supplied branded assets and supports both themes", async () => {
  const [html, css] = await Promise.all([read("../ui/index.html"), read("../ui/styles.css")]);
  for (const asset of ["STASH_primary_light.svg", "STASH_primary_dark.svg", "STASH_splash_light_2480x1200.png", "STASH_splash_dark_2480x1200.png"]) assert.match(html, new RegExp(asset));
  assert.match(css, /prefers-color-scheme: dark/);
  assert.match(css, /--stash-ink: #0b1424/);
  assert.match(css, /--stash-white: #ffffff/);
  assert.match(css, /--stash-cyan: #38bdf8/);
  assert.match(css, /--stash-violet: #7c3aed/);
  assert.match(css, /:focus-visible/);
});

test("copied interface assets retain the supplied brand bytes", async () => {
  const assets = [
    ["../ui/assets/STASH_primary_light.svg", "../../../../brand/logos/primary/STASH_primary_light.svg"],
    ["../ui/assets/STASH_primary_dark.svg", "../../../../brand/logos/primary/STASH_primary_dark.svg"],
    ["../ui/assets/STASH_splash_light_2480x1200.png", "../../../../brand/splash/STASH_splash_light_2480x1200.png"],
    ["../ui/assets/STASH_splash_dark_2480x1200.png", "../../../../brand/splash/STASH_splash_dark_2480x1200.png"],
  ];
  for (const [copy, canonical] of assets) assert.equal(sha256(await readBytes(copy)), sha256(await readBytes(canonical)));
});

test("all shell sources and config prohibit integration and network APIs", async () => {
  const roots = [join(testDirectory, "../ui"), join(testDirectory, "../src-tauri")];
  const paths = (await Promise.all(roots.map(shellFiles))).flat().filter((path) => !path.includes(`${join("ui", "assets")}${"\\"}`));
  const sources = await Promise.all(paths.map((path) => readFile(path, "utf8")));
  assert.doesNotMatch(sources.join("\n"), /\b(fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon|reqwest|ureq)\b/i);
  assert.doesNotMatch(sources.join("\n"), /cognito|amazonaws|winfsp|mount service|localStorage/i);
});

test("the Tauri configuration opens one usable Windows welcome window", async () => {
  const config = JSON.parse(await read("../src-tauri/tauri.conf.json"));
  assert.equal(config.app.windows.length, 1);
  const [window] = config.app.windows;
  assert.equal(window.title, "STASH — Welcome / Sign in");
  assert.equal(window.width, 1280);
  assert.equal(window.height, 720);
  assert.equal(window.minWidth, 1280);
  assert.equal(window.minHeight, 720);
  assert.equal(window.resizable, false);
  assert.match(config.bundle.icon[0], /STASH\.ico$/);
  assert.equal(config.bundle.active, false);
  assert.match(config.app.security.csp, /connect-src 'none'/);
});

test("layout keeps a practical welcome card and permits scaled-content scrolling", async () => {
  const css = await read("../ui/styles.css");
  assert.match(css, /body\s*\{[\s\S]*?overflow: auto;/);
  assert.match(css, /\.welcome-card\s*\{[\s\S]*?min-width: 36rem;/);
  assert.doesNotMatch(css, /body\s*\{[^}]*overflow: hidden;/);
});
