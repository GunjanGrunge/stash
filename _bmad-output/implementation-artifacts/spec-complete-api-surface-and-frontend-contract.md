---
title: 'Complete API surface and frontend contract'
type: 'feature'
created: '2026-09-15'
status: 'in-progress'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: '4d1c1b3355c80c2cec2acfdc318b75f297e6c9ae'
context:
  - 'AGENT.md'
  - '_bmad-output/planning-artifacts/specs/2026-09-15-aws-control-plane-design.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** STASH has 11 deployed, JWT-authorized control-plane endpoints, but asset details and device management are absent. The frontend also lacks one authoritative, implementation-ready reference for authentication, provisioning, request shapes, direct S3 upload, errors, and retries.

**Approach:** Add the missing `getFile` and device APIs using the established dependency-injected handler, Dynamo adapter, Lambda entrypoint, and CDK route pattern. Add a recoverable Trash lifecycle: a committed file is hidden immediately, restore is available for 30 days, and a dedicated retention worker permanently purges it thereafter. Publish a frontend API reference that documents all HTTP endpoints and the canonical Stash workflow from Cognito sign-in through direct multipart upload.

## Boundaries & Constraints

**Always:** derive user identity exclusively from the verified JWT `sub`; scope every Dynamo read/write to `USER#<sub>`; return cross-user and unknown resources as indistinguishable 404s; use the existing shared Lambda role, `stash-*` function naming, explicit log groups, and JWT authorizer; preserve File, Folder, and Stash as distinct entities; keep S3 object keys and presigned URLs out of persistent frontend state and all API logs; soft-revoke rather than delete device records; Trash a committed file for 30 days before permanent purge; test route parameter names against handler parsing.

**Never:** deploy or mutate AWS resources in this work; pass payload bytes through Lambda/API Gateway; accept a caller-supplied user ID; expose a raw Dynamo File record or opaque S3 `objectKey`; claim that device revocation invalidates Cognito sessions unless the selected contract includes the required Cognito/session linkage; reorganize creator paths.

**Decisions:** Device removal is metadata-only soft revocation for this beta: it records `revokedAt` and audit evidence but does not invalidate Cognito tokens. The Stash route/body mismatch is repaired now: the path `{id}` is authoritative and a conflicting body ID is rejected with a structured 400.

**Trash decisions:** `DELETE /files/{id}` returns a recoverable Trash record; `GET /trash` lists it; `POST /files/{id}/restore` restores it before purge. Trashed bytes remain in quota. A daily worker permanently removes only due, conditionally-claimed items, so physical purge is no earlier than 30 days and no later than roughly 31 days. The worker has its own narrow S3-delete role; the shared application role is not widened.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Read owned asset | JWT user requests `GET /files/{id}` for their FILE item | 200 with a documented storage-neutral asset-detail view | no object key or presigned URL returned |
| Read missing or foreign asset | no FILE item in caller partition | identical 404 | no existence disclosure |
| Register device | authenticated caller sends ratified device metadata | server-owned device ID and active device view | validation errors are 400 |
| Revoke device | caller revokes an active owned device | record remains with `revokedAt` and audit logging | foreign/unknown device is 404; repeat behavior follows ratified contract |
| Stash path consistency | path stash ID and body stash ID disagree | reject rather than authorize work on the wrong Stash | 400 with structured error |
| Direct upload | client obtains part URLs and PUTs payload directly to S3 | client collects ETags, completes each file, then completes the Stash | URLs expire after 900 seconds and must be treated as bearer secrets |

</frozen-after-approval>

## Resolved Decisions

- Device registration accepts a client-persisted `installationId`, plus `name` and `platform`; retrying registration returns or updates that same Device record.
- Deleting an already-revoked owned device returns `204`, making retries safe.

## Code Map

- `services/handlers/files/src/{types,repository,memory-repository,dynamo-repository}.ts` — existing logical FILE model and caller-scoped Dynamo access; extend with a narrow file lookup rather than add a second file store.
- `services/handlers/files/src/list-children.ts` and `services/handlers/read/src/{get-usage,http}.ts` — handler/error/claim conventions to reuse for `getFile`.
- `services/shared/src/index.ts` — verified JWT extraction and typed HTTP errors; do not duplicate auth parsing.
- `services/entrypoints/src/{clients,list-children,get-usage}.ts` — Lambda composition convention; add one entrypoint per new handler.
- `infra/lib/api-stack.ts` and `infra/test/api-stack.test.ts` — authoritative route declarations, authorization, shared role, function-name/log-group requirements; grow from 11 to 14 exact routes/functions.
- `infra/lib/observability-stack.ts` and its tests — provision a log group for each new `stash-*` Lambda.
- `services/handlers/*/test` and `infra/test` — unit, adapter, entrypoint/route synthesis regression coverage.
- `docs/` — new frontend-facing API reference; it must be generated from handler/test evidence, not UI mockups.

## Tasks & Acceptance

**Execution:**

- [ ] `services/handlers/files/**`, `services/entrypoints/src/get-file.ts` — implement a caller-scoped, storage-neutral asset-detail endpoint and focused unit/Dynamo tests.
- [ ] `services/handlers/devices/**`, `services/entrypoints/src/{register-device,revoke-device}.ts` — add a narrow Device persistence port, conditional registration, soft revocation, typed errors, structured audit logging, and tests according to the approved revoke contract.
- [ ] `infra/lib/{api-stack,observability-stack}.ts`, relevant tests — wire three JWT-authorized ARM64 Node Lambda routes with matching path parameter names, shared role, and explicit log groups.
- [ ] existing Stash handlers/tests, if approved — eliminate the path/body Stash-ID inconsistency without widening the public API.
- [ ] `docs/api-reference.md` — document base URL configuration, Cognito ID-token use, 1 TB Dynamo PROFILE prerequisite, all endpoint contracts, error/retry/idempotency rules, direct-S3 multipart sequence, pagination, and known beta limits.

**Acceptance Criteria:**

- Given an ID token for creator A, when A reads A's file, then the response contains only the documented asset-detail view; when A reads creator B's file, then the response is 404.
- Given valid device registration data, when a creator registers and revokes a device, then its Dynamo identity is stable, revocation is retained for audit, and cross-user access is 404.
- Given the synthesized API, when routes/functions/log groups are counted, then there are 14 of each API handler/log group, every route uses the JWT authorizer, and no new IAM role exists.
- Given the frontend reference and a freshly provisioned beta user, when a client follows its Stash sequence, then it can authenticate, create/check/register/upload/complete/browse without AWS credentials or undocumented route parameters.

## Implementation Notes

## Spec Change Log

## Review Triage Log

## Design Notes

The device endpoint is intentionally separated from Cognito session semantics until the product selects a real device-session relationship. A `revokedAt` timestamp is auditable and reversible; deleting a record would erase the event and violate the approved single-table model.

The frontend reference is a backend contract, not a UI contract. It deliberately leaves screen design to a future approved UX artifact (AFR-003).

## Verification

**Commands:**

- `npm test` — expected: all unit, adapter, route-synthesis, and documentation-contract guards pass.
- `npm run typecheck` — expected: all workspaces, including the new device package, are structurally type-checked.
- `npm run synth` — expected: five stacks synthesize; API route/function/log-group assertions pass.
