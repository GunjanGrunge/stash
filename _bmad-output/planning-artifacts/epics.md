---
stepsCompleted: ["step-01-validate-prerequisites"]
inputDocuments:
  - STASH_PRD_v0.1.md
  - _bmad-output/planning-artifacts/specs/2026-09-15-aws-control-plane-design.md
  - _bmad-output/planning-artifacts/plans/2026-09-15-aws-control-plane-plan.md
  - AGENT.md
  - uisamples/ (4 images — NON-BINDING design exploration; no requirements derived)
---

# stash - Epic Breakdown

## Overview

This document provides the complete epic and story breakdown for STASH,
decomposing the requirements from the PRD and the approved AWS control-plane
spec (standing in for Architecture) into implementable stories. The
`uisamples/` images are explicitly excluded as a requirements source.

**Input note:** no `Architecture.md` exists. The approved control-plane spec
carries the architecture content (stack decisions, API contracts, data model,
IAM design) and is used in its place. The PRD lives at the project root rather
than in `planning_artifacts`.

## Requirements Inventory

### Functional Requirements

FR1: Present STASH as a mounted drive — `STASH (S:)` on Windows, a `STASH` entry under Locations on macOS — accessible through normal filesystem interactions where technically supported.
FR2: Provide a primary "Stash it" ingest action accepting one or many files, one or many folders, and mixed selections in a single operation, via picker or drag-and-drop.
FR3: Preserve the user's exact folder hierarchy on Stash and restore/display it identically; never rename, flatten, categorize, move or reorganize user content.
FR4: Expose per-file states: Cloud, Available (cached), Keep on this device (pinned), Stashing, Syncing, Issue.
FR5: Provide "Free up space" that evicts a locally cached copy without deleting the cloud object, labelled as freeing space rather than deleting.
FR6: Provide search accepting both ordinary keywords and simple creator-oriented structured expressions (e.g. `kick G# 120-130 bpm`, `4k footage 60fps`, `vertical video under 30 sec`).
FR7: Extract music metadata where discoverable from filename/path or inexpensive inspection: asset type, BPM, musical key, duration, sample rate, channels, format, pack/folder context.
FR8: Extract video metadata: resolution, width/height, orientation, frame rate, codec, duration, format, filename/path tokens.
FR9: Extract image/graphic metadata: dimensions, orientation, format, filename/path tokens, safe basic EXIF where useful.
FR10: Capture general metadata for every asset: filename, original path, extension, MIME type, size, created/modified timestamps, checksum, parent folder, Stash ID, source device.
FR11: Normalize search aliases (`G# = G♯ = GSharp = G Sharp`, `kicks = kick`, `vox = vocal = vocals`, `fx = sfx`).
FR12: Rank search results with TF-IDF or BM25-style lexical ranking plus exact/fuzzy token matching and structured metadata filters.
FR13: Generate a local folder manifest before upload containing relative paths, file sizes, fingerprints/checksums and hierarchy information.
FR14: Compare a folder manifest against existing folder manifests before payload upload and present the exact-match dialog (Cancel / Stash anyway) or the partial-match dialog (Add new files / Stash as separate copy / Cancel).
FR15: Never lose a copy from the user's logical filesystem on a content-hash match; any physical deduplication must be invisible and must never alter logical paths.
FR16: Make a user's STASH accessible from authorized Windows and macOS devices, with newly Stashed content appearing on other authorized devices after metadata synchronization.
FR17: Handle concurrent edits to the same file with explicit conflict handling; never silently merge binary creator assets.
FR18: On a drag-out of a cloud-only asset, check local cache, serve if cached, otherwise fetch from S3, stage locally, expose a readable file to the application, and retain per cache policy.
FR19: Provide a configurable local cache (initial default ~20–50 GB by device capacity) with LRU-style automatic eviction, excluding pinned assets.
FR20: Handle partial/temporary downloads and safely clean up abandoned cache entries.
FR21: Transfer large files directly between the authorized client and S3 using multipart upload with short-lived authorization, resumable transfers and individual part retries.
FR22: Authenticate users through Amazon Cognito.
FR23: Support device registration and device/session revocation.
FR24: Enforce per-user storage quota server-side (1 TB per beta user).
FR25: Provide a transfer queue showing progress for active Stashes.
FR26: Provide retry and error states for failed transfers.
FR27: Instrument usage telemetry and AWS cost telemetry sufficient to compute real monthly AWS cost per active 1 TB user.
FR28: Provide a Recent Stashes history view.
FR29: Provide a Storage & cache usage view.
FR30: Provide a Settings view covering account, devices and preferences.

### NonFunctional Requirements

