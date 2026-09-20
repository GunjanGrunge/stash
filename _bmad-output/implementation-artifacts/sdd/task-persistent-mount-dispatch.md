# Persistent Mount Lifecycle Dispatch

**Task:** Implement the STASH process-lifetime mount lifecycle through the Tauri tray and close-to-tray window behavior.

**Workspace:** `desktop/apps/stash-desktop/src-tauri`, `desktop/apps/stash-desktop/ui`, and the desktop contract tests/evidence under `_bmad-output/implementation-artifacts/sdd/`.

**Preserve:** pre-existing React visual-slice work, Rust auth/API behavior, WinFsp/mount implementation, AWS/backend code, vendored tooling, `.kiro/specs`, and unrelated worktree changes.

## Implementation route
1. Read `AGENT.md`, current `MountController`, Tauri entry/config, active React title bar, retained static contracts, README, and worktree status.
2. Add the exact Tauri `tray-icon` feature pin policy and implement stable tray menu IDs, labels, icon, menu dispatch, left-click/double-click show behavior, and explicit unmount-before-quit.
3. Intercept `CloseRequested` with `prevent_close()` plus `hide()` and preserve the process-managed controller.
4. Update only the required title-bar naming and contract assertions; keep all IPC command names unchanged.
5. Add focused Rust intent/lifecycle tests, README manual flow, and the five execution evidence artifacts.
6. Run the requested Rust, UI, desktop Node, and diff validation without launching a long-lived Tauri process or mutating AWS.