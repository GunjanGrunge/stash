import test from "node:test";
import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("welcome never signs anyone in without Cognito", async () => {
  const welcome = await read("../src/components/WelcomeScreen.tsx");
  assert.doesNotMatch(welcome, /type: "SIGNED_IN"/, "no client-side sign-in shortcut");
  assert.doesNotMatch(welcome, /Creator Studio/);
  assert.match(welcome, /gateway\.auth\.signIn\(email, secret, remember\)/);
});

test("sign-in follows the Figma flow: email first, then password", async () => {
  const welcome = await read("../src/components/WelcomeScreen.tsx");
  for (const copy of ["Welcome back", "Sign in to mount your STASH on this device.", "Continue with email", "Continue with Apple", "Continue with Google", "By continuing, you agree to STASH Terms and Privacy Policy."]) {
    assert.match(welcome, new RegExp(copy.replace(/[.]/g, "\\.")));
  }
  assert.match(welcome, /dispatch\(\{ type: "OPEN_SIGN_IN" \}\)/);
  assert.match(welcome, /autoComplete="current-password"/);
});

test("Apple and Google are shown but only say they are coming soon", async () => {
  const welcome = await read("../src/components/WelcomeScreen.tsx");
  assert.match(welcome, /comingSoon\("Apple"\)/);
  assert.match(welcome, /comingSoon\("Google"\)/);
  assert.match(welcome, /sign-in is coming soon/);
});

test("design assets are local files, never temporary Figma URLs", async () => {
  const [welcome, css] = await Promise.all([read("../src/components/WelcomeScreen.tsx"), read("../src/styles.css")]);
  assert.doesNotMatch(welcome + css, /figma\.com/);
  for (const asset of ["apple.svg", "audio-waveform.svg", "chrome.svg", "layers-3.svg", "platform-dot.svg", "video-still.jpg"]) {
    const info = await stat(new URL(`../src/assets/figma/welcome/${asset}`, import.meta.url));
    assert.ok(info.size > 0, `${asset} is empty`);
  }
});
