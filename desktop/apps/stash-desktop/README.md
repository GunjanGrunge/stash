# STASH desktop welcome shell

This package is the isolated Windows Tauri shell for the **Welcome / Sign in** and post-sign-in STASH file browser screens. Sign-in remains on the Rust side; the browser requests metadata and mount actions through Tauri IPC.

The browser preserves the File/Folder hierarchy, shows breadcrumb navigation, loading/empty/error states, selection details, and storage usage. Drive mounting is Rust-owned and persists while STASH remains running; write-through sync is intentionally a later slice. The UI never claims a mount or upload succeeded without a service response.

## Prerequisites

- Rust stable with the Windows MSVC toolchain
- Microsoft Edge WebView2 Runtime
- Tauri's Windows build prerequisites (WebView2, C++ Build Tools, and Windows SDK)
- Tauri CLI 2 (`cargo install tauri-cli --version "^2.11"`)

## Launch locally

The Tauri configuration loads the generated React distribution at `ui/dist`. On a clean checkout, install and build the isolated UI before launching Tauri:

```powershell
npm --prefix desktop/apps/stash-desktop/ui ci
npm --prefix desktop/apps/stash-desktop/ui run build
cargo tauri dev --config desktop/apps/stash-desktop/src-tauri/tauri.conf.json
```

The same first two commands are the required frontend build hook for packaging or manual desktop validation; Tauri must not be launched against the legacy `ui/` source directory.

Run the static UI contract tests with:

```powershell
node --test desktop/apps/stash-desktop/tests/welcome-contract.test.mjs
node --test desktop/apps/stash-desktop/tests/post-signin-contract.test.mjs
```

The Welcome window uses a custom, Windows-style title bar. Drag its empty left area; the right-side controls minimize, maximize/restore, and hide STASH to the tray. Check each control with pointer and keyboard, maximize/restore the window, resize it with enlarged Windows text, tab through the controls and account actions, and inspect both system light and dark modes for focus visibility or overlap.

**Sign in** performs a real Cognito SRP sign-in against the deployed User Pool (`ap-south-1_0ELYEOOy0`), handling the `NEW_PASSWORD_REQUIRED` challenge for accounts created with a temporary password. **Remember me on this device** is unchecked by default. When selected, STASH stores only Cognito's rotating refresh token as opaque bytes in the current Windows user's Credential Manager and restores the session at the next launch. When unselected, it removes any older remembered session after a successful sign-in. The password is never stored and the short-lived ID token stays in process memory. **Sign out** removes the remembered sign-in from this device and returns the app to sign-in. **Create account** is still a placeholder. This is separate from the `mount-spike` crate and does not start, inspect, or import the mounted-drive implementation.

For a manual session check, sign in with the checkbox enabled, close and relaunch STASH, and confirm the library opens without requesting a password. Then Sign out, relaunch, and confirm the Sign in screen appears. Repeat with the checkbox disabled and confirm no session is restored.
## Persistent mount lifecycle development test

On a Windows development machine with WinFsp installed and an authenticated STASH account:

1. Mount STASH.
2. Close the window and verify `S:` remains available.
3. Reopen STASH from the tray.
4. Choose **Unmount STASH** from the tray menu and verify `S:` disappears.
5. Mount again, choose **Quit STASH**, and verify `S:` disappears before the process exits.

This implements persistence for the lifetime of the running process: closing the window hides STASH to the tray without dropping the Rust-owned `MountController`. Reboot/startup persistence and installer packaging are separate future work and are not implemented by this task. Automated validation covers the deterministic Rust tray intent/lifecycle helpers and UI contracts; live tray interaction remains a Windows GUI/manual check rather than a claimed automated test.

## Stash It vertical slice

The authenticated Home screen is now the default. `+ Stash it` opens the Rust-owned source picker and local manifest review. The Windows desktop boundary scans the selected file/folder recursively, preserves original relative names, computes streaming `sha256:<lowercase-hex>` checksums, runs manifest check, registers pending files, requests multipart authorizations, PUTs parts directly to the returned storage URLs, submits ETags for server verification, and completes the Stash only after the API reports verified committed state. React receives only source names/relative paths/counts/sizes and `Preparing`, `Stashing`, `Verifying`, `Stashed`, `Needs attention`, or `Canceled` status; it never receives payload bytes, absolute paths, credentials, object keys, upload ids, presigned URLs, or ETags.

Manual flow: sign in, select `+ Stash it`, choose a file or folder, review the displayed original paths and totals, confirm `Stash it`, observe the phase transitions, and cancel while active to exercise the safe cancellation path. Files keeps the exact File/Folder hierarchy and sorting behavior, with a disabled search treatment and explicit unavailable states for unimplemented history, Offline, Transfers, Search, Devices, and Settings capabilities.

The deployed API is not confirmed for this client slice. Validation uses Rust unit tests and fake/frontend contract tests only; do not run live AWS calls or deployment as part of local verification. A real desktop run requires the control-plane routes and S3 presigning/verification deployment to be available. If any control-plane or storage result is unknown, the client reports `Needs attention` and never `Stashed`.
