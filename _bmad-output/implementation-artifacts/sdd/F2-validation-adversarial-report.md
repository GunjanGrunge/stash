# Validation Report: Adversarial duplicate-detection attack (F2)

Status: **complete — 2 defects found, both FALSE POSITIVES**
Host Evidence: subagent=`stash-f2-adversarial-validator`, host=claude-code.
Usage: 108,473 subagent tokens, 10 tool uses, 183s.
Owned file: `services/handlers/manifest/test/adversarial-manifest.test.ts` (37 tests).

## 37 attacks: 35 SURVIVED, 2 DEFECTS

**Survived** — now permanent regression tests: same folderName with every path
differing; 20 files sharing one checksum; 3-file and 1-file subsets vs a
1,850-file folder (`partial`, never `exact`); checksum and path case-folding;
**seven separate hash-forgery attacks** (delimiter in path, delimiter in
checksum, newline in checksum, path = hex of another field, one entry
impersonating two lines, boundary shifting, exponent-notation sizes); duplicate
identical entries; 500 shuffles of a 200-entry manifest; a 2,000-entry corpus
with no collisions; Unicode NFC/NFD/combining/RTL/emoji all distinct; forged
body `user_id`/`userId`/`sub`/`pk`; `folderName` shaped as `USER#…` and
`MANIFEST#…`; a userId containing the `#` delimiter aliasing another tenant;
401 on missing/empty/numeric/null `sub` with no folderId leaked; **zero writes
with a deep-frozen record across all five branches**; `fetch` spied and never
called, no S3 client in source; 17 malformed bodies → 400; **prototype
pollution** via `__proto__` as folderName, path segment and JSON-injected key;
5,000-entry off-by-one; 200 randomized folders verifying
`existingCount + newFiles.length === entries.length` and
`newBytes === sum(newFiles)`.

## DEFECT 1 — `exact` ignores `folderName` — **HIGH**

`check-manifest.ts:147` resolves `exact` purely via `findByHash`, and
`manifestHash` does not include `folderName`. The `partial` branch at `:163`
*does* require a name match — the two branches are inconsistent.

- **Input:** stored `Client A Deliverables` (logo.png, brief.pdf); request
  `Client B Deliverables` with the same two files.
- **Expected:** not `exact` — the creator has never Stashed "Client B".
- **Actual:** `{match:"exact", folderId:"folder-A", folderName:"Client A Deliverables"}`.
  The UI says *"You already have this folder in STASH"* and names the **wrong
  folder**. Cancelling loses Client B's deliverables entirely.
- **Failing test:** `DEFECT HUNT: identical contents under a DIFFERENT folderName must not be exact` (line 95).

**Why this is the serious one:** it is reachable through ordinary, honest
behaviour — any creator who duplicates a template folder per project or per
client hits it. It produces precisely the message that causes a cancelled
Stash, and a cancelled Stash for content that was never uploaded is permanent
data loss.

## DEFECT 2 — `pairKey` ignores `sizeBytes` — **MEDIUM**

`check-manifest.ts:50-53` keys the per-file diff on `relativePath` + `checksum`
only, while `manifestHash` **is** size-sensitive — the diff key contradicts the
identity function beside it.

- **Input:** stored `Pack/b.wav` at 2 bytes / checksum `bb`; request
  `Pack/b.wav` at 4 GB / checksum `bb`.
- **Expected:** `existingCount: 1`, the 4 GB file reported new.
- **Actual:** `existingCount: 2`, `newFiles: []`, `newBytes: 0` — the 4 GB file
  is declared already Stashed and never uploaded, and the "N MB" figure in the
  dialog under-reports.
- **Failing test:** `DEFECT HUNT: same path + same checksum but a DIFFERENT sizeBytes must count as NEW` (line 217).

Reachable only via a buggy or hostile client, or a stale stored record — but
the claim under test is *never* a false positive.

## Verification evidence
`37 tests | 2 failed | 35 passed`. Whole repo:
`2 failed | 137 passed | 1 skipped (140)` — 102 previously-passing plus 35 new
passing; nothing previously green was broken. Controller re-ran both and
confirmed the root causes at `check-manifest.ts:147` and `:50-53`.

## Assessment
**The hash itself is genuinely strong.** Hex-encoding both path and checksum
makes the delimiters unforgeable; seven boundary attacks and a 2,000-entry
corpus produced no collision. Order-independence, path-sensitivity, Unicode
non-normalization, tenancy isolation, read-only/no-S3 behaviour and the partial
arithmetic all survived everything thrown at them.

**Both failures are in the identity layer, not the hash.** That is a precise and
useful diagnosis: the fix belongs in what counts as "the same folder" and "the
same file", not in the hashing.

## Explicitly unproven
In-memory repository only — no DynamoDB implementation of
`findByHash`/`findByFolderName` exists, so tenancy and read-only are proven for
the *port contract*, not a real table. Concurrency (a check racing a write of
the same manifest) untested. Fractional `sizeBytes` is accepted by validation
and would yield fractional `newBytes`. The check never validates a stored
record's `fileCount`/`totalBytes` against its own entries, so a corrupted
stored record is trusted silently.
