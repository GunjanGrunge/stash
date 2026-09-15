# STASH — AWS Control-Plane Foundation (Design Spec)

**Date:** 2026-09-15
**Status:** APPROVED 2026-09-15 (one structured approval round, user-approved)
**Source of truth:** `STASH_PRD_v0.1.md` (v0.1, Private Beta Definition)
**SIA stage:** Pipeline step 3 (Spec authoring)
**Scope owner decisions:** AWS CDK · TypeScript/Node.js Lambdas · deploy to real AWS (reversed from code-only on 2026-09-15 at user request)

---

## 1. Problem / Goal

STASH is a creator-first cloud drive. Creators keep large asset libraries —
sample packs, footage, LUTs, graphics — spread across machines and external
drives. The PRD's core promise is *"Stash it. Find it. Use it anywhere."*:
a mounted drive that preserves the creator's existing folder structure
exactly, keeps payloads in the cloud, and never reorganizes their library.

This spec covers **only the AWS control plane** — the server-side foundation
every other part of STASH will sit on. It is deliberately the smallest piece
that can be built, reviewed and security-gated on its own.

**In scope**

- CDK application defining the beta's AWS resources in `ap-south-1`.
- Cognito identity, JWT-authorized API Gateway, Lambda control logic.
- DynamoDB single-table design for the logical filesystem (PRD §11).
- S3 bucket policy, encryption, lifecycle and presigned-access model.
- Least-privilege IAM, server-side quota enforcement, audit logging.
- CloudWatch metrics and AWS Budgets for the cost telemetry the PRD calls
  the beta's most important commercial output (§18).
- Unit, IaC-assertion and local integration tests.

**Explicitly out of scope for this spec**

- The desktop client and any UI (PRD §15/§16) — no client technology is
  chosen yet; see Appendix A.
- The mounted-drive filesystem layer (WinFsp/ProjFS, macOS File Provider).
- The search/ranking engine (PRD §6) — the schema here *reserves* a place
  for `search_tokens` and `extracted_metadata` but computes neither.
- Metadata extraction (BPM, key, resolution, codec).
- Local caching, eviction and pinning (PRD §10).
- ~~Any deployment to a real AWS account.~~ **Superseded 2026-09-15:** the
  user has asked for the infrastructure to be provisioned in AWS. Deployment
  is now **in scope**, gated as follows: build and local verification proceed
  first; each `cdk deploy` is a separate High-severity approval; and no apply
  happens until valid credentials exist (the credentials currently in
  `~/.aws/credentials` fail `sts get-caller-identity` with
  `InvalidClientTokenId`). Provisioning uses AWS CDK over AWS CLI v2 — no AWS
  infrastructure MCP server is available in this environment.

**Definition of done for this scope**

The CDK app synthesizes cleanly, every handler has unit tests, IAM assertions
prove no wildcard resource grants, the security-gate checklist passes, and a
reviewer can read the combined diff and see how PRD §11 and §12 are satisfied
— without an AWS account being touched.

---

## 2. Architecture

The PRD's §11 split is the governing constraint: **payload never transits the
control plane.** Lambda authorizes transfers; bytes move directly between the
client and S3.

```
   Desktop client (out of scope — later spec)
        │
        │  1. SRP auth
        ▼
   ┌──────────────┐
   │   Cognito    │  user pool · app client · per-user quota attribute
   └──────┬───────┘
          │  JWT (id token)
          ▼
   ┌──────────────────────┐
   │   API Gateway (HTTP) │  JWT authorizer · throttling · access logs
   └──────────┬───────────┘
              │
              ▼
   ┌──────────────────────┐
   │   Lambda handlers    │  control logic only — no payload bytes
   └────┬────────────┬────┘
        │            │
        ▼            ▼
  ┌──────────┐   ┌─────────────────────┐
  │ DynamoDB │   │ S3 presign / signer │
  │ metadata │   │ role (scoped)       │
  └──────────┘   └──────────┬──────────┘
                            │ short-lived presigned URLs
                            ▼
   Client ────────── direct multipart transfer ────────── S3
```

