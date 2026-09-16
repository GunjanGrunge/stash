# Task Brief: BMM renderer selection

Goal: Repair BMAD skill rendering so the selected BMM module is unambiguous while preserving existing behaviour for keys that are globally unique.

Files: `_bmad/scripts/render_skill.py`; `_bmad/scripts/` test file only if an existing test convention exists; `_bmad-output/implementation-artifacts/sdd/task-bmm-renderer-selection-report.md`.

Interfaces: The renderer's resolution of `implementation_artifacts` must select `modules.bmm.implementation_artifacts` for the `bmad-build` skill. Do not alter application (`infra/` or `services/`) source.

Steps:
1. Inspect the renderer's skill metadata and config-resolution path.
2. Implement the smallest module-aware resolution change needed for BMM skills.
3. Add or run a focused regression check proving `bmad-build` renders using BMM when both BMM and GDS configure the same key.
4. Do not alter credentials, infrastructure, or deployment state.

Acceptance Criteria: The renderer completes for `bmad-build` in this repository without the ambiguity error, selects BMM's artifact path, and any focused test/check passes.

Effort Budget: 12 tool calls.

Relevant Standing Rules:
- AFR-001 — BMAD drives planning and execution artifacts; SIA supplies the gates. Implementation is executed by scoped subagents under that evidence gate, never by the controller.
- AFR-002 — A brief must not specify a tool's config exhaustively without verifying that tool's real exit semantics.

Host Evidence: Codex collaboration subagent; dispatched 2026-09-15.

Escalate, don't improvise, when: stop and report back rather than working around any of the following — an unexpected dependency the brief didn't mention; a file the brief didn't list needing changes; a conflicting or already-modified file; a requirement in the brief that's ambiguous enough to support two different implementations; a missing tool, credential, or piece of environment the task needs; a test that fails for a reason unrelated to this task's own change; or the Effort Budget being exceeded with the task still incomplete. In every one of these cases, report status `blocked` with exactly what was found.
