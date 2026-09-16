# STASH desktop welcome shell

This package is the isolated Windows Tauri shell for the **Welcome / Sign in** and post-sign-in STASH file browser screens. Sign-in remains on the Rust side; the browser requests metadata and mount actions through Tauri IPC.

The browser preserves the File/Folder hierarchy, shows breadcrumb navigation, loading/empty/error states, selection details, and storage usage. Metadata requests now run through Rust-owned authenticated IPC; payload bytes, filesystem writes, credentials, and leases remain outside the webview. Drive mounting and write-through sync are intentionally a later slice: the UI never claims a mount or upload succeeded without a service response.

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
node --test desktop/apps/stash-desktop/tests/post-signin-contract.test.mjs
```

The Welcome window uses a custom, Windows-style title bar. Drag its empty left area; the right-side controls minimize, maximize/restore, and close the native window. Check each control with pointer and keyboard, maximize/restore the window, resize it with enlarged Windows text, tab through the controls and account actions, and inspect both system light and dark modes for focus visibility or overlap.

**Sign in** performs a real Cognito SRP sign-in against the deployed User Pool (`ap-south-1_0ELYEOOy0`), handling the `NEW_PASSWORD_REQUIRED` challenge for accounts created with a temporary password. On a successful sign-in, STASH stores only Cognito's rotating refresh token in the current Windows user's Credential Manager. It restores the session on the next launch; the password is never stored and the short-lived ID token stays in process memory. **Sign out** deletes that Credential Manager entry and returns the app to sign-in. **Create account** is still a placeholder. This is separate from the `mount-spike` crate and does not start, inspect, or import the mounted-drive implementation.
