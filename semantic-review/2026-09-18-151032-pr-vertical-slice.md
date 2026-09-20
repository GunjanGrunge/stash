# Windows Stash It vertical slice with screenshot-aligned Home and Files

This change adds a Windows-native Stash It flow: Rust selects and scans one file or folder, builds a hierarchy-preserving manifest, authorizes multipart uploads through the control plane, sends parts directly to S3, and exposes only safe source/status DTOs to React. The authenticated React shell now lands on Home, keeps `+ Stash it` reachable, presents real usage/mount state, and preserves the Files hierarchy while leaving unimplemented surfaces explicit. The backend contracts confirm the intended create → manifest-check → register → sign → direct PUT → complete-file → complete-stash topology and verify size/ETag before a file is committed. **Watch for:** **confirmed** exact manifest matches are canceled without a separate-copy choice; **confirmed** the SHA-256 check is not bound to the bytes actually uploaded and the backend does not compare SHA-256; **confirmed** cancellation can race finalization and the failure cleanup path can over-release quota; **confirmed** retries and unknown API outcomes are not recovered. **Verdict**: NEEDS_CHANGES

## High-level view

The native boundary is correctly placed: filesystem paths, checksums, payload reads, bearer credentials, object keys, upload IDs, presigned URLs, and ETags stay in Rust, while React receives source metadata and transfer state. Relative-path construction does not normalize Unicode and the backend stores raw path/name values, but the transfer currently treats an exact dedupe result as a terminal duplicate rather than an explicit choice to create a distinct Stash.

The control-plane sequence matches the current route and handler contracts, and the S3 multipart ETag/part-number assumptions align with the S3-managed AES256 bucket. **Confirmed:** the checksum contract is metadata-only and cannot detect a source mutation after the preflight hash.

**Confirmed:** cancellation is locally immediate but not transactionally coordinated with server finalization. The current error path aborts a file and then cancels the Stash using reservation values that do not reflect in-flight committed files; **confirmed** network failures can also leave an unknown open Stash because the operation keys and replay strategy do not recover an uncertain create or completion. Closing the overlay stops the only active status poll, so Home can retain stale transfer state.

Home is the authenticated default, Stash It is reachable from Home and the rail, sample data is not fabricated, and Files continues to navigate and sort the File/Folder hierarchy. The visual treatment is materially closer to the approved expressive Home direction while keeping approved STASH vocabulary; the Windows picker, live AWS deployment, and visual accessibility/manual checks remain unverified.

<details>
<summary>Issues (6)</summary>

1. **Exact-match separate-copy choice (confirmed)** — An `exact` manifest result immediately calls `/stashes/{id}/cancel` and reports that nothing was uploaded, so an identical pack cannot become a distinct asset/Stash as required by the identity and approved duplicate-folder UX rules. Add an explicit duplicate review with a separate-copy/continue choice; only cancel when the creator chooses it.
2. **SHA-256 bound to uploaded bytes (confirmed)** — The client hashes the source before opening it for transfer, while the backend commits based on size and multipart ETag only. Hash the bytes that are actually read/uploaded and have the backend verify a stored SHA-256/S3 checksum before `committed`.
3. **Cancellation race and quota reconciliation (confirmed)** — A cancel flag can be set between the final cancellation check and `/complete`, allowing `Stashed` after the user canceled; aborting a file and then canceling the Stash can also refund overlapping reservation bytes while leaving committed/uploading records. Serialize cancel/finalize and add one server-side reconciliation path that aborts or accounts for every file state exactly once.
4. **Unknown outcomes and retry recovery (confirmed)** — Multipart PUTs have no retry/backoff or URL renewal, complete/sign calls have no replay key, and create/register keys are regenerated on a new confirmation. Use stable per-operation idempotency keys, recover lost responses before opening a new Stash, and retry individual parts according to the API contract.
5. **Canonical status after leaving Stash It (confirmed)** — Unmounting the overlay stops its polling effect, so Home can remain on an old `Stashing`/`Verifying` status and the unavailable Transfers surface cannot provide the canonical state. Move polling/state ownership to the shell/controller or provide a persistent transfer store and poller.
6. **Incomplete manifest review (confirmed)** — The review surface renders only eight entries before confirmation, so it does not show every selected original relative path required by the picker contract. Provide a complete scrollable manifest or an equivalent full-value review before enabling `Stash it`.

