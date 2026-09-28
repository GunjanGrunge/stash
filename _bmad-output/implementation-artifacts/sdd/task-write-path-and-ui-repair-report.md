# Root-Level Mount Write Path and UI Repair Implementation Report

## Result
Implemented the conservative root-level new-file MVP without replacing the current frontend screens.

## Native/backend changes
- `stash-windows-fs` now validates one safe root-level UTF-16 filename while preserving Unicode code units and rejecting separators, nested paths, dot components, drive syntax, controls, and empty names.
- Added an injected `WriteSink`, file-backed `WriteSpool` under the OS temp directory, per-handle pending state, offset-aware writes, write-to-EOF support, and idempotent cleanup/close finalization.
- Existing committed entries remain read-only. Create collisions return an explicit collision status; directory create, overwrite, rename, delete, truncate, constrained I/O, and unsafe/nested requests are explicitly rejected.
- `mount.rs` injects one native sink, uses a writable volume flag only to permit the create callback, and preserves mount ownership and command names. The sink schedules a native upload and changes submission failures to `NeedsAttention`.
- `upload.rs` exposes a Rust-only mount spool submission seam that builds a manifest, streams checksum/multipart upload through the existing verified pipeline, cleans the spool after completion/failure, and only sets `Stashed` after the existing complete/committed response. React still receives only safe summaries/status.
- Tauri window drag/drop is handled in Rust. React receives only sanitized phase and source summary notices; absolute dropped paths never enter React state or gateway arguments.
- Updated the mount spike’s stale context constructor reference so the full workspace test gate compiles.

## UI changes
- Splash uses stable completion refs, a single completion guard, and cleanup for both interval and delayed completion timer; Skip remains a keyboard button and the dialog is modal/accessibly named.
- Stash It and Home show native drag-over/accepted/rejected states, keep Choose file/folder buttons, clean polling and event listeners, and preserve safe source summaries.
- Search, Favorites, and Recent Stashes render a labeled unavailable surface rather than silently reusing Files. NavigationRail now renders notice and refresh/retry props while mount controls remain unchanged.
- Added source-contract tests for splash cleanup/skip, native drop entry, drag-over state, visible notices, and non-reuse navigation. Updated the standalone foundation harness to run under the existing Node test command.

## Validation
- `cargo test --manifest-path desktop/Cargo.toml`: PASS — 23 desktop tests, 13 WinFsp tests, 3 core tests, 3 range-provider tests, remaining workspace/doc tests pass. Known WinFsp delay-load linker warning only.
- `cargo check --manifest-path desktop/Cargo.toml -p stash-desktop`: PASS.
- UI `npm test`: PASS — 14 Node tests.
- UI `npm run typecheck`: PASS.
- UI `npm run build`: PASS.
- Desktop Node contracts: PASS — 24 tests.
- `git diff --check`: DEVIATION — the full worktree check reports pre-existing trailing whitespace in unrelated `services/handlers/stashes` files; no reported line is in this task’s files. The repository already contained those unrelated changes before this task, so they were not rewritten.

No AWS deployment, real S3/Cognito call, or long-lived Tauri process was run. Live Explorer/WinFsp behavior and server verification remain outside this local evidence gate.
