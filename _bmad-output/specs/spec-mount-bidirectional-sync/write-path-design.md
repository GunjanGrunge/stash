# Write-path design and staged rollout

Supports SPEC.md capabilities CAP-1..CAP-5. This is HOW, not WHAT — SPEC.md is the contract; this is implementation-shaping context for the architecture/story-breakdown steps that follow.

## Current state

- `desktop/crates/stash-windows-fs` implements `FileSystemContext` read-only: `open`, `read`, `read_directory`, `get_security`, `get_file_info`. `write()` exists only as a stub returning `STATUS_MEDIA_WRITE_PROTECTED`. No `create`, `close` (write-committing), `rename`, `cleanup`(delete), or `mkdir`/`create_directory` callback is implemented. Root is flat — no subdirectory support at all yet.
- `desktop/apps/stash-desktop/src-tauri/src/upload.rs` already implements: recursive scan, streaming SHA-256 checksum, manifest registration, multipart authorization, direct-to-S3 PUT, ETag submission, and server-verified commit — triggered today only from the app's `+ Stash it` UI action.
- `stash-core`'s `Cache`/`RangeProvider` is the read-side abstraction the mount already uses; there is no equivalent write-side abstraction yet.

## Callback → pipeline mapping

| WinFSP callback | Target behavior |
|---|---|
| `create_directory` / `mkdir` | Resolve folder identity via the existing AFR-004 read-before-write lookup (same code path the app's folder creation already uses); conditional put; folder appears in-mount only after the resolve/create round-trip succeeds — no optimistic local-only directory. |
| `create` (new file) | Open a pending write buffer keyed to the mount path; do not touch the API yet — matches "the local filesystem write completing must not itself imply Stashed." |
| `write` | Append bytes to the pending buffer (spooled to a temp file, not memory, to bound RAM for large drags). |
| `close` / `cleanup` (final handle close after write) | Trigger the existing `upload.rs` pipeline against the spooled temp file: checksum → manifest → multipart authorize → PUT → verify → commit. Surface `Preparing`/`Stashing`/`Verifying` status the same way `+ Stash it` does today, via the same IPC status channel, so the app UI's transfer/notification surface (not just the Files list) reflects mount-originated activity. |
| `rename` | Resolve target folder identity (AFR-004 path) if the rename crosses folders; call the equivalent of the app's rename operation against the existing `Stash`/`File`/`Folder` API rather than inventing a mount-only rename. |
| `cleanup` with delete-on-close | Route through the existing Trash lifecycle (SPEC.md CAP-4) — same 30-day-retention API the app already calls, not a hard delete. |

## Conflict handling (CAP-5)

Decision: the losing side always gets an immediate, native Windows sharing-violation at write time (not a deferred Needs attention state). Two shapes of conflict:

1. **Same path, both sides write concurrently.** The mount holds an OS-level file handle during the spooled write; a concurrent app-side write to the same logical path should be rejected by the API's existing conditional-write guard (the same one that already prevents blind overwrites per rule 8), surfaced to the losing side as an error, not merged.
2. **Mount write succeeds locally, then fails verification.** Same as `+ Stash it` today: report `Needs attention`, never `Stashed`, and do not remove the user's local source (the drag-in file itself is not the source of truth — the temp spool is).

## Staged rollout

Each stage should ship and be verified independently rather than as one change.

1. **Stage 1 — Folder create + single-file drag-in (CAP-1, CAP-2 subset).** Implement `mkdir` and the `create`/`write`/`close` path for flat, single-file drops into an existing or newly-created folder. No rename/delete. Proves the write→checksum→commit round trip end to end.
2. **Stage 2 — Mount reflects app-side Stashes without remount (CAP-3).** The mount's directory listing must observe newly-committed Stashes from the app in the same session — likely a cache-invalidation signal from the app process to the running `MountController`, since the mount today only reads through `stash-core`'s `Cache` at open/enumerate time.
3. **Stage 3 — Rename and delete (CAP-4).** Delete routes through the existing Trash/restore API per SPEC.md.
4. **Stage 4 — Conflict hardening (CAP-5).** Concurrent-write tests across mount+app; the losing side must reliably get an immediate Windows sharing-violation, never a silent drop.

Folder-hierarchy support (subdirectories beyond the current flat root) is a prerequisite baked into Stage 1, not a separate stage — CAP-1 cannot ship without it.
