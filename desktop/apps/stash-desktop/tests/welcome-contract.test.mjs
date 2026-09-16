import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join, sep } from "node:path";
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

function fakeElement(overrides = {}) {
  return {
    hidden: true,
    textContent: "",
    dataset: {},
    value: "",
    listeners: {},
    addEventListener(type, listener) { this.listeners[type] = listener; },
    ...overrides,
  };
}

function buildWelcomeDom({ accountActions = [], controls = [], titlebar = fakeElement() } = {}) {
  const elements = {
    "#account-status": fakeElement(),
    ".welcome-card": fakeElement({ hidden: false }),
    "#signin-card": fakeElement(),
    "#new-password-card": fakeElement(),
    "#signin-form": fakeElement({ listeners: {}, addEventListener(type, l) { this.listeners[type] = l; } }),
    "#signin-status": fakeElement(),
    "#new-password-form": fakeElement({ listeners: {}, addEventListener(type, l) { this.listeners[type] = l; } }),
    "#new-password-status": fakeElement(),
    "#signin-username": fakeElement(),
    "#signin-password": fakeElement(),
    "#new-password": fakeElement(),
  };
  const document = {
    querySelector: (selector) => elements[selector] ?? (selector === ".titlebar" ? titlebar : null),
    querySelectorAll: (selector) => selector === "[data-account-action]" ? accountActions : controls,
  };
  return { document, elements };
}

async function runWelcomeScript({ document, appWindow, invoke }) {
  const source = await read("../ui/welcome.js");
  const tauri = { window: { getCurrentWindow: () => appWindow }, core: { invoke } };
  new Function("document", "window", source)(document, { __TAURI__: tauri });
  return document;
}

function interactiveElement(dataset = {}) {
  return { dataset, listeners: {}, addEventListener(type, listener) { this.listeners[type] = listener; } };
}

test("custom chrome supplies accessible controls and excludes them from the drag region", async () => {
  const html = await read("../ui/index.html");
  assert.match(html, /<header class="titlebar" data-window-drag-region>/);
  for (const [action, label] of [["minimize", "Minimize window"], ["toggle-maximize", "Maximize or restore window"], ["close", "Close window"]]) assert.match(html, new RegExp(`data-window-action="${action}"[^>]*aria-label="${label}"`));
  assert.doesNotMatch(html, /data-window-drag-region[^>]*data-window-action|data-window-action[^>]*data-window-drag-region/);
});

test("window controls invoke only native actions and title-bar dragging ignores buttons", async () => {
  const calls = [];
  const appWindow = { minimize: () => calls.push("minimize"), toggleMaximize: () => calls.push("toggle-maximize"), close: () => calls.push("close"), startDragging: () => calls.push("drag") };
  const controls = ["minimize", "toggle-maximize", "close"].map((windowAction) => interactiveElement({ windowAction }));
  const titlebar = interactiveElement();
  const { document } = buildWelcomeDom({ controls, titlebar });
  await runWelcomeScript({ document, appWindow, invoke: async () => ({}) });
  controls.forEach((control) => control.listeners.click({ target: control }));
  titlebar.listeners.mousedown({ target: { closest: () => ({}) } });
  titlebar.listeners.mousedown({ target: { closest: () => null } });
  assert.deepEqual(calls, ["minimize", "toggle-maximize", "close", "drag"]);
});

test("create account is still a placeholder; sign-in reveals the sign-in form instead", async () => {
  const createAccount = interactiveElement({ accountAction: "create-account" });
  const signIn = interactiveElement({ accountAction: "sign-in" });
  const { document, elements } = buildWelcomeDom({ accountActions: [createAccount, signIn] });
  await runWelcomeScript({ document, appWindow: {}, invoke: async () => ({}) });

  createAccount.listeners.click({ type: "click" });
  assert.equal(elements["#account-status"].textContent, "Create account is coming next. No account connection has been made.");

  signIn.listeners.click({ type: "click" });
  assert.equal(elements["#signin-card"].hidden, false);
  assert.equal(elements[".welcome-card"].hidden, true);
});

