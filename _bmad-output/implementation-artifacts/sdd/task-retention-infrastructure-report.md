# Task Report: Retention infrastructure and permanent purge

Status: complete

Host Evidence: Codex collaboration subagent `/root/retention_infrastructure`, dispatched 2026-09-16.

What changed:

- `infra/lib/data-stack.ts` — adds sparse `gsi4` (per-creator Trash) and `gsi5` (global due-purge queue).
- `infra/lib/api-stack.ts` — adds JWT-protected `DELETE /files/{id}`, `GET /trash`, and `POST /files/{id}/restore` routes.
- `infra/lib/observability-stack.ts` — adds explicit handler log groups for all three Trash routes.
- `infra/lib/retention-stack.ts` — adds a daily EventBridge rule, one ARM64 Node 20 purge Lambda, explicit log group, and dedicated least-privilege purge role.
- `infra/bin/stash.ts` — wires the sixth stack with the STASH table and payload bucket.
- `services/handlers/retention/**` — implements paginated due-queue query, conditional `trashed` claim, idempotent S3 deletion handling, and transactional metadata/quota finalization.
- `services/entrypoints/src/purge-trash.ts` — wires production DynamoDB/S3 clients to the retention handler.
- `infra/test/**`, `services/handlers/retention/test/**` — structural CDK and worker behavior coverage.

Verification evidence:

```text
> npm install --package-lock-only --ignore-scripts
up to date, audited 149 packages in 1s

> npm ci --ignore-scripts  (in clean .retention-verify copy)
added 118 packages, and audited 149 packages in 19s
exit 0
```

`package-lock.json` now includes the required workspace link
`node_modules/@stash/handlers-retention` and its corresponding
`services/handlers/retention` package record. No deploy was attempted.

Deviations from the brief:

- Preserved and extended the accepted, already-modified API and observability files under controller direction.
- A `purging` row remains on gsi5 after claim. This is deliberate: if execution stops after S3 deletion but before transactional finalization, a later daily sweep can safely resume; `DeleteObject`/`NoSuchKey` are idempotent and restore refuses `purging` state.

Open questions:

- The clean-install gate is now green. The controller still owns the full
  combined test/typecheck/synth integration gate.

Reviewer verdict: pending controller review and combined integration.
