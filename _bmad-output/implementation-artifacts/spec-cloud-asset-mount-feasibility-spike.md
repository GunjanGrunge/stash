---
title: 'Open a cloud-only asset through STASH (S:)'
type: 'feature'
created: '2026-09-16'
status: 'in-progress'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: 'b03c206dd3af601a549aa6a0ee404b8b7379a597'
context:
  - 'AGENT.md'
  - '_bmad-output/planning-artifacts/architecture/architecture-stash-2026-09-16/ARCHITECTURE-SPINE.md'
  - '_bmad-output/planning-artifacts/ux-designs/ux-stash-2026-09-16/EXPERIENCE.md'
  - 'docs/api-reference.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** STASH cannot yet serve a cloud-only asset through a mounted drive.
Creative applications need normal directory enumeration, file handles, random
byte-range reads, and bounded failures; a management dashboard alone cannot
prove the product promise.

**Approach:** Deliver one vertical feasibility spike: a caller-scoped,
short-lived download lease from the existing control plane plus a Rust/WinFsp
`STASH (S:)` mount that reads a committed cloud asset by byte range through a
segment-aware local cache. Prove it in Explorer and a real installed creative
application before building the Tauri dashboard.

**Decision:** STASH targets normal Windows filesystem semantics for every
application that can access a mounted drive. No individual creative-tool vendor
is an integration target or product dependency; Explorer and available creative
applications provide compatibility evidence only.

## Boundaries & Constraints

**Always:** preserve File/Folder/Stash distinctions and original hierarchy;
derive identity only from Cognito JWT claims; keep payload bytes direct between
the Rust core and S3; use opaque server-owned object keys only inside trusted
backend/core layers; bound network waits and report a filesystem error rather
than stalling indefinitely; retain GPLv3 compatibility for the WinFsp crate.

**Never:** add permanent AWS credentials to a client; send payloads through
Lambda/API Gateway; persist or log tokens, object keys, or presigned URLs;
claim compatibility from STASH's own UI alone; add Tauri dashboard screens,
macOS support, full sync, upload, search, or cache-LRU feature breadth in this
spike; deploy or install WinFsp without separate explicit approval.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Read lease | Caller owns a committed file | `POST /files/{id}/download-url` returns a short-lived URL and TTL; response has no `objectKey` | URL is held in core memory only |
| Unauthorized / unavailable file | Foreign, missing, trashed, purging, pending, uploading, or failed file | Indistinguishable `404`; no S3 presign call | No metadata or object existence disclosure |
| Random read | Creative tool seeks inside a cloud-only file | WinFsp requests are served from verified cache segments or one direct S3 `Range` request | Expired lease is renewed once before surfacing a bounded I/O error |
| Offline/cache miss | No usable network and requested bytes absent | Call returns promptly with a filesystem error | UI/core event identifies an actionable network issue; no indefinite wait |
| Large directory | Metadata mirror has a large folder | Enumerate/stat from local metadata, not one network request per entry | Stale/unknown entries refresh in background, never block enumeration unboundedly |

</frozen-after-approval>

## Code Map

- `services/handlers/files/src/get-file.ts` -- caller-scoped committed-file
  lookup pattern; hides foreign and unavailable records. Reuse ownership/state
  rules; do not expose its internal record directly.
- `services/handlers/uploads/src/sign-parts.ts` and `src/s3-multipart.ts` --
  reusable presign abstraction and server-only object-key selection pattern.
- `services/entrypoints/src/clients.ts` -- module-scope AWS client convention.
- `infra/lib/api-stack.ts` -- one JWT-authorized Node Lambda per route.
- `infra/lib/observability-stack.ts` -- explicit log group required for every
  API Lambda; update in lockstep with the new handler.
- `infra/lib/app-role-stack.ts` -- shared role already scopes `s3:GetObject`
  to `users/*`; do not broaden it.
- `docs/api-reference.md` -- client contract; current `GET /files/{id}` is
  metadata-only and must remain so.
- `desktop/` -- absent today; create an independent Cargo workspace. Do not
  add Rust crates to the root npm workspace.
- `brand/icons/windows/STASH.ico` -- later packaging icon; do not crop or
  transform supplied assets in this spike.

## Tasks & Acceptance

**Execution:**
- [ ] `services/handlers/files/src/create-download-lease.ts` and tests -- add
  caller-scoped, committed-only lease issuance through a small presigner port.
- [ ] `services/entrypoints/src/create-download-lease.ts`, `src/clients.ts`,
  `infra/lib/api-stack.ts`, `infra/lib/observability-stack.ts`, API/infra tests,
  and `docs/api-reference.md` -- compose the JWT route and short-lived S3 GET
  presigner without key/URL logging or new IAM permissions.
- [ ] `desktop/Cargo.toml`, `desktop/crates/stash-core/`, and tests -- create
  the Rust domain service with a range-provider port, verified segment cache,
  bounded timeout policy, and no UI dependency.
- [ ] `desktop/crates/stash-windows-fs/` and `desktop/tests/mount-spike/` --
  add a WinFsp adapter that maps read/enumerate/stat to the core. Use a local
  range-server fixture for automated tests and document the separately approved
  live WinFsp/S3 manual run.
- [ ] `desktop/README.md` -- record Windows prerequisites, GPLv3 notices,
  WinFsp installation/run steps, and the Explorer + selected-tool evidence
  procedure. No installer or Tauri shell yet.

**Acceptance Criteria:**
- Given a caller-owned committed file, when the lease route is called, then it
  returns a short-lived read URL/TTL and never returns an object key.
- Given a noncommitted or another user's file, when the route is called, then
  it returns `404` and the S3 presigner is not called.
- Given an open file handle, when a consumer asks for a nonsequential byte
  range, then only the requested/missing segments are fetched and verified
  before being returned.
- Given a cache miss while the network is unavailable, when a consumer reads,
  then the operation completes within the configured bound with an I/O error.
- Given any application that uses normal Windows mounted-drive semantics and a
  cloud-only test asset, when it opens and seeks or scrubs via `STASH (S:)`,
  then it works without a permanent local full-file download or an indefinite
  application stall.

## Implementation Notes

## Spec Change Log

## Review Triage Log

## Design Notes

The download lease is deliberately a new `POST` action rather than changing
`GET /files/{id}`. That keeps durable metadata reads free of bearer URLs and
lets the core renew an expiring lease without treating asset details as a
payload protocol. S3 supports HTTP `Range` GETs; the core, not Lambda, performs
those direct reads.

## Verification

**Commands:**
- `npm test` -- expected: existing suite plus lease handler/entrypoint/infra tests pass.
- `npm run typecheck` -- expected: all TypeScript workspaces pass.
- `npm run synth` -- expected: API route, Lambda, and explicit log group synthesize.
- `cargo test --manifest-path desktop/Cargo.toml` -- expected: core cache/range and filesystem-adapter tests pass.

**Manual checks:**
- After explicit approval to install WinFsp and deploy the read-lease backend,
  mount `STASH (S:)`, open the test asset in Explorer and any available
  standards-compliant creative application, seek/scrub it, then repeat during
  simulated network loss. Record timing and observed failure behavior without
  logging secrets.
