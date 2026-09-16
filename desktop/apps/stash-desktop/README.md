# STASH desktop welcome shell

This package is the isolated Windows Tauri shell for the **Welcome / Sign in** screen. It intentionally has no filesystem-adapter, mount, Cognito, API, cloud, token, or credential integration.

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

The two account actions only update an on-screen status message. Cognito wiring and all sign-in behavior are explicitly future work. This is separate from the `mount-spike` crate and does not start, inspect, or import the mounted-drive implementation.
