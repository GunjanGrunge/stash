---
name: stash-architecture
description: Use when making or checking an architectural decision in STASH — component boundaries, the control-plane/data-plane split, the DynamoDB single-table model, state machines, or whether a change belongs in this scope. Loads the binding architecture invariants before design work.
---

# STASH — Architecture Skill

**Authority:** `AGENT.md` outranks this file. Binding architecture source:
`_bmad-output/planning-artifacts/specs/2026-09-15-aws-control-plane-design.md`.

## The One Rule That Shapes Everything

**The control plane authorizes; it never carries payload.** Lambda and API
Gateway issue short-lived presigned authorizations; bytes move directly
between the client and S3. Any design that routes file content through a
Lambda is wrong, however convenient.

## Component Boundaries

| Stack | Owns | Must not |
|---|---|---|
| `StashIdentityStack` | Cognito pool + desktop client | know about files or storage |
| `StashDataStack` | DynamoDB table, S3 bucket, lifecycle | contain business logic |
| `StashApiStack` | HTTP API, JWT authorizer, handlers, per-handler IAM | share one role across handlers |
| `StashObservabilityStack` | log retention, metrics, budgets, tags | be skipped "for now" — cost telemetry is a beta deliverable |

Stacks are separate so a handler change never re-synthesizes identity or data.
`infra/bin/stash.ts` is the only file that instantiates them.

## The Logical Filesystem Is DynamoDB, Not S3

S3 "folders" are not a filesystem and must never be treated as one. The
hierarchy lives in DynamoDB:

- `pk = USER#<user_id>`, `sk = <ENTITY>#<id>` for User, Device, Folder, File,
  Stash, Manifest.
- `gsi1` folder children · `gsi2` stash contents · `gsi3` checksum lookup.
- `user_id` prefixes every key and index, so cross-tenant reads are
  **unaddressable**, not merely denied.
- S3 keys are `users/<user_id>/<file_id>` — opaque. A folder rename is a
  metadata write, never an object copy.

## State Machines (both are load-bearing)

- **File:** `pending → uploading → committed | failed`. Only `committed`
  counts as Stashed, and only via a conditional write verified against S3.
- **Stash:** `open → completed | cancelled`. An `open` Stash holds a quota
  reservation; cancelling or the 48h sweep releases it.

## Deciding Whether Something Belongs Here

Ask in order:
1. Does the PRD put it in the private-beta scope (§14), or in §20 future?
2. Is it in the currently approved spec's scope, or a later one?
3. Does it need payload bytes in the control plane? If yes, redesign.
4. Does it weaken tenant isolation, quota enforcement or the commit guard?
   If yes, it is not a trade-off — it is a defect.

Anything ambiguous goes back to the user as options with trade-offs, never a
silent decision.