</details>

<details>
<summary>Details</summary>

### Exact dedupe currently discards the separate-copy path

The backend's manifest check is conservative: it uses folder name plus raw path/size/checksum identity, returns `none` for ambiguous same-name candidates, and never deletes or repoints an existing asset. Registration always mints new file IDs and opaque `users/<user>/<file_id>` keys, so the backend can represent identical content in separate Stashes.

**Confirmed:** the client removes that option for the `exact` case. In `desktop/apps/stash-desktop/src-tauri/src/upload.rs:265-275`, `ManifestCheckResponse::Exact` records `manifest_match = "exact"`, calls `/stashes/{stash_id}/cancel`, and returns an error. That contradicts the approved experience contract's duplicate-folder flow (`EXPERIENCE.md:203-217`): the creator must be able to review the location and choose a safe destination or cancel, and the contract explicitly says a checksum match must not promise reuse. The concrete fix is to expose the exact result as a blocking review state with `Stash as a separate copy` and `Cancel Stash`; the separate-copy branch must proceed with the original manifest and new file IDs without merging or repointing.

### SHA-256 is computed, but not an upload integrity contract

**Confirmed:** the client performs a useful preflight hash at `upload.rs:365-367`, then opens the source and reads parts at `upload.rs:386-399`. A file can change after the hash returns and before or during those reads: same-size changed content can be uploaded and committed under the old checksum, and a larger file can have its original-size prefix committed. There is no post-read hash comparison and no size check on the bytes read before a part is sent.

The backend handler confirms the gap. `services/handlers/uploads/src/complete-upload.ts:109-149` verifies the assembled object's size and the multipart ETag derived from submitted part ETags, then conditionally commits; it never compares the stored `file.checksum` to an S3 SHA-256 checksum. The ETag assumption itself is valid for the configured S3-managed AES256 bucket and the client submits the quoted ETags accepted by `parseParts`, but ETag proves the multipart assembly, not the registered SHA-256 content identity. The remediation should make the checksum authoritative: either send S3 checksum headers through the presigned-part contract and verify the assembled checksum server-side, or have the client hash exactly the bytes it uploads and add a server-verifiable checksum field before the conditional commit. A final source rehash is still useful to detect local mutation, but it cannot replace server-side verification of the stored object.

### Cancellation can claim a race-lost success and mis-account quota

**Confirmed:** `cancel_stash` sets the local atomic flag and immediately returns `Canceled` (`upload.rs:192-207`). The transfer checks that flag before finalization at `upload.rs:333`, but then calls `/stashes/{id}/complete` and unconditionally sets `Stashed` at `upload.rs:336-345`. If cancellation wins locally after the check while complete wins on the server, the UI can end at `Stashed` after the creator requested cancellation. Conversely, if cancel wins on the server, complete can fail while the local cancellation path suppresses the cleanup error.

The error cleanup has a separate accounting defect. When `upload_file` fails, the client first calls `/uploads/{file_id}/abort` and then `/stashes/{stash_id}/cancel` (`upload.rs:309-323`). The abort handler releases that file's reserved quota; the Stash cancel handler then computes `reservedBytes - committedBytes` and only deletes `pending` files (`services/handlers/stashes/src/cancel-stash.ts:65-70`). `committedBytes` is not updated as each file completes; it is reconciled only by complete-stash. Therefore a failure after earlier files committed can release the whole reservation again, and the just-aborted file can be included in both refunds. The server's `Math.max(0, ...)` guard masks negative values but does not make the profile accurate; committed objects remain while quota is under-counted.

The fix must be a server-owned cancellation/failure finalization that serializes against completion, aborts outstanding multipart uploads, removes or marks uncommitted records, preserves committed files, and adjusts quota from actual per-file state exactly once. The client should treat the server's conditional result as authoritative: if completion won, show verified `Stashed`; if cancellation won, show `Canceled`; if either outcome is unknown, show `Needs attention` and reconcile rather than claiming either state.

### Replay and retry behavior stops short of the API contract

