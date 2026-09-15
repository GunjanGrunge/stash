# Task Report: F1 fix A — handler defects

Status: **complete**
Host Evidence: subagent=`stash-f1-fix-a-handlers`, host=claude-code.
Usage: 91,954 subagent tokens, 17 tool uses, 143s.

## Defects fixed

**D1 — folder identity (HIGH).** Each path segment now resolves via
`repo.findFolder(userId, parentFolderId, name)` before a UUID is minted
(`register-files.ts:149` precedes `:155`). Identity comes from lookup only —
**no path hashing**, verified by grep, so a folder rename remains a metadata
write rather than a re-identification of every descendant. The invariant is
additionally enforced *in the port*: `MemoryRepository.putEntities` refuses a
second folder with the same `(pk, parentFolderId, name)` with 409 and writes
nothing, standing in for the DynamoDB conditional put the in-memory port
cannot express. A test asserts the same path in two repositories yields
*different* folderIds — proving identity is not path-derived.

**D2 — `gsi3` permanently empty (HIGH).** `FileRecord.gsi3sk = FILE#<fileId>`
added and written (`register-files.ts:194`). Beyond the specific fix, a generic
sweep test now asserts **every record carrying any `gsiNpk` carries a non-empty
matching `gsiNsk`** — so this entire seam-defect class cannot recur silently.
Two files sharing a checksum keep one `gsi3pk` and two distinct `gsi3sk`,
preserving Rule 3 (detection only, never dedupe).

**D3 — idempotency (MEDIUM).** `Idempotency-Key` is now looked up as
`(userId, stashId, key)`; a hit returns the stored response verbatim with no
writes. Tests cover byte-identical replay, key scoping across `stashId` and
`userId`, and the control case that *without* a key a repeat call writes new
files into the (correctly reused) folder.

**D4 — cross-tenant read (LOW→ real).** `listChildren` resolves a non-ROOT
folderId via `findFolderById(userId, …)` and returns 404 when absent, with no
name leakage. A caller's own empty folder still returns 200 `[]` — the two are
correctly distinguished.

**Duplicate-path decision implemented.** Two identical `relativePath` values in
one batch now reject the whole batch with 400, writing nothing, compared on raw
UTF-8 bytes — so NFC and NFD remain *different* paths. A new adjacent test
proves NFC/NFD siblings are still accepted with 201, so the byte-comparison
rule cannot silently drift into normalization.

## Verification evidence (controller re-ran independently)
BEFORE: `2 failed | 29 passed | 1 skipped`.
AFTER, whole repo: **`10 files, 78 passed, 1 skipped, 0 failed`.**
`npx tsc -p services/handlers/files/tsconfig.json --noEmit` → exit 0.
Controller greps confirm `findFolder` precedes `randomUUID`, no `uuidv5`/
`createHash` path derivation, and `gsi3sk` written at `register-files.ts:194`.

## Notable finding by the fix agent, beyond its brief
Two further adversarial tests (`cannot reach another creator's folder by
guessing its folderId`, `ignores crafted parentFolderId path parameters`)
**asserted the OLD 200-empty cross-tenant behaviour — they had encoded Defect
4 as correct.** Left alone, they would have permanently locked in an
information-disclosure bug as the expected contract. Updated to assert 404 for
foreign/unknown ids while keeping 200 for `ROOT`/`""`. No other assertion
weakened.

This is the third time a subagent has corrected a gap its brief did not
anticipate — a test suite can encode a defect as the specification, and only an
independent reader catches it.

## Reviewer verdict: **complete** — reviewer: controller (Claude Code)

Standing rules against the diff: Rule 1 **respected** (NFC/NFD still distinct,
no normalization introduced); Rule 2 **respected**; Rule 3 **respected** — the
checksum index gained a sort key for uniqueness but is still detection-only;
Rule 6 **respected**; Rule 7 **respected**; Rule 12 **respected**;
**AFR-004 respected and now enforced by tests** that exercise multiple calls
against one repository, exactly as the rule requires.

## Open questions accepted as known limits (not defects to fix now)
1. The idempotent result is stored *after* the write; a crash between
   `putEntities` and `putIdempotentResult` would let a retry re-write. The
   correct DynamoDB shape reserves the key conditionally *before* the write.
   Flagged rather than improvised — carried to the DynamoDB repository task.
2. A losing racer on concurrent folder creation gets a 409 rather than
   transparently retrying the lookup. A retry-once-on-conflict loop would be
   friendlier but changes error semantics; deliberately out of scope here.
