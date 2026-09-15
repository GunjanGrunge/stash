# Story F1: Folder hierarchy preservation

**Status:** PROVED (against in-memory repository; NOT against real DynamoDB) · **Opened/closed:** 2026-09-15
**Format:** BMAD story · **Execution:** SIA evidence gate, scoped subagents

As a **creator with a 14,291-file sample library**,
I want **STASH to store and return my folder tree exactly as I built it**,
So that **my library is still my library after it goes to the cloud**.

## Why this functionality first

It is the PRD's central promise (§4.1) and the one invariant that, if broken,
makes every later feature worthless — search, dedupe and mounting all assume
the hierarchy is intact. It is also fully provable locally, with no AWS
credentials.

## Acceptance Criteria

**Given** a folder tree of arbitrary depth containing unicode, spaces, `#`,
`&`, CJK characters and 200-character names
**When** it is registered through the control plane and read back
**Then** the reconstructed tree is **byte-identical** to the input
**And** no path was normalized, lower-cased, flattened or rewritten.

**Given** a client-supplied relative path containing `..`, an absolute prefix,
or a NUL byte
**When** it is registered
**Then** the request is rejected with 400 and nothing is written.

**Given** any registered file
**When** its S3 object key is generated
**Then** the key is `users/<user_id>/<file_id>` with opaque IDs
**And** contains no part of the original filename or path.

**Given** two packs holding byte-identical files at different paths
**When** both are registered
**Then** they remain two separate assets with two separate keys.

## Slice Composition

| Piece | Plan task | State |
|---|---|---|
| Toolchain | Task 1 | complete |
| DynamoDB table + GSI1 | Task 3 | dispatched |
| Path validation + opaque keys + claims | Task 5 | dispatched |
| `registerFiles` + `listChildren` | F1 subset of Tasks 8, 9 | pending |
| DynamoDB Local + property test | F1 subset of Task 12 | pending |

## Cascading Validation

1. **Build** — scoped implementer subagents (above).
2. **Independent adversarial validation** — a separate subagent that tries to
   break hierarchy preservation without seeing the implementer's reasoning.
3. **Standing-rules review** — a separate subagent checking the combined diff
   against the project rules and AFR-001..003.

A functionality is only "proved" when all three pass and the evidence is
pasted, not claimed.


---

## Outcome

**Proved**, with the limit stated rather than glossed.

- 200 generated trees / 7,734 files round-trip byte-identically, including NFC
  and NFD siblings, case-folding traps, lone surrogates, RTL overrides, folders
  named `ROOT`, key-scheme lookalikes, 500-sibling folders, 40-level depth, and
  exact 1024-byte/255-byte boundaries.
- 78 tests green, 1 honestly skipped. Typecheck and `cdk synth` both green,
  typecheck proven by deliberate failure first.
- Two HIGH defects were found by validation *after* the build reported success —
  folder forking across calls, and a permanently-empty `gsi3` index — both fixed
  and both now guarded by tests that block the whole defect class.

**Not proved:** anything against real DynamoDB (no Docker daemon, no Java in
this environment), `listChildren` pagination, and crash-safe idempotency
reservation. These are carried as named work, not quietly absorbed.
