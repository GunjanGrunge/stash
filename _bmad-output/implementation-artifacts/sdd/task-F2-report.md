# Task Report: F2 duplicate folder detection

Status: **complete** (build) — validation pending
Host Evidence: subagent=`stash-task-F2-manifest`, host=claude-code.
Usage: 76,724 subagent tokens, 10 tool uses, 136s.

## What changed
`services/handlers/manifest/` — package.json, tsconfig.json, 5 src files
(types, manifest-hash, repository, memory-repository, check-manifest) and
2 test files (manifest-hash 8 tests, check-manifest 16 tests).

## Verification (controller re-ran independently)
RED: both suites failed to load — implementations absent.
GREEN whole repo: **12 files, 102 passed, 1 skipped** (78 pre-existing + 24 new).
Package typecheck via its own tsconfig: exit 0.

## Behaviour proved
- **No-write assertion passes explicitly**: three checks (exact/partial/none)
  leave `writeCount()` unchanged and `all()` at length 1. No S3 client is
  imported anywhere in the package (Rule 9).
- 1,847 of 1,850 → `partial` with exactly the 3 new entries and correct
  `newBytes` — the PRD §7 dialog, evidenced.
- **False-positive guards**, the named priority failure mode: two packs of
  byte-identical files at different paths → `none`; a same-`folderName`
  manifest sharing zero (path, checksum) pairs → `none`, so a name coincidence
  alone never claims "you already have this"; NFC vs NFD → `none`; another
  user's manifest → `none` (tenancy).
- Same-path-different-checksum counts as new (content changed).
- **AFR-004 honoured**: one repository, three sequential calls — superset →
  `partial` with stable folderId, identical → `exact`, shuffled identical →
  byte-identical `exact`.

## Deviations from the brief
1. The brief did not say which stored manifest to diff against when several
   share a `folderName`. The agent picks greatest overlap, ties broken
   deterministically by lowest `manifestHash`, and skips zero-overlap
   candidates entirely (→ `none`). **Both choices bias toward under-reporting
   certainty**, exactly as the false-positive rule demands. Accepted — this is
   a brief gap correctly resolved in the safe direction.
2. Extra tests added (checksum sensitivity, field-boundary collision, negative
   size, empty checksum, missing folderName, NFC/NFD at handler level).

Note on the hash construction: fields are hex-encoded before joining, so a
path containing the delimiter cannot forge a field boundary. The agent tested
that collision case without being asked.

## Reviewer verdict (build): **complete** — reviewer: controller

Rules: Rule 1 **respected** (no normalization; NFC/NFD distinct at both hash
and handler level); Rule 2 **respected**; **Rule 3 respected** — the rule most
at risk here: detection reports only, and the no-write test proves it;
Rule 7 **respected** (401 on missing sub); Rule 9 **respected** (no S3 import
exists); Rule 12 **respected**; AFR-004 **respected**.

## Controller finding — NOT the subagent's fault, and a CLASS RECURRENCE

`npm run typecheck` **does not cover this package at all**, and exits 0 anyway.
Verified: `npx tsc -p tsconfig.json --listFiles | grep -c handlers/manifest`
returns **0**. The root `tsconfig.json` enumerates
`services/handlers/files/**` by name instead of globbing
`services/handlers/*/**`, so every future handler package is born invisible to
the typecheck gate.

This is the **second instance of the same error class as F-5**: a gate that
reports green while covering nothing. The first instance was fixed at the
instance level (wire up typecheck) rather than the class level (make coverage
structural). → AFR-005.

Assigned to the F2 fix round, not patched by the controller: the root
`tsconfig.json` belongs to the Fix-B task whose boundary is released, so it
goes to a delegated fix with the rest of F2's findings.

## Open question carried
`putManifest` has no caller anywhere in the repo — the ingestion path that
stores a `ManifestRecord` after a completed folder does not exist yet. Until it
does, every check returns `none` in production. This is correct for F2's scope
(detection only), but F2's value is not realized until the write path lands.
Recorded so it is not mistaken for a working end-to-end feature.
