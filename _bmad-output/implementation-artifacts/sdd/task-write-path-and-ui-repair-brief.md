# Root-Level Mount Write Path and UI Repair Task Brief

## Objective
Implement the approved conservative MVP for new root-level file creation through `S:\` and repair the active React splash, Stash It drop entry, and navigation behavior without replacing the current visual screens.

## Scope
- Add exact WinFsp create/open, offset write, cleanup/close finalization, and explicit rejection callbacks for overwrite, rename, delete, truncate, directory, nested, and unsafe paths.
- Keep committed cloud files read-only; spool new writes under the OS temp directory and inject one native sink into the filesystem crate.
- Reuse the verified Rust upload pipeline below Tauri commands; never expose native paths, bytes, tokens, URLs, ETags, or unverified success to React.
- Preserve `mount_status`, `mount_stash`, and `unmount_stash`, tray ownership, and lifecycle behavior.
- Use Tauri native window drag/drop events with a safe summary-only bridge, keep picker buttons as the keyboard fallback, fix Splash timers/callback stability, and give unavailable navigation destinations visible notices instead of reusing Files.
- Add focused Rust, upload/mount, UI contract, and desktop contract evidence.

## Non-goals
No overwrite, rename, delete-on-close, directory creation, nested mount paths, cloud-file mutation, mount reorganization, app-side refresh claim without a verified live model, AWS deployment, real S3/Cognito, or long-lived Tauri process.

## Acceptance boundary
A local write is only a safely scheduled upload until the existing server-side multipart and committed verification completes. Submission and upload failures enter `NeedsAttention`; temporary spools are cleaned idempotently. If a live server contract is unavailable, tests must cover the explicit failure boundary rather than fake success.
