# Persistent Mount Lifecycle Implementation Report

## Result
Implemented process-lifetime STASH mount behavior in the Tauri shell. The Rust `MountController` remains managed by Tauri and remains the only owner of the live WinFsp host. Closing the main window now prevents destruction and hides it to the tray; no unmount is performed. Tray `Unmount STASH` calls the existing controller unmount operation, and `Quit STASH` unmounts before calling `app.exit(0)`.

## Exact implementation files
- `desktop/apps/stash-desktop/src-tauri/Cargo.toml`: enabled Tauri's existing `tray-icon` feature; no external tray crate added.
- `desktop/apps/stash-desktop/src-tauri/src/lib.rs`: added stable tray/menu IDs and labels, configured-icon tray construction, menu/left-click/double-click dispatch, close-to-tray handling, and deterministic helper tests.
- `desktop/apps/stash-desktop/ui/src/components/TitleBar.tsx`: changed the close control's accessible label/title to `Hide STASH to tray` while retaining the existing `close` window action.
- `desktop/apps/stash-desktop/ui/index.html`: made the retained title-bar contract use the same honest label.
- `desktop/apps/stash-desktop/tests/welcome-contract.test.mjs`: updated the retained label assertion and added active React title-bar plus unchanged mount IPC command-name contracts.
- `desktop/apps/stash-desktop/ui/tests/foundation/foundation.test.ts`: updated the active UI accessibility contract for the honest hide-to-tray label.
- `desktop/apps/stash-desktop/README.md`: added the exact mount/close/reopen/unmount/quit manual flow and persistence boundary.

## Dependency/configuration change
The only dependency change is `tauri = { version = "2", features = ["tray-icon"] }`; the existing exact dependency policy and Tauri 2.11.5 resolution remain in place. No external tray package was introduced. `tauri.conf.json` already supplies the configured app icon used by `default_window_icon()`.

## Tests and validation
- `cargo test --manifest-path desktop/Cargo.toml`: passed; 16 `stash-desktop` unit tests and all workspace crate/integration tests passed. The existing linker emitted only the known WinFsp delay-load warning (`LNK4199`); it did not fail the run.
- `cargo check --manifest-path desktop/Cargo.toml -p stash-desktop`: passed.
- UI `npm test`: passed, 11/11.
- UI `npm run typecheck`: passed.
- UI `npm run build`: passed.
- Desktop Node contracts: passed, 24/24.
- `git diff --check`: exit 0; only existing LF/CRLF conversion warnings were reported.

No long-lived Tauri dev process was started, no AWS command was run, and no live tray GUI test is claimed because Windows GUI automation is unavailable.

## Boundary
Process-lifetime persistence is implemented. Reboot/startup persistence, autostart, and installer packaging are not implemented and remain separate future work. No live tray GUI automation is claimed because Windows GUI automation is not available in this validation environment.