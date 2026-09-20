# Root-Level Mount Write Path and UI Repair Dispatch

## Dispatch

| Slice | Owned files | Responsibility |
|---|---|---|
| Native write boundary | `desktop/crates/stash-windows-fs/src/lib.rs` | Root-only path validation, pending handle/spool, offset writes, callback rejection, cleanup and exactly-once sink scheduling. |
| Native integration | `desktop/apps/stash-desktop/src-tauri/src/mount.rs`, `upload.rs`, `lib.rs` | Writable volume configuration, injected sink, Rust-owned drag/drop event handling, verified upload reuse, safe failure status, and stable lifecycle command names. |
| Active UI | `desktop/apps/stash-desktop/ui/src/components/*`, platform/domain adapters, styles, foundation contracts | Splash cleanup, native summary-only drop subscription, visible drag-over state, explicit unavailable navigation, notices/retries, stable keys/handlers. |
| Validation compatibility | `desktop/crates/mount-spike/src/main.rs`, UI foundation harness | Keep the existing mount spike compiling with the current context API and make the Node foundation gate execute without importing Vitest runtime globals. |

## Constraints
Preserve the existing screens and visual treatment. Do not add cloud/API endpoints, expose native paths or payload material to React, claim `Stashed` before verification, run AWS commands, or start a long-lived Tauri process. Required evidence files are maintained under `_bmad-output/implementation-artifacts/sdd/`; `progress.md` is append-only.

## Verification plan
Run focused and full Cargo tests, desktop Cargo check, UI test/typecheck/build, desktop Node contracts, and `git diff --check`. Live WinFsp/Explorer and real cloud upload are not claimed by automated validation.
