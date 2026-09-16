# Task Brief: Trash API lifecycle

Goal: Implement caller-scoped soft delete, Trash listing, and restoration for committed files, without deleting S3 payloads.

Files: `services/handlers/files/src/types.ts`; `services/handlers/files/src/repository.ts`; `services/handlers/files/src/{dynamo-repository,memory-repository,get-file}.ts`; new `services/handlers/files/src/{trash-file,list-trash,restore-file}.ts`; `services/handlers/files/test/**`; new `services/entrypoints/src/{trash-file,list-trash,restore-file}.ts`; `docs/api-reference.md`; `_bmad-output/implementation-artifacts/sdd/task-trash-api-report.md`.

Interfaces: `DELETE /files/{id}` returns a storage-neutral Trash view containing `id`, `state: "trashed"`, and `purgeAfter`; `GET /trash` lists only the caller's trashed files; `POST /files/{id}/restore` restores only a caller-owned, not-yet-purging File. `FileRecord` must carry the sparse Trash-list and purge-queue keys needed by the retention worker. No S3 call or quota change occurs here.

Acceptance Criteria: foreign/missing resources are 404; only committed files can be trashed; Trash invisibly removes an item from normal folder children and `getFile`; restore faithfully reintroduces the same logical file/folder identity; repeated delete is idempotent; all tests are added and pass.

Effort Budget: 20 tool calls.

Relevant Standing Rules:
- AFR-004 — Entity identity must be stable across invocations, not minted per call. Any test proving a hierarchy invariant must exercise at least two separate calls against the same repository.
- AFR-005 — A quality gate must cover new code structurally, never by enumeration.
- AFR-006 — A conservative guard is only as strong as the query that feeds it. When correctness depends on all candidate rows, paginate the query.
- AFR-007 — One shared application role is a user-directed deviation from least privilege. Any future handler needing a genuinely broader permission gets its own role rather than widening this one.

Host Evidence: Codex collaboration subagent; dispatched 2026-09-16.

Escalate, don't improvise, when: stop and report back rather than working around any of the following — an unexpected dependency the brief didn't mention; a file the brief didn't list needing changes; a conflicting or already-modified file; a requirement in the brief that's ambiguous enough to support two different implementations; a missing tool, credential, or piece of environment the task needs; a test that fails for a reason unrelated to this task's own change; or the Effort Budget being exceeded with the task still incomplete.
