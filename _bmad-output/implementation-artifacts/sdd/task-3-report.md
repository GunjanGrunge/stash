# Task Report: StashDataStack

Status: **complete**
Host Evidence: subagent=`stash-task-3-data-stack`, host=claude-code, per
`task-3-dispatch.md`. Usage: 56,119 subagent tokens, 6 tool uses, 57s.

## What changed
- `infra/test/data-stack.test.ts` — new, 9 assertions, written RED-first
- `infra/lib/data-stack.ts` — new, `StashDataStack` to the briefed interface

## Verification evidence
RED: `Failed to load url ../lib/data-stack ... Does the file exist?` — suite
failed to load before the implementation existed, for the expected reason.

GREEN (re-run independently by the controller, not merely accepted from the
report): `npx vitest run infra/test/data-stack.test.ts` → **9 passed (9)**,
duration 12.33s.

Coverage: pk/sk STRING + PAY_PER_REQUEST + PITR; RETAIN deletion/update-replace
policies on table and bucket; exactly three GSIs `gsi1`/`gsi2`/`gsi3` with
correct HASH/RANGE schemas and all eight attribute definitions typed `S`;
bucket AES256; `VersioningConfiguration` absent (asserted twice — direct
property absence and `Match.absent()`); all four public-access-block flags
true; `AbortIncompleteMultipartUpload: { DaysAfterInitiation: 7 }` with
`Status: Enabled`; bucket policy `Effect: Deny` / `Action: s3:*` /
`Condition: Bool { "aws:SecureTransport": "false" }`.

## Deviations from the brief
1. Added 4 assertions beyond the 6 briefed (key schema/billing/PITR, and
   RETAIN on both resources). **Accepted** — RETAIN is a standing rule that no
   briefed assertion actually proved. The brief was weaker than its own rules;
   the subagent closed that gap rather than meeting the letter of the brief.
2. `pointInTimeRecovery: true` is deprecated in `aws-cdk-lib@2.269.0` in
   favour of `pointInTimeRecoverySpecification`; every test run emits a
   deprecation warning on stderr. The subagent used the briefed prop verbatim
   rather than substituting, and flagged it. Correct call.

## Reviewer verdict: **complete** — reviewer: controller (Claude Code)

**Did the code work?** Yes, verified by independent re-run, not by report.
Interfaces match the plan exactly (`table` id `StashTable`, `bucket` id
`StashBucket`, three named GSIs), so Task 10's `StashApiStackProps` and Task
13's wiring can consume them as written.

**Did this repeat a known mistake?** Standing rules checked against the diff:
- *Rule 8 (versioning off, never overwrite)* — **respected and proven.**
  `versioned: false` is explicit in source and asserted twice in tests.
- *Rule 11 (every apply is High severity)* — **respected.** No deploy, no
  bootstrap, no AWS API call; `git status` shows no credential artifacts.
- *Rule 12 (no credentials in repo)* — **respected.** `.env` never read.
- *Ownership boundary* — **respected.** `infra/bin/` does not exist;
  `infra/package.json` and `cdk.json` untouched. Verified on disk.
- *AFR-002 (brief must not pin config and assert an exit code without
  verifying)* — **respected**; no exit-code expectation in this brief.

### Reviewer decisions on the open questions
1. **`pointInTimeRecovery` deprecation: accepted as-is, logged as Low.** The
   synthesized template is correct
   (`PointInTimeRecoverySpecification.PointInTimeRecoveryEnabled: true`), so
   this is warning noise, not a defect. Migrating it is a one-line change that
   belongs to whoever next owns this file — not a controller edit now.
2. **`infra/` has no tsconfig yet, so `tsc -b` does not cover these files.**
   Valid and important: Task 2 must include `infra/lib` and `infra/test` in
   its `include`. Carried into Task 2's brief rather than left in a report
   nobody re-reads.
