# Task Brief: API readiness repair

Goal: Make the approved 14-route API change pass the full test suite without weakening the Stash route-ID safety contract, and correct the frontend reference.

Files: `services/handlers/manifest/src/check-manifest.ts`; `services/handlers/manifest/test/**`; `services/handlers/files/src/register-files.ts`; `services/handlers/files/test/**`; `docs/api-reference.md`; `infra/test/**` only if a route-contract assertion needs correction; `_bmad-output/implementation-artifacts/sdd/task-api-readiness-repair-report.md`.

Interfaces: `POST /stashes/{id}/manifest-check` must validate an owned open Stash in deployed composition; `POST /stashes/{id}/files` must reject path/body stash-ID disagreement. Unit tests that exercise handlers without the deployed Stash lookup must retain their intentional direct-handler semantics where appropriate. The frontend guide must state the approved decimal quota: 1 TB = 1000000000000 bytes; it must not claim folder-children pagination.

Acceptance Criteria: `npm test` passes in the clean verification copy; typecheck and synth remain green; route safety has explicit passing tests; documentation states only implemented behavior.

Effort Budget: 15 tool calls.

Relevant Standing Rules:
- AFR-001 — BMAD drives planning and execution artifacts; SIA supplies the gates. Implementation is executed by scoped subagents under that evidence gate, never by the controller.
- AFR-004 — Entity identity must be stable across invocations, not minted per call. Any test proving a hierarchy invariant must exercise at least two separate calls against the same repository.
- AFR-005 — A quality gate must cover new code structurally, never by enumeration.
- AFR-006 — A conservative guard is only as strong as the query that feeds it. When correctness depends on all candidate rows, paginate the query.

Host Evidence: Codex collaboration subagent; dispatched 2026-09-16.

Escalate, don't improvise, when: stop and report back rather than working around any of the following — an unexpected dependency the brief didn't mention; a file the brief didn't list needing changes; a conflicting or already-modified file; a requirement in the brief that's ambiguous enough to support two different implementations; a missing tool, credential, or piece of environment the task needs; a test that fails for a reason unrelated to this task's own change; or the Effort Budget being exceeded with the task still incomplete.