NFR1: S3 buckets private by default; no public access.
NFR2: No permanent AWS credentials distributed to clients.
NFR3: Short-lived, scoped access for all data-plane operations.
NFR4: Least-privilege IAM throughout.
NFR5: TLS for all network transfers.
NFR6: Encryption at rest.
NFR7: Per-user authorization enforced on every metadata and data operation.
NFR8: Device and session revocation supported.
NFR9: Audit logging for sensitive operations.
NFR10: Safe handling of presigned access (short TTL, never logged).
NFR11: Server-side quota enforcement — the client is never trusted to check it.
NFR12: No cross-user object access under any circumstances.
NFR13: Safely handle network interruption, resumable/multipart uploads, part retries, failed downloads, incomplete local staging, app restart during Stashing, machine restart, temporary AWS/API failure, duplicate Stash attempts, metadata reconciliation and concurrent device activity.
NFR14: A failed transfer must never appear as successfully Stashed.
NFR15: Cloud-only assets consume negligible local storage until required.
NFR16: Cached access should approach local filesystem behaviour; network-dependent states must be communicated rather than hidden.
NFR17: Deterministic metadata and search — no LLM or chatbot in the v1 product runtime.
NFR18: Cache serves as both UX optimization and AWS egress/request cost optimization.
NFR19: Windows and macOS support.
NFR20: Creator-first, premium, uncluttered visual identity usable in light and dark environments; distinct from enterprise file managers and generic AWS visual language.

### Additional Requirements

From the approved control-plane spec (architecture source):

- **No starter template.** This is a greenfield repository with no scaffold; Epic 1 Story 1 must establish the toolchain itself (npm workspaces, TypeScript strict, Vitest, CDK). *Already delivered by SIA Task 1 — see Status note below.*
- Infrastructure as code in **AWS CDK v2 (TypeScript)**, four stacks: Identity, Data, Api, Observability; region **ap-south-1**.
- Lambda control logic in **TypeScript on Node 20**; payload bytes never transit Lambda or API Gateway.
- **DynamoDB single-table** design, on-demand billing, partition key `pk` / sort key `sk`, three GSIs (`gsi1` folder children, `gsi2` stash contents, `gsi3` checksum lookup); `user_id` prefixes every key so cross-tenant reads are unaddressable.
- **S3**: SSE-S3, versioning off, Standard class, Block Public Access, enforce-TLS bucket policy, 7-day abort of incomplete multipart uploads; object keys `users/<user_id>/<file_id>` with opaque IDs only.
- **Cognito**: SRP auth, no client secret (a desktop binary cannot hold one), MFA optional, self sign-up disabled, custom `quota_bytes` attribute.
- **API Gateway HTTP API** with a JWT authorizer on every route; `user_id` read only from verified claims.
- File state machine `pending → uploading → committed | failed`; only `committed` counts as Stashed, guarded by conditional writes verified against S3.
- Idempotency keys on all mutating batch operations; conditional writes with a `version` attribute for concurrency.
- Observability: explicit CloudWatch log retention, AWS Budgets alerts at 80%/100%, cost-allocation tags (`Project=STASH`, `Env=beta`).
- IAM assertion tests must fail the build on any `Resource: "*"` or any route missing its authorizer.

### UX Design Requirements

**None. This project has no UX design contract.**

The 4 images in `uisamples/` are a **design exploration — an idea, not a
product decision** (user, 2026-09-15: *"these are just mock up not real
features this is a design idea not a final product ui/ux"*). They are
therefore **non-binding** and **no UX-DR, epic, story or acceptance criterion
is derived from them.**

They are recorded here only as provenance, so a later session does not
rediscover them and mistake them for a contract:

- Two unreconciled visual directions are sketched — "Clean & Minimal
  (Canvas)" and "Creative & Dynamic (Pulse)" — in light and dark.
- Screens sketched: Home, Files, Search results, Favorites, Stash It sources,
  Transfers, Duplicate check, Asset details, Recent Stashes, Offline,
  Storage & Cache, Settings/Devices.
- Several sketched elements sit outside the PRD's beta scope entirely —
  Shared, Favorites/tags, waveform and video previews, "From Cloud"
  (Google Drive/Dropbox) import, mobile devices as authorized devices, and
  plan/billing upgrade. Under PRD §14 and §20 these are out of scope or
  future opportunities.

**A real UX design contract** (a `DESIGN.md` / `EXPERIENCE.md` spine, per
`bmad-ux`) must be authored before any client UI story is written. Until then
the PRD's §15 screen list and §16 information architecture are the only
binding UI requirements, and neither is in the currently approved scope.

### FR Coverage Map

{{requirements_coverage_map}}

## Epic List

{{epics_list}}
