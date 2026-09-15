# Task Report: F1 handlers + hierarchy proof

Status: **complete**
Host Evidence: subagent=`stash-task-F1H-files`, host=claude-code, per
`task-F1H-dispatch.md`. Usage: 84,879 subagent tokens, 19 tool uses, 193s.

## What changed
`services/shared/tsconfig.json` (assigned; no existing shared file touched),
plus `services/handlers/files/` — package.json, tsconfig.json, 5 src files
(types, repository, memory-repository, register-files, list-children) and
4 test files (register-files 6 tests, list-children 5, hierarchy-property 1,
dynamodb-local 2 with 1 skipped).

## Verification evidence (controller re-ran independently)
`npx vitest run` → **8 files, 45 passed, 1 skipped**. 32 pre-existing + 13 new,
no regression.

**The F1 proof:** `generated cases=200 files=7734 maxPathDepth=5`. Names drawn
from ASCII, spaces, `#`, `&`, `'`, CJK, Hangul, emoji, NFC *and* NFD variants
of the same string, and 200-char names. Comparison is over UTF-8 bytes
(`Buffer.from(p,"utf8").toString("hex")` sets). In-test assertions
`generated >= 200` and `totalFiles > generated` prevent a vacuous pass.

**Honest skip:** the DynamoDB Local suite reports
`SKIPPED — ... missing a running Docker daemon; a Java runtime; the
@aws-sdk/client-dynamodb package ... it is NOT proven against real DynamoDB in
this environment.` It cannot silently pass — if prerequisites appear, the real
suite runs and currently throws `not implemented`.

Controller spot-checks beyond the report: `grep` for
`normalize|toLowerCase|trim()` across all five handler sources returns **zero
call sites** — the only match is a comment in `types.ts:36` stating the rule.
`register-files.ts:135,138` confirm `originalRelativePath` stored from input
and `objectKey` built from `objectKey(userId, fileId)`, never the path.

## Deviations from the brief
1. Both new tsconfigs are `noEmit` typecheck-only (`composite: false`). No root
   tsconfig or project-reference graph exists to join, and a composite project
   would trip `rootDir` on the cross-package import. No existing file changed.
2. `registerFiles` also rejects a bad `stashId`, empty `files`, negative or
   non-finite `sizeBytes`, and empty `checksum` with 400 — same
   fail-whole-batch-before-writing path. Accepted: strictly stronger.
3. `listChildren` sorts by UTF-8 byte order (`Buffer.compare`), not locale
   collation, so in-memory order matches DynamoDB's `gsi1sk` ordering.
   Accepted — locale collation would have diverged from production.
4. Top-level files get `parentFolderId: "ROOT"` because the briefed interface
   types it `string`, not `string | null`. Consistent with the specified
   `gsi1pk = ...#PARENT#ROOT`.
5. An intermediate RED run caught a bug in the subagent's own test helper
   (401 case asserted 201), self-corrected before green.

## Reviewer verdict: **complete** — reviewer: controller (Claude Code)

**Did the code work?** Yes — verified by independent full-suite re-run and
direct source inspection, not by accepting the report.

**Did this repeat a known mistake?** Controller-level check (a dedicated
standing-rules validator is running separately):
- *Rule 1 (byte-identical paths)* — **respected**, zero normalization calls.
- *Rule 2 (File/Folder/Stash distinct)* — **respected**, separate entities.
- *Rule 3 (checksum ≠ identity)* — **respected**, `gsi3pk` is detection-only.
- *Rule 6 (opaque keys)* — **respected**, asserted in tests.
- *Rule 7 (claims-only user_id)* — **respected**, body/query/path all ignored.
- *Rule 12 (no credentials)* — **respected.**
- *AFR-002 (no unverified exit-code expectations in briefs)* — **respected**;
  this brief asserted behaviour, not exit codes.
- *Ownership* — **respected**; no file outside the boundary was modified.

### Open questions carried to the validators / user
1. Root `package.json` workspaces glob `"services/*"` does not match
   `services/handlers/files`, so its devDependencies never install. Harmless
   today (handlers type the event as `any`) but wrong. Referred to the review
   validator for a recommendation; the root file's owner must decide.
2. Two identical `relativePath` values in ONE batch currently create two
   files. Rule 3 says never dedupe — but a real filesystem cannot hold two
   files at one path in one folder. Genuinely ambiguous; referred out rather
   than settled silently.
3. **F1 is proven against `MemoryRepository`, not real DynamoDB.** Stated
   plainly rather than glossed. Must be re-run where Docker or Java exists
   before F1 is claimed end-to-end against production storage.
