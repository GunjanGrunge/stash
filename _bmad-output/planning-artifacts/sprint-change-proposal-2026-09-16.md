# Sprint Change Proposal — Recoverable File Deletion

## 1. Issue Summary

**Trigger:** While preparing a real upload/delete backend test, the team found
that STASH has no committed-file deletion route. The existing abort route only
cancels an incomplete multipart upload.

**New requirement:** A creator moves a committed file to Trash immediately,
can restore it for 30 days, and STASH permanently removes its S3 payload and
metadata after the retention period.

**Evidence:** the synthesized 14-route API has no `DELETE /files/{id}`; the
shared application role expressly excludes `s3:DeleteObject`; the S3 bucket is
unversioned, so a permanent deletion is irreversible.

## 2. Impact Analysis

Checklist: 1.1–1.3 done; 2.1–2.5 done; 3.1–3.4 done; 4.1–4.4 done;
5.1–5.5 done; 6.1–6.2 done; 6.3 approval pending; 6.4 not applicable until
approval; 6.5 pending handoff.

This is a moderate direct adjustment to the active API-surface work. It does
not conflict with the PRD: it preserves hierarchy, prevents accidental
destructive dedupe, and makes **Free up space** remain distinct from removing
cloud content. No existing epic is invalidated and no UI requirements are
derived from the unapproved mockups (AFR-003).

Affected artifacts: the control-plane spec/API reference, File state and
indexes, Data/API/Observability infrastructure, IAM, Lambda packaging, tests,
and frontend contract. The beta gains three HTTP routes and one scheduled
retention worker; stack count grows from five to six.

## 3. Recommended Approach

Choose **direct adjustment** (medium effort, medium risk), not rollback or
MVP reduction.

1. Add `DELETE /files/{id}`. It verifies JWT ownership, changes only a
   committed file to `trashed`, removes it from folder browsing, records
   `deletedAt` and `purgeAfter = deletedAt + 30 days`, and returns those values.
   It does not decrement quota: bytes remain stored and recoverable in Trash.
2. Add `GET /trash` and `POST /files/{id}/restore`. Restore is allowed before
   purge starts; it restores the folder index and committed state without
   moving, renaming, or changing the opaque S3 key.
3. Add sparse `gsi4` (per-user Trash listing) and `gsi5` (global purge due
   queue). Both are queried with pagination; no DynamoDB Scan is permitted.
4. Add a dedicated `StashRetentionStack`: a daily EventBridge-triggered purge
   Lambda claims due items using a conditional `purging` state, deletes the S3
   object, then atomically removes metadata and releases used quota. A crash
   after a claim is retryable; an S3 `NoSuchKey` is treated as already purged.
   Daily cadence means physical deletion occurs at 30 days plus at most 24
   hours.
5. Give only the purge Lambda a new, narrowly scoped role with S3
   `DeleteObject` and exact table/index permissions. The shared application
   role remains unchanged, as AFR-007 requires for a broader permission.
6. Add explicit log group, audit events without paths/keys, tests for tenant
   isolation, restore/purge races, 30-day eligibility, pagination, quota,
   route wiring, and role scope. Update the frontend API reference.

## 4. Detailed Artifact Changes

| Artifact | Proposed change | Why |
|---|---|---|
| Active API spec | Amend frozen intent and acceptance matrix with Trash/restore/purge lifecycle | The user renegotiated the scope. |
| Control-plane spec | Record `trashed`/`purging` File states, GSI4/GSI5, three routes, worker | Keeps architecture and API contract aligned. |
| `infra/lib/data-stack.ts` | Add two sparse GSIs | Supports listing and safe due-item query without Scan. |
| `infra/lib/retention-stack.ts` | New worker, EventBridge daily schedule, dedicated role | Isolates irreversible S3 permission. |
| `infra/bin/stash.ts` | Wire the sixth stack | Supplies table, bucket and log group dependencies. |
| Handler/entrypoint packages | Trash, restore, list-Trash and purge operations | Makes lifecycle callable and automated. |
| `docs/api-reference.md` | Document recovery window, quota semantics and all new endpoints | Lets frontend implement the flow safely. |

## 5. Implementation Handoff

Scope: **moderate**. A Developer subagent implements the handler/data model and
the retention stack under the SIA evidence gate. The controller reviews the
combined diff and runs clean `npm ci`, tests, typecheck and synth. No AWS
resource is deployed without a new explicit deployment approval.

Success means a trashed file is hidden but restorable for 30 days; only the
retention worker can permanently delete the payload; no cross-user or
restored-file race can delete data; the frontend contract accurately conveys
the recovery deadline and that Trash bytes still count toward quota.

## Approval

Approved by the user on 2026-09-16. Scope classification: moderate direct
adjustment. Handoff: Developer subagent under the SIA evidence gate; controller
integration and clean verification; separate explicit approval required before
any AWS deployment.
