---
id: SPEC-mount-bidirectional-sync
companions: [write-path-design.md]
sources: []
---

> **Canonical contract.** This SPEC and the files in `companions:` are the complete, preservation-validated contract for what to build, test, and validate. Source documents listed in frontmatter are for traceability — consult them only if you need narrative rationale or prose color this contract intentionally omits.

# Bidirectional STASH Mount Sync

## Why

Today STASH ships two disconnected halves: a fully-implemented upload path (`+ Stash it` — checksum, multipart S3 upload, verified commit) reachable only from the app UI, and a mounted `S:` drive that is explicitly a read-only, flat-root feasibility spike (`desktop/crates/stash-windows-fs`) with no write path, no subdirectories, no rename, no delete. The user's mental model is Dropbox: one library, reachable and editable from either the mounted drive in Explorer or the app itself, always in sync. Closing that gap is a vision to realize — turning the proven mount into the primary, symmetric way to add and organize content, not just a read-only preview.

## Capabilities

- **CAP-1**
  - **intent:** A user can create a folder — including an empty one, not just as a side effect of adding a file — from the mounted drive or from the app, and it appears, at the same name and position, on the other side.
  - **success:** Creating `Beats/Demos` in Explorer on `S:` makes `Beats/Demos` appear in the app's Files view at the same path, and vice versa, without a remount. An empty folder stays visible and usable as a Save As target on both sides.

- **CAP-2**
  - **intent:** A user can add a file of any type to STASH by dragging it into the mounted drive, or via another application's "Save As" dialog targeting the mount, and it is ingested through the same checksum → verified-commit pipeline as `+ Stash it`.
  - **success:** Dragging `track.wav` into `S:\Beats\Demos` results in a new committed Stash visible in the app at `Beats/Demos/track.wav`, only after server-side verification — never before. Small files commit in seconds; large files show a visible `Stashing`/`Verifying` progress state for as long as the real upload takes, with no artificial latency cap.

- **CAP-3**
  - **intent:** A user can add a file or folder via the app's existing `+ Stash it` flow and see it appear at the matching path in the mounted drive without restarting the app or remounting the drive.
  - **success:** Completing a Stash in the app makes the resulting file(s) readable at the corresponding path under `S:` within the same session.

- **CAP-4**
  - **intent:** A user can rename or delete a file or folder from either the mounted drive or the app, and the change propagates to the other side. Deletion from the mount reuses the existing 30-day-retention Trash lifecycle rather than being unrecoverable or having separate semantics.
  - **success:** Renaming a file in Explorer on `S:` updates its name in the app's Files view; deleting it from the app removes it from `S:`. A file deleted from the mount appears in the app's existing Trash/restore surface, recoverable for 30 days, identically to an app-side delete.

- **CAP-5**
  - **intent:** When the mount and the app attempt to write to the same path at the same time, the system never silently drops or overwrites one side's write.
  - **success:** A concurrent write from both sides to the same path leaves the losing side with an immediate, native Windows sharing-violation error at write time — never a silent overwrite, drop, or blend.

## Constraints

- A mount-originated write is not reported as present/committed until the same server-verified-commit step `+ Stash it` already requires (AGENT.md rule 4); the local filesystem write returning success must not itself imply "Stashed."
- No write, from either side, may overwrite an existing S3 key (AGENT.md rule 8 — S3 versioning is off); every mount-originated create or re-save mints a new `file_id`/key rather than reusing one.
- Folder creation from the mount reuses the existing read-before-write, conditional-put folder identity resolution (AFR-004: resolve by `(userId, parentFolderId, name)` before minting) — never a blind create, from either side.
- Mount-originated uploads go direct-to-S3 via the same presigned multipart path `+ Stash it` already uses (AGENT.md rule 9); payload bytes must not be routed through Lambda/API Gateway merely because the trigger was a filesystem write.
- `user_id` for every mount-originated operation comes from the same verified JWT session the app already holds (AGENT.md rule 7); the mount must not open a separate credential or identity path.
- Original file and folder names/paths are preserved verbatim on ingestion from the mount, with no renaming, flattening, or reorganization (AGENT.md rule 1).
- A same-path conflict between the mount and the app is surfaced synchronously as an OS-level sharing violation, not resolved silently after the fact or deferred to a background reconciliation pass.
- Mount-originated delete calls the same Trash/restore API and 30-day retention the app already has — no second delete lifecycle to keep consistent.

## Non-goals

- Real-time, sub-second passthrough sync. Eventual consistency with a bounded, visible in-progress state (`Preparing`/`Stashing`/`Verifying`, reusing `+ Stash it`'s existing status vocabulary) is acceptable, and no fixed latency cap is imposed.
- In-place edit-and-resave of an existing Stash's payload. Because a Stash is an ingestion event, not a live-editable object (AGENT.md rule 2), and S3 versioning is off (rule 8), any re-save of a mounted file becomes a new Stash, not a mutation of the old one.
- Multi-device concurrent mounts. Only one authenticated device's mount plus its own app instance is covered; two machines mounting the same account at once is future work.
- Full POSIX filesystem semantics — permissions, symlinks, extended attributes, hard links. Only create, read, rename, and delete of files and folders are in scope.

## Success signal

From Windows Explorer on the mounted `S:` drive, a user creates a folder and drags in a file of any type; within a bounded, visibly-communicated time the app's Files view shows that exact folder/file at the same path, verified-committed in S3/DynamoDB. Conversely, a Stash completed in the app appears at the correct mount path without a remount. Neither side ever shows a file or folder as present that the server has not verified, and a same-path race between the two sides always surfaces as a visible error rather than a silent loss.

## Assumptions

- The existing `+ Stash it` checksum/multipart-upload/verified-commit pipeline (`desktop/apps/stash-desktop/src-tauri/src/upload.rs`) is reused as-is for mount-originated writes, not reimplemented, since it already satisfies the rule 4/8/9 constraints above.
- Rollout is staged rather than big-bang, given the mount today (`desktop/crates/stash-windows-fs`) is an explicitly-scoped read-only, flat-root spike with no subdirectories or write callbacks implemented yet. See `write-path-design.md` for the staged plan.
