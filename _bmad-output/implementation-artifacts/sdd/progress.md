# STASH — Plan Progress Log
Plan: `_bmad-output/planning-artifacts/plans/2026-09-15-aws-control-plane-plan.md`

## Task 1: Repository toolchain — complete — 2026-09-15T00:26:00Z
Report: `_bmad-output/implementation-artifacts/sdd/task-1-report.md`
Dispatch: `_bmad-output/implementation-artifacts/sdd/task-1-dispatch.md`; host=claude-code, subagent=`stash-task-1-toolchain`
Reviewer notes: Subagent escalated a real brief/tool conflict (Vitest 2 exits 1
on no-tests) instead of improvising — the escalation rule working as designed.
Brief defect captured as a DEVIATION. Controller updated `.gitignore`
(`node_modules/`) as its legitimate owner; declined to touch `vitest.config.ts`
because that file belongs to Task 1, not the controller.
Usage: 54,722 subagent tokens; 10 tool uses; 93s. Spawns used: 1/15.

## Task 3: StashDataStack — complete — 2026-09-15T00:34:00Z
Report: `sdd/task-3-report.md`
Dispatch: `sdd/task-3-dispatch.md`; host=claude-code, subagent=`stash-task-3-data-stack`
Reviewer notes: Controller re-ran the suite independently (9/9) rather than
accepting the report's claim. Subagent added 4 assertions the brief omitted,
covering the RETAIN standing rule — brief was weaker than its own rules.
Deprecation warning on `pointInTimeRecovery` accepted as Low (template output
is correct). Task 2's tsconfig must include `infra/lib` + `infra/test`.
Usage: 56,119 subagent tokens; 6 tool uses; 57s. Spawns used: 3/15.

## Task 5: Shared services library — complete — 2026-09-15T00:35:00Z
Report: `sdd/task-5-report.md`
Dispatch: `sdd/task-5-dispatch.md`; host=claude-code, subagent=`stash-task-5-shared-lib`
Reviewer notes: Controller re-ran the full suite independently (32/32 across
both tasks) and inspected `paths.ts` directly to confirm the byte-identical
return. Subagent added an NFD-preservation test the brief never asked for —
a real cross-platform hazard (macOS NFD vs Windows NFC) that a normalizing
validator would have turned into silent library corruption. 401 confirmed as
the missing-`sub` status for Tasks 6–9. `services/shared/tsconfig.json`
assigned onward; Task 5's boundary is released.
Usage: 71,420 subagent tokens; 16 tool uses; 111s. Spawns used: 3/15.

## Task F1-H: F1 handlers + hierarchy proof — complete — 2026-09-15T00:39:00Z
Report: `sdd/task-F1H-report.md`
Dispatch: `sdd/task-F1H-dispatch.md`; host=claude-code, subagent=`stash-task-F1H-files`
Reviewer notes: Controller re-ran the full suite (45 passed, 1 skipped) and
grepped all handler sources for normalization calls — zero found. Property test
proves 200 trees / 7,734 files round-trip byte-identically including NFC and NFD
siblings. DynamoDB Local suite skips with an explicit reason rather than passing
vacuously, so the limit of the proof is visible rather than hidden. Two design
questions referred out instead of being settled silently.
Usage: 84,879 subagent tokens; 19 tool uses; 193s. Spawns used: 4/15 (2 validators now running → 6/15).

## Task F1-FIX-A: handler defect repair — complete — 2026-09-15T00:52:00Z
Report: `sdd/task-F1FIXA-report.md`
Dispatch: `sdd/task-F1FIXA-dispatch.md`; host=claude-code, subagent=`stash-f1-fix-a-handlers`
Reviewer notes: All four defects fixed; whole repo 78 passed / 1 skipped / 0
failed on an independent controller re-run. Folder identity comes from lookup,
not path hashing (verified by grep) — preserving rename-as-metadata-write. A
generic gsiNpk/gsiNsk completeness sweep now blocks the whole seam-defect class.
Fix agent additionally found two adversarial tests that had encoded Defect 4 as
the expected contract and would have locked in an information-disclosure bug.
Usage: 91,954 subagent tokens; 17 tool uses; 143s. Spawns used: 8/15.