test("cancelling sign-in returns to the welcome card", async () => {
  const signIn = interactiveElement({ accountAction: "sign-in" });
  const cancel = interactiveElement({ accountAction: "cancel-sign-in" });
  const { document, elements } = buildWelcomeDom({ accountActions: [signIn, cancel] });
  await runWelcomeScript({ document, appWindow: {}, invoke: async () => ({}) });

  signIn.listeners.click({ type: "click" });
  cancel.listeners.click({ type: "click" });
  assert.equal(elements["#signin-card"].hidden, true);
  assert.equal(elements[".welcome-card"].hidden, false);
});

test("submitting sign-in invokes the sign_in command and shows success", async () => {
  const { document, elements } = buildWelcomeDom();
  elements["#signin-username"].value = "person@example.com";
  elements["#signin-password"].value = "correct horse battery staple";
  let calledWith;
  const invoke = async (command, args) => {
    calledWith = { command, args };
    return { outcome: "SignedIn", username: "person@example.com" };
  };
  await runWelcomeScript({ document, appWindow: {}, invoke });

  await elements["#signin-form"].listeners.submit({ preventDefault() {} });

  assert.deepEqual(calledWith, {
    command: "sign_in",
    args: { username: "person@example.com", password: "correct horse battery staple" },
  });
  assert.equal(elements["#signin-status"].textContent, "Signed in as person@example.com.");
});

test("a remembered session is restored only through Rust IPC", async () => {
  const source = await read("../ui/welcome.js");
  assert.match(source, /invoke\("restore_session"\)/);
  assert.match(source, /result\?\.outcome === "SignedIn"/);
  assert.doesNotMatch(source, /refresh.?token|password.*storage|localStorage/i);
});

test("a NEW_PASSWORD_REQUIRED outcome shows the new-password card, and completing it signs in", async () => {
  const { document, elements } = buildWelcomeDom();
  elements["#signin-username"].value = "person@example.com";
  elements["#signin-password"].value = "TemporaryPass123!";

  let completeCalledWith;
  const invoke = async (command, args) => {
    if (command === "sign_in") {
      return { outcome: "NewPasswordRequired", session: "session-token", username: "person@example.com" };
    }
    completeCalledWith = { command, args };
    return { outcome: "SignedIn", username: "person@example.com" };
  };
  await runWelcomeScript({ document, appWindow: {}, invoke });

  await elements["#signin-form"].listeners.submit({ preventDefault() {} });
  assert.equal(elements["#new-password-card"].hidden, false);

  elements["#new-password"].value = "BrandNewPassword456!";
  await elements["#new-password-form"].listeners.submit({ preventDefault() {} });

  assert.deepEqual(completeCalledWith, {
    command: "complete_new_password",
    args: { username: "person@example.com", newPassword: "BrandNewPassword456!", session: "session-token" },
  });
  assert.equal(elements["#new-password-status"].textContent, "Signed in as person@example.com.");
});

test("a rejected sign-in shows the error message, not a silent failure", async () => {
  const { document, elements } = buildWelcomeDom();
  elements["#signin-username"].value = "person@example.com";
  elements["#signin-password"].value = "wrong";
  const invoke = async () => {
    throw "Incorrect username or password.";
  };
  await runWelcomeScript({ document, appWindow: {}, invoke });

  await elements["#signin-form"].listeners.submit({ preventDefault() {} });

  assert.equal(elements["#signin-status"].textContent, "Incorrect username or password.");
  assert.equal(elements["#signin-status"].dataset.tone, "error");
});

