# Persistent Mount Lifecycle Task Brief

## Objective
Keep a mounted STASH drive alive for the lifetime of the running Tauri process when the main window is closed, while providing explicit tray controls to show the window, unmount the drive, or quit cleanly.

## Scope
- Enable Tauri's existing `tray-icon` feature; no external tray dependency.
- Build a tray with stable IDs and the accessible labels `Show STASH`, `Unmount STASH`, and `Quit STASH`, using the configured app icon.
- Hide, rather than destroy, the main window on `CloseRequested`.
- Reuse the Rust-owned `MountController`; retain `mount_status`, `mount_stash`, and `unmount_stash` IPC names and behavior.
- Add deterministic Rust helper tests and desktop UI contract checks.
- Document the Windows manual lifecycle flow and the explicit reboot/autostart/installer boundary.

## Non-goals
No webview-owned mount state, WinFsp handle persistence in browser state, backend/API changes, AWS work, installer work, reboot/startup autostart, vendored tooling changes, `.kiro/specs` changes, or live GUI automation claim.