## Task F1-FIX-B: toolchain + CDK wiring — complete — 2026-09-15T00:56:00Z
Report: `sdd/task-F1FIXB-report.md`
Dispatch: `sdd/task-F1FIXB-dispatch.md`; host=claude-code, subagent=`stash-f1-fix-b-toolchain`
Reviewer notes: typecheck proven by deliberate failure (TS2322, exit 2) before
being shown green — a typecheck that has never failed proves nothing. Synth
emits the real template. Controller added `cdk.out/` to `.gitignore` directly
as its legitimate owner.
Usage: 64,988 subagent tokens; 12 tool uses; 200s. Spawns used: 8/15.

## Integration — complete — 2026-09-15T00:57:00Z

**Full suite run** (actual commands and output, not a claim):
```
$ npx vitest run
 Test Files  10 passed (10)
      Tests  78 passed | 1 skipped (79)
$ npm run typecheck
> tsc -p tsconfig.json          # exit 0
$ npm run synth
  StashDataStack/StashTable/Resource
  StashDataStack/StashBucket/Resource
  StashDataStack/StashBucket/Policy/Resource   # template emitted
$ npm ls --workspaces --depth=0  # 3 workspaces
```

**Cross-task interfaces verified in combined code** (not each diff in isolation):
- `StashDataStack.table` / `.bucket` (Task 3) → consumed by `infra/bin/stash.ts`
  (Fix B). **Match**; synth proves it resolves.
- Task 5 exports (`userIdFromEvent`, `validateRelativePath`, `objectKey`,
  `badRequest`, `notFound`, `conflict`, `logger`, `idempotencyKeyFromEvent`) →
  consumed by F1-H handlers. **Match**; typecheck across both trees proves it.
- `FileRecord.gsi3pk`/`gsi3sk` (handlers) ↔ `gsi3` partition+sort key
  (`data-stack.ts:31-37`). **Match — and this was the seam that was BROKEN.**
  Only cross-task review found it; both sides were individually correct and
  individually tested.
- `Repository` port ↔ `MemoryRepository`. **Match**, typechecked.
- Root workspaces glob ↔ actual package locations. **Match**, 3 resolve.

**Combined diff reviewed as one unit:** yes.

**Standing rules — per-rule verdict against the combined diff:**
| Rule | Verdict |
|---|---|
| 1 never reorganize / byte-identical | respected — 0 normalization calls; NFC/NFD distinct, asserted |
| 2 File/Folder/Stash distinct | respected — separate entities throughout |
| 3 checksum ≠ identity | respected — gsi3 detection-only; 2 files/1 checksum stay 2 assets |
| 4 nothing Stashed until verified | n/a — no upload path in this slice; state starts `pending` |
| 5 no LLM in runtime | respected — no model call anywhere |
| 6 opaque S3 keys | respected — proven across 7,734 generated files |
| 7 user_id from claims only | respected — body/query/path all ignored; 401 on missing sub |
| 8 versioning off, never overwrite | respected — asserted twice in infra tests |
| 9 payload never via control plane | respected — no payload path exists yet |
| 10 STASH vocabulary | n/a — no user-facing copy in this slice |
| 11 every apply is High severity | respected — synth only; no deploy, bootstrap or AWS call |
| 12 no credentials in repo | respected — `.env` never read; nothing committed |
| AFR-001 BMAD+SIA spine | respected — artifacts in `_bmad-output/`, gates applied |
| AFR-002 brief/exit-code | respected — no unverified exit expectations |
| AFR-003 mockups non-binding | respected — no requirement derived from `uisamples/` |
| AFR-004 stable identity | respected — and now enforced by multi-call tests |

**Issues found only once all code coexisted:** the `gsi3pk`/`gsi3sk` seam
(fixed). Nothing further.

