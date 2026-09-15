# Task F3-ROLE Dispatch Record — shared application IAM role + tagging

| Field | Value |
|---|---|
| Host / harness | Claude Code (`claude-code`) |
| Subagent name | `stash-task-role-iam` |
| Dispatch timestamp | 2026-09-15T10:36:00Z |
| Owned files | `infra/lib/app-role-stack.ts`, `infra/test/app-role-stack.test.ts`, `infra/bin/stash.ts` |
| Scope | ONE shared execution role for all handlers + repo-wide resource tagging |
| Deviation from spec | Spec §3.5 and `skills/stash-aws` require one role PER handler. User directed a single shared role on 2026-09-15. Recorded as a deliberate, user-directed deviation — see AFR-007. |
| Deploy | NOT in this task. Code + synth only; applying is a separate High-severity approval. |
| Controller | Did NOT implement. Briefed, dispatched, will review. |