**Confirmed:** the client creates process/time-based keys at `upload.rs:28-37`; a second confirmation generates a new create key and can reserve a second Stash after the first response was lost. Register has one key for one attempt, but sign-parts, complete-upload, cancel, and complete-stash calls do not pass idempotency keys. A lost complete response can leave a committed file while the client aborts/cancels and later starts a new ingestion, and a lost create response leaves the client without a Stash ID to reconcile.

Each direct PUT is a single `send()` with no exponential backoff, individual part retry, or expired-presigned-URL renewal (`upload.rs:399-404`). This does not match `docs/api-reference.md`'s retry rule or its explicit instruction to renew expired part URLs and retry failed parts individually. Use a stable operation identity for the selected manifest, replay-safe keys for mutating calls supported by the handlers, and an unknown-outcome recovery path before opening a replacement Stash. Keep the retry unit at the part level so already-uploaded parts and their multipart upload ID are reused.

### Home default, safe DTOs, and Files hierarchy

The React gateway allowlists Tauri commands and sanitizes responses; the source/status DTOs omit checksums, URLs, IDs, ETags, credentials, absolute paths, and bytes. Rust owns the Cognito ID token in process memory and the transfer material; the approved remembered-session contract intentionally permits an opted-in Cognito refresh token in Windows Credential Manager, which is separate from the transfer boundary and is not exposed to React or logs. No live AWS deployment is claimed: the README explicitly says API route availability is unconfirmed and validation used fakes/local tests only.

`Shell` initializes `active` to `Home`, Home uses real usage/mount summaries, and Recent Stashes/Transfers/Offline are explicit empty or unavailable states rather than fake sample data. The navigation rail and Home both expose `+ Stash it`. Files keeps distinct File/Folder entities, original path display, breadcrumbs, and presentation-only sorting; no library reorganization was introduced. **Confirmed:** the native picker is Windows-only and the review list intentionally displays only the first eight entries, so a real Windows picker run and confirmation that every selected entry is reviewable remain limitations rather than verified behavior.

### Validation and worktree limitations

Passed locally:

- `cargo test --manifest-path desktop/Cargo.toml` — 21 desktop/workspace tests passed.
- `npm test` from `desktop/apps/stash-desktop/ui` — 14 UI contract tests passed.
- `npm run typecheck` and `npm run build` from `desktop/apps/stash-desktop/ui` — passed.
- `node --test desktop/apps/stash-desktop/tests/welcome-contract.test.mjs desktop/apps/stash-desktop/tests/post-signin-contract.test.mjs` — 24 tests passed.
- `git diff --check` — passed, with only existing LF/CRLF conversion warnings.

Not run: root backend tests and typecheck. `npm test -- --run services/handlers/...` and root `npm run typecheck` both stopped because `vitest`/`tsc` are not installed in the repository root. No live Cognito/API/S3 call, deployment, real multipart PUT, GUI picker smoke test, screen-reader/contrast/200%-scale review, or long-lived Tauri run was performed.

The worktree also contains unrelated remembered-session, persistent-mount, planning/evidence, logs, and other pre-existing changes. There is no `main` branch in this checkout; the local implementation review was against `HEAD` on `frontend/post-signin-screen`, not against `main`.

</details>

<details>
<summary>Files changed</summary>

- `desktop/apps/stash-desktop/src-tauri/src/upload.rs` — Windows picker, manifest scanning, checksum/part transfer, cancellation, and transfer DTOs.
- `desktop/apps/stash-desktop/src-tauri/src/api.rs` — Rust-owned upload API calls and safe error handling.
- `desktop/apps/stash-desktop/ui/src/components/{HomeScreen,StashItScreen,FilesScreen,Shell,NavigationRail}.tsx` — authenticated Home, Stash It review/progress, and hierarchy-preserving Files surfaces.
- `desktop/apps/stash-desktop/ui/src/platform/tauri/gateway.ts` and `ui/src/domain/types.ts` — typed IPC allowlist and safe DTO validation.
- `desktop/apps/stash-desktop/ui/src/styles.css` — screenshot-aligned Home, rail, Files, Stash It, light/dark, and responsive styling.

Full tracked worktree diff: `git diff HEAD`; untracked implementation files are listed by `git status --short` and were inspected directly.

</details>
