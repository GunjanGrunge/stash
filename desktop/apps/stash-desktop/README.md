# STASH desktop welcome shell

This package is the isolated Windows Tauri shell for the **Welcome / Sign in** screen. It now wires real Cognito sign-in (via `src-tauri/src/auth.rs`); it still has no filesystem-adapter or mount integration.

## Prerequisites

- Rust stable with the Windows MSVC toolchain
- Microsoft Edge WebView2 Runtime
- Tauri's Windows build prerequisites (WebView2, C++ Build Tools, and Windows SDK)
- Tauri CLI 2 (`cargo install tauri-cli --version "^2.11"`)

## Launch locally

From the repository root, run:

```powershell
cargo tauri dev --config desktop/apps/stash-desktop/src-tauri/tauri.conf.json
```

Run the static UI contract tests with:

```powershell
node --test desktop/apps/stash-desktop/tests/welcome-contract.test.mjs
```

The Welcome window uses a custom, Windows-style title bar. Drag its empty left area; the right-side controls minimize, maximize/restore, and close the native window. Check each control with pointer and keyboard, maximize/restore the window, resize it with enlarged Windows text, tab through the controls and account actions, and inspect both system light and dark modes for focus visibility or overlap.

**Sign in** now performs a real Cognito SRP sign-in against the deployed User Pool (`ap-south-1_0ELYEOOy0`), handling the `NEW_PASSWORD_REQUIRED` challenge for accounts created with a temporary password. **Create account** is still a placeholder. Token persistence (keychain storage, refresh) is deliberately not implemented yet — this only proves sign-in succeeds. This is separate from the `mount-spike` crate and does not start, inspect, or import the mounted-drive implementation.
