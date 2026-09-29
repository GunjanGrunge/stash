import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("the Windows installer is per-user and ships only the app", async () => {
  const conf = JSON.parse(await read("../../src-tauri/tauri.conf.json"));
  assert.equal(conf.bundle.active, true);
  assert.deepEqual(conf.bundle.targets, ["nsis"]);
  assert.equal(conf.bundle.windows.nsis.installMode, "currentUser", "installs without admin rights");
  // Nothing beside the exe: no config files, no .env, no keys.
  assert.equal(conf.bundle.resources, undefined);
  assert.equal(conf.bundle.externalBin, undefined);
});

test("the shipped app holds no AWS credentials, only public identifiers", async () => {
  const [auth, api, main] = await Promise.all([
    read("../../src-tauri/src/auth.rs"),
    read("../../src-tauri/src/api.rs"),
    read("../../src-tauri/src/main.rs"),
  ]);
  for (const source of [auth, api]) assert.doesNotMatch(source, /AKIA[0-9A-Z]{16}|ASIA[0-9A-Z]{16}|secret_access_key/i);
  // Cognito sign-in is unsigned; the SDK is given placeholder credentials, never real ones.
  assert.match(auth, /Credentials::new\(\s*"unused",\s*"unused",/);
  assert.match(main, /windows_subsystem = "windows"/);
});
