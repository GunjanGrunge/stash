# Task 2 Report — Stash It vertical slice

**Status:** Implemented; validation in progress.

## Implemented
- Added `desktop/apps/stash-desktop/src-tauri/src/upload.rs` with a Windows-native file/folder picker, recursive non-following manifest scan, original relative path presentation, streaming SHA-256 checksums, 8 MiB parts, 10,000-part guard, process-local controller, safe status/source DTOs, cancellation, API create/check/register/sign/complete/abort/cancel calls, direct PUTs, transient ETag handling, and verified-only final success.
- Extended Rust API helpers and registered four Tauri commands in `lib.rs`.
- Added typed gateway/domain contracts and React `StashItScreen`; Home is authenticated default and exposes real storage/mount summaries plus honest Recent/Transfers/Offline states.
- Preserved Files hierarchy/navigation/sorting and added visual search treatment/type accents.
- Added Rust upload unit tests and frontend Node contract tests for gateway command shapes, state phases, non-exposure, and no-success-before-commit wording.
- Updated desktop README with manual flow, checksum convention, native boundary, and API deployment limitation.

## Boundary evidence
React receives only `SourceSummary` and `TransferStatus`. Native-only values include absolute source paths, checksum strings, bearer token, object keys, upload IDs, presigned URLs, raw bytes, and ETags. The frontend has no fetch/XHR/WebSocket and no AWS/Cognito references in the Stash It flow.

## Validation
- `cargo test --manifest-path desktop/Cargo.toml`: **21 passed, 0 failed** across the workspace (includes 5 upload tests).
- `cargo check --manifest-path desktop/Cargo.toml -p stash-desktop`: **passed**.
- UI `npm test`: **14 passed**; `npm run typecheck`: **passed**; `npm run build`: **passed**.
- Desktop Node contracts: **24 passed** (`welcome-contract` + `post-signin-contract`).
- `git diff --check`: **exit 0**; only existing LF/CRLF conversion warnings were emitted.
- Backend tests/typecheck: not run because no backend handler or infrastructure files were changed.
- No live AWS calls, deployment, or long-lived Tauri process was run.

## Explicit limitations
The current deployed API route availability is not confirmed; no live transfer claim is made. The native picker is Windows-first and returns an explicit unavailable message on non-Windows builds. Search, Favorites, Devices, Settings, offline/cache, and history behavior remain unavailable/empty rather than invented.
