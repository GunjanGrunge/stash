# Validation Report: Adversarial hierarchy attack (F1)

Status: **complete — 2 defects found**
Host Evidence: subagent=`stash-f1-adversarial-validator`, host=claude-code.
Usage: 83,668 subagent tokens, 9 tool uses, 149s.
Owned file: `services/handlers/files/test/adversarial-hierarchy.test.ts` (18 tests).

## Attacks: 16 SURVIVED, 2 DEFECTS

**Survived** (each now a permanent regression test): NFC/NFD siblings;
11-way case-folding traps (`I`/`i`/`İ`/`ı`, `STRASSE`/`straße`, U+212A Kelvin,
U+FB01 ligature); ZWJ/ZWSP/ZWNJ, RTL override, BOM, astral plane to U+10FFFF,
lone surrogates, stacked combining marks; file and folder sharing a name in one
parent; a folder literally named `ROOT` and nested `ROOT/ROOT`; names of only
spaces, only dots, trailing space/dot, NBSP; key-scheme lookalikes (`USER#x`,
`FILE#y`, `PARENT#ROOT`, bare `#`); batch atomicity across 12 hostile paths
(400 each, repository empty every time); 500 siblings including 40 sharing
their first 200 chars and 60 locale-vs-byte-order sensitive; 40-level depth;
exactly-1024-byte paths and chained exactly-255-byte segments; key opacity
against paths designed to leak; non-opaque JWT `sub` values; cross-tenant read
with a guessed real `folderId`; crafted `parentFolderId` params and body-
supplied `user_id`.

## D1 — Folder forking on repeat registration — **HIGH**

`register-files.ts:95-124` builds its `folders` map purely in-process and mints
`randomUUID()` per invocation; `memory-repository.ts:8-10` writes blind, with no
read-before-write and no conditional put. Two calls touching the same folder
path create two folder records with the same name under the same parent.

- **Input:** register `Beats/a.wav` (stash-1), then `Beats/b.wav` (stash-2), then `listChildren(ROOT)`.
- **Expected:** one `Beats` containing both files.
- **Actual:** two folders named `Beats`, one file each. The library splits in
  two and `a.wav` is effectively unfindable in the folder the creator opens.
- **Failing test:** `adds a second file to the SAME folder instead of forking the folder` (expected 2 to be 1).

## D2 — The same defect mis-parents a chain — **HIGH**

- **Input:** register `A/B/C/one.wav`, then `A/B/D/two.wav`.
- **Expected:** one `A`, one `A/B`.
- **Actual:** two `A`, two `A/B` — so `C` and `D` hang off **different** `B`
  folders. Genuine mis-parenting, not mere duplication.
- **Failing test:** `does not duplicate a deep chain when a sibling branch is added later`.

**Shared root cause:** folder identity is per-invocation rather than per
`(user, relativePath)`. Related: `gsi1sk` for a folder is the bare name with no
uniqueness constraint, and `idempotencyKeyFromEvent` is consumed only as a log
correlation id (`register-files.ts:62`), so a plain retry of one request
duplicates every file and folder too.

## Why this is severe, not cosmetic

This is not an edge case — it is the PRD's **normal** path. PRD §7's
partial-match dialog ("1,847 of 1,850 files already Stashed · 3 new files ·
**Add new files**") is precisely a second `registerFiles` call into an existing
folder. The defect breaks the product's headline duplicate-handling feature,
and violates project Rule 1 (never reorganize a user's library) by splitting it.

## Why the existing proof missed it

The property test gives every one of its 200 cases a **fresh** `MemoryRepository`
and exactly **one** registration. Multi-call state was structurally outside what
it could observe. The gap was in the brief, not in the implementation work.

## Verification evidence
`npx vitest run services/handlers/files/test/adversarial-hierarchy.test.ts`
→ `2 failed | 16 passed (18)`. Whole repo → `2 failed | 61 passed | 1 skipped (64)`.
Nothing previously passing broke; the only failures are the two
defect-documenting tests. Controller re-ran both and inspected
`register-files.ts:95-124` directly to confirm the root cause.

The validator also self-corrected one false positive of its own (a 1-char path
segment `"a"` occurring by chance inside a hex UUID) and tightened the
assertion rather than reporting a phantom defect.

## Explicitly still unproven
(a) Everything runs against `MemoryRepository`; no DynamoDB repository exists,
so real ordering, `gsi1sk` collisions, 1 MB pagination and item-size limits are
unevidenced — the 500-child listing was never paginated. (b) `listChildren` has
**no pagination at all**. (c) Retry/idempotency semantics are undefined, not
merely untested. (d) Key opacity is proven for key *construction* only; no
upload path exists yet.
