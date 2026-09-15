# Task Report: F2 defect repair

Status: **complete** (fix validation in flight)
Host Evidence: subagent=`stash-f2-fix`, host=claude-code.
Usage: 113,868 subagent tokens, 26 tool uses, 494s.

## Defects fixed

**F2-1 (HIGH, Rule 3 violation).** `manifestHash(folderName, entries)` now folds
the folder name in as `folder:<hex of raw UTF-8>` on a dedicated first line
(`manifest-hash.ts:50`). Entry lines are `hex:size:hex`, which can never collide
with a line beginning `folder:` because `o`, `l` and `r` are not hex digits, so
the framing stays unambiguous. `findByHash` therefore requires the same folder
name inherently — `exact` and `partial` now agree on what "the same folder"
means. The accepted false negative (a renamed folder re-uploads) is documented
by two tests **as intended behaviour, not a bug**.

**F2-2 (HIGH) — user-ratified.** Candidates with non-zero overlap are counted;
`overlapping > 1` returns `{match:"none"}` before any `folderId` is disclosed,
logged as `manifest_check_ambiguous`. Single-candidate behaviour untouched.

**F2-3 (MEDIUM).** `pairKey` is now `hex(path)#hex(size)#hex(checksum)`. The
4 GB file in the reproduction now appears in `newFiles` with
`newBytes = 4000000000`.

**F2-5 (MEDIUM).** `validateFolderName` rejects empty, any code point ≤ 0x1F or
0x7F, and anything over 255 **bytes** — the test uses `"é".repeat(255)` (255
chars, 510 bytes) to prove the limit is bytes, not characters. Returned
byte-identical: NFC accepted → `exact`, while NFD, padded and upper-cased
variants → `none` (Rule 1).

**Typed event.** Both `any` sites now use
`APIGatewayProxyEventV2WithJWTAuthorizer`. With the tsconfig glob this is now
actually enforced rather than nominally declared.

**AFR-005 — fixed structurally, as the rule demands.** `tsconfig.json` globs
`services/handlers/*/src/**/*.ts` and `.../test/**/*.ts`. Controller-verified:
`--listFiles | grep -c handlers/manifest` went from **0 → 8**. A handler package
added tomorrow is covered by construction, not by someone remembering to list it.

## Verification (controller re-ran all of it)
`npx vitest run` → **13 files, 148 passed, 1 skipped, 0 failed**.
`npm run typecheck` → exit 0 · `npm run synth` → exit 0.
`grep -o "services/handlers/\*"` confirms globs, not enumeration.

## The highest-risk part of this change: two revised tests

The fixer revised — **did not delete** — two previously-passing adversarial
tests that contradicted required fixes, and reported both explicitly:

1. *"a very long folderName never throws and never matches a short one"* — a
   100,000-char name expected `200 {match:"none"}`; F2-5 now requires 400.
   Revised to assert 400, no `match` field, and no leak of `folder-short`. The
   original guarantee (never throws, never matches a short folder) is still
   asserted.
2. *"picks the SAME candidate on repeated calls when two folders share the
   name"* — expected `partial` naming `folder-b`; F2-2 now requires `none`.
   Revised to assert five repeated calls yield one identical `{match:"none"}`
   with neither candidate named. **The determinism guarantee is preserved; only
   the guessed identity is gone.**

A test revised to match the code is exactly how a real regression gets locked
in — the same pattern that, in F1, nearly enshrined a cross-tenant disclosure
bug as the contract. Both revisions are therefore under independent audit by
the fix validator rather than accepted on the fixer's own account.

## Reviewer verdict (repair): **complete, pending independent fix validation**

Rules: Rule 1 **respected** (byte-identical folderName, NFC/NFD distinct);
Rule 3 **now respected** — this was the violation; Rule 7 **respected**;
Rule 9 **respected** (ambiguity branch returns before any write path and calls
no repository method beyond the two existing reads); Rule 12 **respected**;
AFR-004 **respected** (new tests use two calls on one repository);
**AFR-005 respected structurally.**

## Open items carried
1. A code comment still says the F2-2 default is "pending user ratification".
   **The user ratified it on 2026-09-15.** Stale comment, Low severity, flagged
   to the fix validator rather than edited by the controller.
2. `folderName` capped at 255 bytes, matching the per-path-segment limit. If
   real creator folder names legitimately exceed that, the limit is what to
   revisit — not the validation.
3. Everything remains proven against the in-memory repository only. No DynamoDB
   implementation exists; Docker and Java are both unavailable here.
