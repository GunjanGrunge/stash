# Task Report: F1 fix B — toolchain + CDK wiring

Status: **complete**
Host Evidence: subagent=`stash-f1-fix-b-toolchain`, host=claude-code.
Usage: 64,988 subagent tokens, 12 tool uses, 200s.

## Defects fixed
- **FIX 1** — workspaces now `["infra","services/shared","services/handlers/*"]`;
  three resolve. The `handlers/` boundary (which per-handler least-privilege IAM
  depends on) was preserved rather than flattened. `@stash/handlers-files` now
  resolves its own `@types/aws-lambda` instead of relying on a hoist.
- **FIX 2** — root `tsconfig.json` aggregate project; `typecheck` is
  `tsc -p tsconfig.json`. **Proven by deliberate failure**: a planted
  `const deliberate: number = "not a number";` produced
  `error TS2322 ... exit=2`, and removing it produced exit 0. `--listFiles`
  confirms 24 repo files across all three trees are actually checked.
- **FIX 3** — `infra/package.json`, `infra/tsconfig.json`, root `cdk.json`.
  `infra/lib/data-stack.ts` and its test type-check cleanly, untouched.
- **FIX 4** — `infra/bin/stash.ts` instantiates only `StashDataStack`, pinned to
  `env: { region: "ap-south-1" }`. No Identity/Api/Observability stubs invented
  for stacks that do not exist yet.

## Verification (controller re-ran all of it independently)
`npm run typecheck` → exit 0 · `npm run synth` → emits
`StashDataStack.template.json` with `StashTable`, gsi1–gsi3 and the bucket ·
`npx vitest run` → **10 files, 78 passed, 1 skipped** ·
`npm ls --workspaces` → 3 workspaces.

## Deviations from the brief
1. `typecheck` uses `tsc -p`, not `tsc -b` — the brief's explicitly sanctioned
   alternative. Project references demand `composite: true`, which conflicts
   with the existing `noEmit` per-package configs the agent did not own.
2. `infra/package.json`'s `synth` is `cd .. && cdk synth`, because
   `npm -w infra run synth` runs with cwd `infra` where bare `cdk synth` fails
   with `--app is required`. Hopping to the root beats duplicating the `app`
   entry in a second config that could then drift. Both paths verified.

## Reviewer verdict: **complete** — reviewer: controller (Claude Code)

The deliberate-failure proof is what makes FIX 2 credible. A typecheck that has
never failed is not evidence that it checks anything — this one was shown red,
then green.

Rules: Rule 11 **respected** — `cdk synth` only, no deploy, no bootstrap, no
AWS API call, no credentials needed. Rule 12 **respected**.

## Open question resolved by the controller
`cdk.out/` was untracked and unignored after synth. `.gitignore` is
controller-owned, so the controller added it directly — this is not a
task-owned production file, so no delegation was required.

Carried forward (unchanged): `infra/lib/data-stack.ts` uses the deprecated
`pointInTimeRecovery` prop. Still Low; still belongs to that file's next owner.
