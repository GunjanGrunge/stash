import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("post-sign-in screen has accessible browse, breadcrumb, usage, and mount surfaces", async () => {
  const html = await read("../ui/index.html");
  for (const marker of ["browser-screen", "file-list", "breadcrumb", "usage", "selection-details", "mount-status", "mount-action"]) assert.match(html, new RegExp(marker));
  assert.match(html, /aria-label="Breadcrumb"/);
  assert.match(html, /signout-action/);
});

test("browser renders explicit hierarchy labels and required states", async () => {
  const source = await read("../ui/post-signin.js");
  assert.match(source, /Folder/);
  assert.match(source, /File/);
  assert.match(source, /Loading your STASH/);
  assert.match(source, /This folder is empty/);
  assert.match(source, /couldn't load this folder/);
});

test("sign-in transition hides the pre-auth cards before showing the browser", async () => {
  const source = await read("../ui/post-signin.js");
  const styles = await read("../ui/styles.css");
  assert.match(source, /querySelectorAll\("\.welcome-card"\)/);
  assert.match(source, /card\.hidden\s*=\s*true/);
  assert.match(source, /screen\.hidden\s*=\s*false/);
  assert.match(styles, /\[hidden\]\s*\{\s*display:\s*none\s*!important/);
});

test("mount presentation includes the selected drive letter and persistent status", async () => {
  const source = await read("../ui/post-signin.js");
  assert.match(source, /STASH \(\$\{letter\}:/);
  assert.match(source, /mount_status/);
  assert.match(source, /mount_stash/);
  assert.match(source, /unmount_stash/);
  assert.match(source, /files and cache were kept/);
  assert.match(source, /safeActionError/);
  assert.match(source, /error\?\.message/);
});

test("the browser keeps secrets and payload bytes outside the webview", async () => {
  const source = await read("../ui/post-signin.js");
  assert.doesNotMatch(source, /fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon/i);
  assert.doesNotMatch(source, /objectKey|presigned|token|payload|amazonaws|Cognito/i);
  assert.match(source, /__TAURI__.*invoke|invoke\(/s);
  assert.match(source, /invoke\("sign_out"\)/);
});
