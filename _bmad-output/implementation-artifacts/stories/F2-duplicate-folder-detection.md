# Story F2: Duplicate folder detection before upload

**Status:** PROVED (against in-memory repository; NOT against real DynamoDB) · **Opened/closed:** 2026-09-15
**Format:** BMAD story · **Execution:** SIA evidence gate, scoped subagents
**Depends on:** F1 (proved) — folder hierarchy preservation, `gsi3` checksum index

As a **creator about to Stash a 4.2 GB sample pack I may already own**,
I want **STASH to tell me it already has that folder before it uploads anything**,
So that **I don't burn hours of bandwidth re-uploading files I already have**.

## Why this functionality next

It is the PRD's §7 promise and the most directly felt value in the beta: the
comparison must happen **before** payload upload, or the feature is theatre.
It also exercises the `gsi3` checksum index that F1 validation found would have
been permanently empty — so F2 is partly a real-world proof that that fix works.

## Acceptance Criteria

**Given** a folder manifest identical to one already Stashed
**When** it is checked
**Then** the result is `exact` with the folder, file count and total bytes
**And** no payload upload has been authorized.

**Given** a manifest where 1,847 of 1,850 files are already Stashed
**When** it is checked
**Then** the result is `partial` naming exactly the 3 new files
**And** the existing 1,847 are not re-uploaded.

**Given** a manifest for a folder never seen
**When** it is checked
**Then** the result is `none`.

**Given** two packs containing byte-identical files at different paths
**When** both are checked
**Then** neither is reported as a duplicate of the other
**And** nothing is deleted, repointed or merged (Rule 3).

**Given** the same manifest entries supplied in a different order
**When** hashed
**Then** the hash is identical (order-independent)
**And** a manifest differing only in a file's path hashes differently.

## Cascading Validation

1. Build — scoped implementer subagent.
2. Adversarial validation — an independent subagent attacking the dedupe logic,
   with a standing instruction to hunt for false positives above all: wrongly
   reporting "you already have this" is the failure mode that loses a
   creator's files.
3. Standing-rules review — combined-diff review against all 12 rules and
   AFR-001..004.


---

## Outcome

**Proved**, with limits stated rather than glossed.

- 167 tests green, 1 honestly skipped. Typecheck and `cdk synth` both pass.
- Three independent validation rounds ran: adversarial attack (37 probes),
  standing-rules/security review, and an independent audit of the repair.
- **Four defects found after the build reported success**, three of them false
  positives — the failure mode named as the priority, because a false positive
  can make a creator cancel a Stash and lose files that were never uploaded.
  All fixed and re-verified by a validator that did not write the fix.
- The hash construction survived seven forgery attacks, an 18-pair framing
  attack after the repair, and a 2,000-entry collision corpus. All four defects
  lay in the *identity layer*, never in the hashing.
- The ambiguity behaviour (`none` when two or more same-name candidates
  overlap) is a **user-ratified product decision**, not an implementation
  default. See `sdd/F2-controller-decisions.md`.

**Not proved:** anything against real DynamoDB — no Docker daemon, no Java in
this environment. `findByHash`/`findByFolderName` have no DynamoDB
implementation yet.

**Largest carried risk → AFR-006:** `findByFolderName` pagination. A creator
with many same-name folders spanning a 1 MB DynamoDB query page could have the
candidate list silently truncated, turning an ambiguous case back into a
confident `partial` — re-opening the exact data-loss path F2-2 was created to
close, and only for users with large libraries, i.e. the product's core
audience.

**Also carried:** `putManifest` has no caller, so in production every check
returns `none` until an ingestion path writes manifest records. F2 proves the
detection engine, not an end-to-end feature.