Four CDK stacks, deployed in dependency order:

| Stack | Owns | Depends on |
|---|---|---|
| `StashIdentityStack` | Cognito user pool, app client, groups | — |
| `StashDataStack` | DynamoDB table, S3 bucket, lifecycle rules, KMS usage | — |
| `StashApiStack` | API Gateway, JWT authorizer, Lambda functions, IAM roles | Identity, Data |
| `StashObservabilityStack` | CloudWatch metrics/alarms, AWS Budgets, log retention | Api, Data |

Stacks are separated so that the blast radius of a change is visible in the
diff: a handler change never re-synthesizes the identity or data stack.

---

## 3. Components

### 3.1 `StashIdentityStack` — Cognito

**Responsibility:** prove who a request belongs to. Nothing else.

- User pool with email sign-in, MFA optional for the 2-user beta, password
  policy at AWS defaults or stricter.
- App client configured for **SRP** (desktop-native), refresh-token rotation,
  and **no client secret** — a desktop binary cannot hold one safely.
- Custom attribute `custom:quota_bytes` (default 1 TB, per PRD §14).
- No hosted UI: the desktop client authenticates natively.

**Inputs:** none (root of the dependency graph).
**Consumed by:** the API Gateway JWT authorizer; every handler reads
`sub` as `user_id` **from verified token claims only** — never from a request
body or path parameter.

### 3.2 `StashDataStack` — DynamoDB

**Responsibility:** hold the logical filesystem. PRD §11 is explicit that S3
"folders" must not be treated as a filesystem — DynamoDB is the truth.

Single-table design, on-demand billing (beta traffic is unpredictable and
2 users will not justify provisioned capacity).

| Entity | PK | SK | Notes |
|---|---|---|---|
| User | `USER#<user_id>` | `PROFILE` | quota_bytes, used_bytes |
| Device | `USER#<user_id>` | `DEVICE#<device_id>` | name, platform, registered_at, revoked_at |
| Folder | `USER#<user_id>` | `FOLDER#<folder_id>` | name, parent_folder_id, relative_path |
| File | `USER#<user_id>` | `FILE#<file_id>` | full PRD §11 attribute set |
| Stash | `USER#<user_id>` | `STASH#<stash_id>` | state, counts, bytes, started_at |
| Manifest | `USER#<user_id>` | `MANIFEST#<manifest_hash>` | folder_id, file_count, total_bytes |
| FolderIdentity | `USER#<user_id>` | `FOLDERID#<hex(parent)>#<hex(name)>` | folder_id — uniqueness guard, see below |
| Idempotency | `USER#<user_id>` | `IDEMPOTENCY#<hex(stash_id)>#<hex(key)>` | status_code, body — replayed verbatim |

**FolderIdentity** exists because DynamoDB cannot express a condition against
a GSI, so "at most one folder per (parent, name)" cannot be enforced on the
Folder item itself. A plain read-before-write is racy: two concurrent
registrations of the same path both miss, both insert, and **fork the
creator's library** (Rule 1). Each folder is therefore written as two items in
one transaction — the Folder record and this identity item, whose
`attribute_not_exists` guard exactly one writer can win.

Identity still comes from **lookup, never from hashing the path**, so a rename
remains a metadata write and every descendant keeps its `folder_id`. Each key
component is hex-encoded before joining, so a folder legitimately named `a#b`
cannot collide with — or forge — the identity of one named `a`.

Neither item type carries GSI attributes, so neither appears in any index.

Secondary indexes:

- **GSI1 — folder children:** `GSI1PK = USER#<user_id>#PARENT#<folder_id>`,
  `GSI1SK = <name>`. Serves the filesystem browser (PRD §15 screen 3).
- **GSI2 — stash contents:** `GSI2PK = USER#<user_id>#STASH#<stash_id>`,
  `GSI2SK = FILE#<file_id>`. Serves Recent Stashes and transfer recovery.