**Outstanding, explicitly NOT closed:** the round trip is proven against
`MemoryRepository` only — no Docker daemon, no Java, so real DynamoDB ordering,
GSI projection, 1 MB pagination and item-size limits are unevidenced.
`listChildren` has no pagination at all. The idempotency record is written
after the write rather than reserved before it. No DynamoDB repository
implementation exists yet.

## Task F2: duplicate folder detection — build complete, validation found defects — 2026-09-15T01:05:00Z
Report: `sdd/task-F2-report.md` · Dispatch: `sdd/task-F2-dispatch.md`
Validation: `sdd/F2-validation-adversarial-report.md` (37 attacks, 35 survived,
2 false positives) and `sdd/F2-validation-rules-review.md` (2 High, 3 Medium, 4 Low).
Reviewer notes: BOTH validators converged independently on one root cause —
`folderName` is absent from the identity function, so a content fingerprint is
promoted to a folder identity (direct Rule 3 violation). The hash encoding
itself is sound: hex framing defeated 7 forgery attacks and a 2,000-entry
collision corpus. Partial arithmetic proven correct by construction (disjoint
filter partition — an off-by-one is not representable).
Usage: 76,724 + 108,473 + 105,875 subagent tokens. Spawns used: 11/15.

## Task F2-FIX: defect repair — complete — 2026-09-15T01:20:00Z
Report: `sdd/task-F2FIX-report.md` · Validation: `sdd/F2-fix-validation-report.md`
Reviewer notes: All six repairs independently verified to HOLD by a validator
that did not write them. Both revised tests audited and found TIGHTENED, not
weakened — the revision added assertions the originals lacked. AFR-005 fix
proven structural: `services/handlers/files/` is never named in tsconfig.json
yet all its files appear in `--listFiles`, so a new handler package is covered
by construction. Largest open risk recorded as AFR-006 (pagination can silently
defeat the ambiguity guard).
Usage: 113,868 + 95,320 subagent tokens. Spawns used: 13/15.

## Integration (F2) — complete — 2026-09-15T01:21:00Z
Full suite: `npx vitest run` → 14 files, 167 passed, 1 skipped, 0 failed.
`npm run typecheck` → exit 0 (9 manifest files now covered, was 0).
`npm run synth` → exit 0, StashDataStack template emitted.
Cross-slice interfaces: F2 consumes `services/shared` exports unchanged; no F1
file was modified by F2; `gsi3pk`/`gsi3sk` completeness sweep from F1 still green.
Combined diff reviewed as one unit: yes.
Standing rules: all 12 plus AFR-001..006 checked; Rule 3 was violated by F2 and
is now respected; no rule violated at close.
Issues visible only in combination: none beyond AFR-006, which is recorded.

## AFR-005 closure: typecheck coverage made fully structural — complete — 2026-09-15T01:30:00Z
Controller-owned change (root `tsconfig.json`; owning task complete, boundary released).
The earlier fix globbed `services/handlers/*` but still ENUMERATED
`infra/bin|lib|test` and `services/shared/src|test` — the same AFR-005 class,
one level up. `include` is now `["infra/**/*.ts", "services/**/*.ts"]`.
Proof (not a green exit code): a probe package at `services/common/src/probe.ts`
— a path no config names — with a deliberate type error was caught as
`error TS2322` with zero config edits; probe removed; gate green again.

## Task F3-ROLE: shared application IAM role + tagging — complete — 2026-09-15T01:50:00Z
Report: `sdd/task-F3ROLE-report.md` · Dispatch: `sdd/task-F3ROLE-dispatch.md`
Reviewer notes: Controller parsed the synthesized template independently rather
than accepting the report: 20 actions, zero dangerous actions, exactly one
`Resource: "*"` (cloudwatch:PutMetricData) and it carries the namespace
condition. All five cost-allocation tags verified on the IAM role, DynamoDB
table and S3 bucket. Shared-role deviation recorded as AFR-007 with a revisit
trigger. Deploy NOT run — separate High-severity approval.
Usage: 71,597 subagent tokens; 12 tool uses; 288s. Spawns used: 14/15.
