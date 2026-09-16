# Task Report: Trash API lifecycle

## Outcome

Implemented the caller-scoped, recoverable file lifecycle without any S3
operation or quota mutation:

- `DELETE /files/{id}` moves a committed file to `trashed`, returns a
  storage-neutral `{ id, state, purgeAfter }` view, and is idempotent.
- `GET /trash` lists only the caller's recoverable records using the sparse
  per-user index, with DynamoDB pagination.
- `POST /files/{id}/restore` restores only a `trashed` file and rebuilds its
  original folder index. It refuses a `purging` item.
- Normal folder browsing and `GET /files/{id}` hide trashed/purging files.
- `FileRecord` has sparse gsi4 (per-user Trash) and gsi5 (global retention
  queue) keys; transitions add/remove both atomically in DynamoDB.

## Tests added

`trash-lifecycle.test.ts` covers same-repository delete/hide/list/restore,
stable identity, idempotent delete deadline, tenant isolation, non-committed
rejection, and purging restore refusal. `dynamo-repository.test.ts` adds
transition-expression and paginated Trash-query coverage.

## Verification

- `git diff --check`: passed (no whitespace errors; only CRLF advisories).
- Focused Vitest command was attempted:
  `npm test -- --run services/handlers/files/test/trash-lifecycle.test.ts services/handlers/files/test/dynamo-repository.test.ts`
- It could not execute because the current workspace has no runnable local
  Vitest binary: `'vitest' is not recognized as an internal or external
  command`.

Per the brief's missing-tool escalation rule, I did not run a dependency
installation or substitute a different test path. Clean `npm ci` verification
and integration review remain required before acceptance. No deployment was
attempted.

## Follow-up repair

Clean-room integration identified TS2790 in the in-memory Trash transition:
it correctly removes `gsi1pk` and `gsi1sk`, but their FileRecord type had been
required. Those two FileRecord fields are now optional sparse index fields
(FolderRecord keys remain required). `git diff --check` passes; rerun clean
typecheck as part of integration verification.