test("the one visible wordmark retains supplied brand bytes and supports both themes", async () => {
  const [html, css] = await Promise.all([read("../ui/index.html"), read("../ui/styles.css")]);
  for (const asset of ["STASH_primary_light.svg", "STASH_primary_dark.svg"]) assert.match(html, new RegExp(asset));
  assert.doesNotMatch(html, /STASH_splash_(light|dark)_2480x1200/);
  assert.match(css, /prefers-color-scheme: dark/);
  assert.match(css, /--stash-ink: #0b1424/);
  assert.match(css, /--stash-white: #ffffff/);
  assert.match(css, /--stash-cyan: #38bdf8/);
  assert.match(css, /--stash-violet: #7c3aed/);
  assert.match(css, /window-control:focus-visible/);
});

test("copied wordmarks retain the supplied brand bytes", async () => {
  for (const [copy, canonical] of [["../ui/assets/STASH_primary_light.svg", "../../../../brand/logos/primary/STASH_primary_light.svg"], ["../ui/assets/STASH_primary_dark.svg", "../../../../brand/logos/primary/STASH_primary_dark.svg"]]) assert.equal(sha256(await readBytes(copy)), sha256(await readBytes(canonical)));
});

test("the shell grants only the custom title-bar window permissions", async () => {
  const capability = JSON.parse(await read("../src-tauri/capabilities/default.json"));
  assert.deepEqual(capability.permissions, ["core:window:allow-start-dragging", "core:window:allow-minimize", "core:window:allow-toggle-maximize", "core:window:allow-close"]);
  assert.deepEqual(capability.windows, ["main"]);
});

test("the webview itself never talks to the network directly — only the Rust side may, via IPC", async () => {
  // This is the boundary that matters: the CSP still blocks the webview from
  // connecting to anything, and the webview's own sources must never call a
  // browser networking API or reference Cognito/AWS directly — sign-in goes
  // through `invoke()` into src-tauri, never fetch/XHR from here.
  const uiFiles = (await shellFiles(join(testDirectory, "../ui"))).filter((path) => !path.includes(`${join("ui", "assets")}${sep}`) && !path.endsWith(".svg") && !path.endsWith(".png"));
  const sources = (await Promise.all(uiFiles.map((path) => readFile(path, "utf8")))).join("\n");
  assert.doesNotMatch(sources, /\b(fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon)\b/i);
  assert.doesNotMatch(sources, /cognito|amazonaws|winfsp|mount service|localStorage/i);

  const config = JSON.parse(await read("../src-tauri/tauri.conf.json"));
  // Only the app's own IPC channel is allowed through — not arbitrary
  // network access. Tauri's WebView2 IPC transport uses this exact URL, so
  // this is the narrowest possible allowance, not a general network opening.
  const connectSrc = config.app.security.csp.split(";").map((d) => d.trim()).find((d) => d.startsWith("connect-src"));
  assert.equal(connectSrc, "connect-src 'self' ipc: http://ipc.localhost");
});

test("the Tauri configuration opens a resizable undecorated Welcome window", async () => {
  const config = JSON.parse(await read("../src-tauri/tauri.conf.json"));
  assert.equal(config.app.windows.length, 1);
  const [window] = config.app.windows;
  assert.equal(window.width, 1280);
  assert.equal(window.height, 720);
  assert.equal(window.resizable, true);
  assert.equal(window.maximizable, true);
  assert.equal(window.decorations, false);
  assert.equal(config.app.withGlobalTauri, true);
  assert.equal(config.bundle.active, false);
});

test("layout permits responsive, scaled-content scrolling without splash art", async () => {
  const css = await read("../ui/styles.css");
  assert.match(css, /body\s*\{[\s\S]*?overflow: auto;/);
  assert.match(css, /\.welcome-card\s*\{[\s\S]*?width: min\(42rem, 100%\);/);
  assert.match(css, /@media \(max-width: 560px\)/);
  assert.doesNotMatch(css, /\.art|STASH_splash/);
  assert.doesNotMatch(css, /body\s*\{[^}]*overflow: hidden;/);
});
