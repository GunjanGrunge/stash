# F2 — Controller decisions on validator findings

## F2-1 (HIGH) — `exact` ignores `folderName`: **include `folderName` in `manifestHash`**

Both validators found this independently. Fix at the identity function, not the
call site: `manifestHash` takes `folderName` and folds it into the digest, so
`findByHash` inherently requires the same folder name and the `exact` branch
becomes consistent with the `partial` branch (which already requires a name match).

**Accepted consequence:** the same folder re-stashed under a *renamed* folder
will no longer be detected as a duplicate — it returns `none` and re-uploads.
That is a false negative, which costs bandwidth. A false positive costs a
creator their files. Given the asymmetry, this trade is correct.

## F2-2 (HIGH) — ambiguous same-name candidates: **conservative default, flagged for ratification**

`findByFolderName` matches on name across different `folderId`s, and maximising
overlap maximises how many files are suppressed from `newFiles` — so a client
acting on the response could merge three distinct folders into one (Rule 1).

**Default applied now:** when more than one stored candidate has non-zero
overlap, return `none` rather than guessing which folder the creator means.
Under-reporting wastes bandwidth; mis-identifying loses data.

**RATIFIED BY THE USER 2026-09-15.** Raised at the approval gate with three
options — conservative `none`, `partial` against the best candidate, or a new
`ambiguous` result — and the user chose **conservative `none`**.

This is therefore a ratified product decision, not an implementation default.
A future session must not "optimize" it into reporting `partial` to save
bandwidth: the asymmetry is the whole point. Re-uploading files wastes
bandwidth; naming the wrong folder can make a creator cancel a Stash and
permanently lose files that were never uploaded. Changing it requires a new
approval, not a refactor.

## F2-3 (MEDIUM) — `pairKey` ignores `sizeBytes`: **add it**

`manifestHash` is size-sensitive; the per-file diff key must be too, or the two
notions of "same file" disagree inside one handler.

## F2-5 (MEDIUM) — `folderName` unvalidated: **validate it**

`relativePath` has a full validator; `folderName` has none — no length, charset
or control-character constraint — while participating in matching and (after
F2-1) in the digest. Constrain it.

## Typed event: **fix**

`check-manifest.ts:19,133` types the event as `any`, erasing the shared
library's typed contract even after the tsconfig fix. A typecheck gate that
covers a file typed `any` still proves little.

## AFR-005 — **structural coverage, not another package name**

Root `tsconfig.json` must glob `services/handlers/*/src|test`, so packages added
later are covered by construction. Adding `manifest` by name would repeat the
very mistake AFR-005 records.
