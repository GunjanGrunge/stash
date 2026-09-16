# Task Brief: Retention infrastructure and permanent purge

Goal: Wire the Trash HTTP routes and build the scheduled, race-safe 30-day permanent-purge worker with its own narrowly scoped role.

Files: `infra/lib/{api-stack,data-stack,observability-stack,app-role-stack}.ts`; new `infra/lib/retention-stack.ts`; `infra/bin/stash.ts`; `infra/test/**`; new `services/entrypoints/src/purge-trash.ts`; new `services/handlers/retention/**`; `package-lock.json` and package manifests only if the workspace requires them; `_bmad-output/implementation-artifacts/sdd/task-retention-infrastructure-report.md`.

Interfaces: API adds `DELETE /files/{id}`, `GET /trash`, and `POST /files/{id}/restore`, all JWT-authorized. Data stack exposes sparse `gsi4` and `gsi5` matching FileRecord keys. Retention worker queries only due gsi5 records, conditionally claims a `trashed` record as `purging`, deletes its opaque S3 object, then conditionally deletes metadata and reduces used quota. A restored/foreign file must never be physically deleted. S3 `NoSuchKey` is a retry-safe successful purge condition.

Acceptance Criteria: 17 HTTP routes/functions with matching explicit log groups; sixth retention stack has one daily EventBridge schedule, one retention Lambda, and one dedicated role granting exactly the needed S3 DeleteObject and table/index actions; shared application role still has no `s3:DeleteObject`; comprehensive unit/CDK tests pass.

Effort Budget: 24 tool calls.

Relevant Standing Rules:
- AFR-005 — A quality gate must cover new code structurally, never by enumeration.
- AFR-006 — A conservative guard is only as strong as the query that feeds it. When correctness depends on all candidate rows, paginate the query.
- AFR-007 — One shared application role is a user-directed deviation from least privilege. Any future handler needing a genuinely broader permission gets its own role rather than widening this one.

Host Evidence: Codex collaboration subagent; dispatched 2026-09-16.

Escalate, don't improvise, when: stop and report back rather than working around any of the following — an unexpected dependency the brief didn't mention; a file the brief didn't list needing changes; a conflicting or already-modified file; a requirement in the brief that's ambiguous enough to support two different implementations; a missing tool, credential, or piece of environment the task needs; a test that fails for a reason unrelated to this task's own change; or the Effort Budget being exceeded with the task still incomplete.