- **GSI3 — checksum lookup:** `GSI3PK = USER#<user_id>#SUM#<checksum>`.
  Supports duplicate *detection*; per PRD §7 a checksum match **never**
  implies deletion or path rewriting.

`user_id` is the partition key prefix on every entity and every index. This
is the structural guarantee behind "no cross-user object access" (PRD §12) —
cross-tenant reads are not merely denied, they are unaddressable.

File records carry a `state` of `pending | uploading | committed | failed`.
Stash records carry a `state` of `open | completed | cancelled`.
**Only `committed` counts as Stashed** (PRD §13: "A failed transfer must not
appear as successfully Stashed").

`search_tokens` and `extracted_metadata` are declared on the File entity and
left empty — reserved for the later search scope so no migration is needed.

### 3.3 `StashDataStack` — S3

**Responsibility:** hold payload bytes. Nothing interprets them here.

- Block Public Access on, bucket policy denying non-TLS
  (`aws:SecureTransport: false`) and unencrypted puts.
- SSE-S3 at minimum; SSE-KMS noted as an open cost/benefit decision (§7).
- Key layout: `users/<user_id>/<file_id>` — **opaque IDs only.**
  The creator's `original_relative_path` lives in DynamoDB, never in the key.
  This removes an entire class of path-traversal and key-injection bugs
  (see §6.1) and means renaming a folder is a metadata write, not an object
  copy.
- Lifecycle rule: abort incomplete multipart uploads after 7 days — directly
  serves PRD §13's "safe cleanup of abandoned cache entries" on the cloud
  side and prevents silent storage charges for dead uploads.
- Versioning **off** for beta, with a note: it is the cheapest insurance
  against client-side corruption, and is worth revisiting before real
  creator libraries land.

### 3.4 `StashApiStack` — API Gateway + handlers

HTTP API (not REST API): lower cost per request and a native JWT authorizer,
both of which matter for a cost-instrumented beta.

Handlers, each a separate Lambda with its own least-privilege role:

| Route | Handler | Responsibility |
|---|---|---|
| `POST /stashes` | `createStash` | Open a Stash; reserve quota; return `stash_id` |
| `POST /stashes/{id}/manifest-check` | `checkManifest` | Folder-level dedupe compare (PRD §7) |
| `POST /stashes/{id}/files` | `registerFiles` | Batch-register file intents, return upload authorizations |
| `POST /uploads/{file_id}/parts` | `signParts` | Presign multipart part URLs, short TTL |
| `POST /uploads/{file_id}/complete` | `completeUpload` | Complete multipart, flip file to `committed` |
| `POST /uploads/{file_id}/abort` | `abortUpload` | Abort multipart, release reserved quota |
| `POST /stashes/{id}/complete` | `completeStash` | Finalize; reconcile counts; emit metrics |
| `POST /stashes/{id}/cancel` | `cancelStash` | Abandon an open Stash; release the whole quota reservation |
| `GET /folders/{id}/children` | `listChildren` | Filesystem browse via GSI1 |
| `GET /files/{id}` | `getFile` | Asset details |
| `GET /stashes` | `listStashes` | Recent Stashes |
| `GET /me/usage` | `getUsage` | Storage indicator (`624 GB of 1 TB`) |
| `POST /devices` / `DELETE /devices/{id}` | `devices` | Registration and revocation (PRD §12) |

A shared `lib/` layer provides: claim extraction, request validation,
structured logging, error mapping, and the audit-event writer. Handlers
contain no ad-hoc AWS SDK setup.

### 3.5 IAM

- One execution role per handler. No shared "lambda-role".
- DynamoDB grants are action-scoped (`GetItem`/`Query` for read handlers;
  `PutItem`/`UpdateItem` only where writes occur) and table/index-scoped.
- The presign role can `s3:PutObject` **only** under
  `arn:aws:s3:::<bucket>/users/*`, and presigned URLs are issued with a TTL
  measured in minutes.
- No `Resource: "*"` grants. This is asserted in tests (§7), not just
  reviewed by eye.
- No long-lived AWS credentials exist anywhere in the repo or reach a client
  (PRD §12).

### 3.6 `StashObservabilityStack`

- Structured JSON logs; log-group retention set explicitly (default-infinite
  retention is a silent recurring cost).
- Custom metrics for the PRD §18 product measures available server-side:
  successful-Stash rate, resume success, duplicate-folder detections, API
  latency, bytes uploaded per user.
- AWS Budgets with alert thresholds, plus cost-allocation tags
  (`Project=STASH`, `Env=beta`, `UserId` where permitted) so the beta can
  actually answer *"real monthly AWS cost per active 1 TB user."*
- Audit events for sensitive operations (device revoke, quota change, upload
  authorization) written as structured log entries with a correlation id.

---

## 4. Data Flow — Stashing a folder tree

The product's main scenario, end to end.

1. **Auth.** Client authenticates via Cognito SRP; holds a short-lived id
   token. Every subsequent call carries it.
2. **Local manifest.** Client walks the selected folder and builds a manifest
   of relative paths, sizes and checksums (PRD §7). This is client work — the
   control plane only consumes the result.
3. **`POST /stashes`.** `createStash` writes a `Stash` record in state
   `open`, and performs a **conditional** `UpdateItem` on the user profile to
   reserve `used_bytes + manifest_total`. If the condition fails, the caller
   gets `507 Insufficient Storage` and no Stash is created. Quota is enforced
   server-side — a client is never trusted to check it (PRD §12).
4. **`POST /stashes/{id}/manifest-check`.** `checkManifest` hashes the
   normalized manifest and queries the `MANIFEST#` records. Three outcomes,
   matching PRD §7 exactly:
   - **100% match** → `{ match: "exact", folder, file_count, bytes }`; client
     shows *"You already have this folder in STASH"* with Cancel / Stash anyway.
   - **Partial** → `{ match: "partial", new_files: [...] }`; client shows
     *"1,847 of 1,850 files already Stashed"* with Add new files / Stash as
     separate copy / Cancel.
   - **None** → `{ match: "none" }`.
   This happens **before any payload upload**, which is the point of the
   feature — bandwidth saved, not just a dialog shown. A Cancel here calls
   `POST /stashes/{id}/cancel`, which releases the quota reserved in step 3;
   a Stash never holds a reservation it will not use.
5. **`POST /stashes/{id}/files`.** `registerFiles` creates `Folder` records
   for each distinct directory in the tree (preserving `parent_folder_id` and
   `original_relative_path` verbatim — PRD §4.1) and `File` records in state
   `pending`. It returns a `file_id` and an S3 key per file. Batched to stay
   inside DynamoDB's 25-item transaction limit; batches are idempotent on a
   client-supplied `Idempotency-Key`.
6. **`POST /uploads/{file_id}/parts`.** `signParts` initiates the multipart
   upload, flips the file to `uploading`, and returns presigned part URLs.
7. **Direct transfer.** Client PUTs parts straight to S3. No bytes touch
   Lambda or API Gateway. Failed parts are retried individually against a
   re-signed URL (PRD §13).
8. **`POST /uploads/{file_id}/complete`.** `completeUpload` calls
   `CompleteMultipartUpload`, verifies the resulting object's size and ETag
   against the registered manifest entry, and only then conditionally flips
   the file to `committed`. A mismatch leaves it `failed`.
9. **`POST /stashes/{id}/complete`.** `completeStash` re-counts committed
   files via GSI2, corrects the reserved quota to the actual committed total,
   closes the Stash, and emits the success metric.
10. **Other devices.** A second authorized device calls `listChildren` and
    `listStashes` and sees the new content — metadata sync is a read of the
    same table, not a replication mechanism (PRD §8).

**Duplicate-detection invariant (PRD §4.3, §7):** identical checksums in
different packs stay separate assets. `KSHMR Vol 4/Kicks/Kick_G#_128.wav` and
`KSHMR Vol 5/Kicks/Kick_G#_128.wav` are two `File` records with two S3 keys.
Nothing in this spec deletes or repoints a user's logical path on a hash match.

---

## 5. Error Handling

| Failure | Behaviour |
|---|---|
| Expired/invalid JWT | `401` at the authorizer; handler never runs |
| Request for another user's resource | `404`, not `403` — existence is not disclosed |
| Quota exceeded | `507`; conditional write fails; no Stash opened |
| Duplicate request replay | `Idempotency-Key` + conditional put; returns the original result rather than double-writing |
| Network drop mid-upload | Parts retried individually; Stash stays `open`; client resumes from `GET` of file states |
| App or machine restart mid-Stash | Recoverable: `pending`/`uploading` files are re-queryable via GSI2, so the client resumes rather than restarts |
| User cancels at the duplicate-folder dialog | `cancelStash` releases the full quota reservation and closes the Stash as `cancelled`; any `pending` file records are deleted. Without this, cancelling a 4.2 GB dedupe check would strand 4.2 GB of quota |
| Client vanishes with a Stash left `open` | Reservation is bounded: a Stash `open` longer than 48h is reconciled against its committed files and the excess reservation released |
| Multipart abandoned entirely | S3 lifecycle aborts after 7 days; reserved quota released by `completeStash` reconciliation or by the abort handler |
| S3 complete succeeds, DynamoDB write fails | File stays `uploading`; reconciliation on next `completeStash` re-verifies against S3 and commits or marks `failed`. **Never silently "Stashed".** |
| Concurrent edits from two devices | Conditional writes on a `version` attribute; conflict returns `409` with both states. Binary creator assets are **never** auto-merged (PRD §8) |
| Transient AWS/API failure | Exponential backoff with jitter; idempotency makes retry safe |
| Malformed manifest entry | `400` with the offending relative path; the whole Stash is rejected rather than partially accepted |

The governing rule, taken straight from PRD §13: **a failed transfer must
never present as successfully Stashed.** Every state transition into
`committed` is a conditional write guarded by verification against S3.

---

## 6. Security

Run against the fixed checklist in `sia/guides/security-gate.md`.

### 6.1 Findings already designed out

- **Key/path injection.** Client-supplied `original_relative_path` is
  attacker-controlled data (`../`, absolute paths, NUL bytes, unicode
  normalization tricks). It is stored as a DynamoDB attribute and **never**
  concatenated into an S3 key; keys are `users/<user_id>/<file_id>` with
  server-generated UUIDs. Paths are additionally validated on registration:
  rejected if absolute, containing `..` segments, or exceeding length limits.
- **Expression injection.** All DynamoDB access uses parameterized
  `ExpressionAttributeNames`/`Values`. No user input is concatenated into a
  condition or projection expression.
- **Tenant isolation.** `user_id` comes from verified JWT claims only. A
  request body carrying a `user_id` is ignored, and tests assert this.
- **Hard-coded secrets.** None. No client secret on the Cognito app client,
  no AWS credentials in source, no tokens in URLs or logs. Presigned URLs are
  redacted in structured logs.
- **Untrusted metadata is not trusted output.** Filenames and paths are
  creator-controlled strings that a later UI will render. They are stored
  raw and escaped at render time — flagged now so the client spec inherits
  the rule rather than rediscovering it.

### 6.2 Not applicable at this layer

XSS and unescaped LLM output — no DOM and no model in the control plane. The
PRD's §4.5 "no unnecessary AI" means there is no prompt-injection surface in
this scope either.

---

## 7. Testing

All verification is local. **Nothing deploys.**

1. **Unit tests** (Vitest + `aws-sdk-client-mock`) for every handler:
   happy path, auth failure, cross-tenant attempt, quota exceeded,
   idempotent replay, and each error row in §5.
2. **IaC assertion tests** (`aws-cdk-lib/assertions`) — executable policy,
   not review-by-eye:
   - no IAM statement with `Resource: "*"`;
   - S3 bucket has Block Public Access and a deny-insecure-transport policy;
   - the incomplete-multipart lifecycle rule exists;
   - every log group has explicit retention;
   - every route has the JWT authorizer attached (a route without one is a
     test failure, not a review comment).
3. **Integration tests** against **DynamoDB Local** for the real access
   patterns: folder-tree round trip preserving hierarchy exactly, GSI1
   children listing, manifest exact/partial/none, and concurrent conditional
   writes.
4. **Hierarchy-preservation property test.** Generate random folder trees
   (including unicode, spaces, `#`, very long names), register and read back,
   assert byte-identical structure. This is PRD §4.1 — the product's central
   promise — held to a test rather than an intention.
5. **`cdk synth`** must succeed as a build gate.
6. **Security-gate checklist** re-run against the combined diff before the
   scope is called done.

**Acceptance for this spec:** all of the above green, plus an Integration
phase per `sia/AGENT.md` step 7 — full suite run, cross-task interfaces
verified in combined code, and the whole diff reviewed as one unit.

---

## 8. Decisions (resolved)

All five were decided by the user on 2026-09-15. None remain open.

| Decision | Resolution | Consequence carried forward |
|---|---|---|
| Encryption | **SSE-S3** | No per-object KMS request charge distorting the beta's cost measurement. Revisit before public launch — SSE-KMS is what buys per-key revocation. |
| S3 versioning | **Off** | Cheapest storage, but an overwrite is unrecoverable. The client must therefore never overwrite an existing key: every Stash writes a new `file_id`. Asserted in tests. |
| Storage class | **Standard** | Avoids Intelligent-Tiering's per-object monitoring charge, which is punitive at 14,291-small-sample scale. |
| MFA | **Optional** | Acceptable for a named 2-user beta; would be a finding for a public launch. Recorded as a standing rule so it is re-raised rather than inherited silently. |
| `prd.md` | **Deleted** (was 0 bytes) | Done 2026-09-15. |
| `.github/agents/` | **Still open** | Not answered; 18 BMAD-generated files currently untracked-but-not-ignored. They would enter the first commit. |

---

## Appendix A — Desktop client stack (decision deferred, options as requested)

Not part of this scope; recorded so the later decision starts from evidence.
The deciding factor is not UI — it is which stack makes the **mounted-drive
layer** (WinFsp/ProjFS on Windows, File Provider on macOS) tractable, since
the PRD's §5.1 mounted drive is the product's highest technical risk.

| Option | Strengths | Costs |
|---|---|---|
| **Electron + TypeScript** | One language with the CDK/Lambda code here; richest UI ecosystem; fastest to a polished §15 screen set | ~100 MB bundle; mount layer still needs native per-OS modules; memory-heavy for a background daemon |
| **Tauri + Rust** | Small, fast, low idle footprint — right shape for an always-on sync daemon; Rust is close to the native FS APIs the mount needs; strong WinFsp/FUSE bindings | Two languages in the project; smaller ecosystem; slower UI iteration |
| **Native per-OS (Swift + C#/WinUI)** | Best possible mount integration and OS-native feel, which is exactly where this product lives | Two complete clients to build and maintain — likely unaffordable at beta scale |

A recommendation is not made here. It should follow the mounted-drive spike
named as an option at intake, because that spike is what turns this from a
preference into a measurement.

---

## Appendix B — PRD traceability

| PRD requirement | Where satisfied |
|---|---|
| §4.1 Preserve filesystem | §3.2 Folder entity; §7 test 4 |
| §4.2 File/Folder/Stash distinct | §3.2 separate entities |
| §4.3 Metadata ≠ identity | §4 invariant; GSI3 detection-only |
| §7 Folder dedupe before upload | §3.4 `manifest-check`; §4 step 4 |
| §8 Multi-device, no silent merge | §5 conflict row; §3.4 devices |
| §11 AWS stack & storage model | §2, §3.2, §3.3 |
| §12 Security requirements | §3.3, §3.5, §6 |
| §13 Reliability | §5 in full |
| §18 Cost telemetry | §3.6 |
