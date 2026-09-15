# Task Brief: Repository toolchain

Goal: Establish the npm workspace, TypeScript config, Vitest config and Node
pin that every later STASH task builds on.

Files (exclusive ownership boundary — touching anything outside this list is
an escalation, not a bonus):
- `package.json`
- `tsconfig.base.json`
- `vitest.config.ts`
- `.nvmrc`

Interfaces:
- Consumes: nothing (first task).
- Produces, for every later task to rely on:
  - npm workspaces: `["infra", "services/*"]`
  - scripts: `test` → `vitest run`; `typecheck` → `tsc -b`;
    `synth` → `npm -w infra run synth`
  - `tsconfig.base.json` with `"strict": true`, `"target": "ES2022"`,
    `"module": "NodeNext"`, `"moduleResolution": "NodeNext"`,
    `"noUncheckedIndexedAccess": true`, `"declaration": true`,
    `"composite": true`
  - devDependencies: `typescript@^5.6`, `vitest@^2`, `@types/node@^20`,
    `aws-cdk-lib@^2`, `constructs@^10`, `aws-cdk@^2`
  - Node pinned to `20`

Steps:
1. Write `vitest.config.ts` with `test.include: ["**/*.test.ts"]`,
   `test.exclude: ["**/node_modules/**"]`, and `test.environment: "node"`.
2. Run `npx vitest run` — confirm it fails with "No test files found".
   That failure is the check proving the toolchain is not yet established.
3. Write `package.json` with the workspaces, scripts and devDependencies above.
4. Write `tsconfig.base.json` and `.nvmrc` (`20`).
5. Run `npm install`, then `npx vitest run` again — confirm the exit code is
   now 0 with zero tests, proving the runner resolves.
6. Verification: paste the output of `npm install` and `npx tsc --version`
   (must print 5.x).

Acceptance Criteria: `npm install` exits 0 and `npx tsc --version` prints a
5.x version. Paste the real command output — a claim that it passed is not
acceptance evidence.

Effort Budget: 25 tool calls. Exceeding it is a signal to stop and report
`blocked` or `partial` with what was tried — not a reason to push harder.

Relevant Standing Rules (from the project AGENT.md, copied in verbatim
because you have no reason to read the whole project file):
- Rule 12: Never write AWS credentials into the repository, into a skill
  file, into a session log, or into a task brief. Credentials for this
  project arrive in `.env`, which is gitignored. Never `cat` the `.env`,
  never echo a key, never paste one into an artifact.
- Inherited non-negotiable: never delete, replace, or restructure anything
  on your own initiative — present an impact statement and wait.
- Note: `.gitignore` already exists and is **not** yours. Do not edit it.

Working directory: `/mnt/c/Users/Bot/Desktop/stash`

Host Evidence: host=claude-code; subagent=general-purpose;
dispatch timestamp recorded in `sdd/task-1-dispatch.md`.

Escalate, don't improvise, when: an unexpected dependency the brief didn't
mention; a file the brief didn't list needing changes; a conflicting or
already-modified file; a requirement in the brief ambiguous enough to
support two different implementations; a missing tool, credential, or piece
of environment the task needs; a test that fails for a reason unrelated to
this task's own change; or the Effort Budget being exceeded with the task
still incomplete. In every one of these cases, report status `blocked` with
exactly what was found — improvising past any of them is scope creep even
when the improvisation would probably work.

Report back in the Task Report Format: Status / Host Evidence / What changed
/ Verification evidence (actual command output) / Deviations from the brief /
Open questions.
