# Task Brief: CDK workspace

Goal: Create the `infra` npm workspace and `cdk.json` so the CDK app can be
synthesized once its entry point exists.

Files (exclusive ownership boundary):
- `infra/package.json`
- `infra/tsconfig.json`
- `cdk.json`

Interfaces:
- Consumes from Task 1: root npm workspaces `["infra", "services/*"]` and
  `tsconfig.base.json` (strict, ES2022, NodeNext, composite).
- Produces: `cdk.json` with `"app": "npx tsx infra/bin/stash.ts"` and context
  `"@aws-cdk/core:target-partitions": ["aws"]`; `infra/package.json` named
  `@stash/infra`, private, with script `synth` → `cdk synth`.

Steps:
1. Write `infra/package.json`: name `@stash/infra`, `"private": true`,
   dependencies `aws-cdk-lib`, `constructs`; devDependency `tsx`;
   script `synth` → `cdk synth`.
2. Write `infra/tsconfig.json` extending `../tsconfig.base.json`, with
   `"include": ["bin/**/*.ts", "lib/**/*.ts", "test/**/*.ts"]`.
   **Carried from Task 3 review:** `infra/lib/data-stack.ts` and
   `infra/test/data-stack.test.ts` already exist and are currently covered
   only by the root Vitest run, not by `tsc -b`. Your `include` MUST cover
   them, and `npx tsc -b infra` must typecheck them cleanly. Do not edit
   those two files — they belong to Task 3; if they do not typecheck, report
   `blocked` with the errors rather than fixing them.
3. Write `cdk.json` as specified above.
4. Run `npx cdk synth` — confirm it FAILS because `infra/bin/stash.ts` does
   not exist. Record the exact error text. **Do not create that file** — it is
   owned exclusively by Task 13.
5. Verification: the failure message names the missing entry file, proving the
   wiring is correct and only the entry point is absent.

Acceptance Criteria: `cdk.json` resolves and the ONLY synth blocker is the
missing `infra/bin/stash.ts`. Paste the real error output.

Effort Budget: 20 tool calls.

Relevant Standing Rules (verbatim):
- Rule 11: Every `cdk deploy` or mutating AWS CLI call is High severity and
  requires explicit user approval. **This task runs `cdk synth` only — never
  `cdk deploy`, `cdk bootstrap`, or any AWS API call.**
- Rule 12: Never write AWS credentials into the repository or any artifact.
- `.gitignore` and `package.json` (root) are NOT yours. Do not edit them.

Working directory: `/mnt/c/Users/Bot/Desktop/stash`
Host Evidence: host=claude-code; subagent=stash-task-2-cdk-workspace.

Escalate, don't improvise, when: an unexpected dependency the brief did not mention; a file the brief did not list needing changes; a conflicting or already-modified file; a requirement ambiguous enough to support two different implementations; a missing tool, credential, or piece of environment; a test that fails for a reason unrelated to this task's own change; or the Effort Budget exceeded with the task still incomplete. Report status `blocked` with exactly what was found — improvising past any of them is scope creep even when the improvisation would probably work.
