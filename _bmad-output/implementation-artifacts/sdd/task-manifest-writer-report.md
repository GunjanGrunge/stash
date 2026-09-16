# Task Report: manifest lifecycle repair

Status: **implementation complete — full integration verification pending**

## Completed work

- Moved `DynamoManifestRepository` from `services/entrypoints` to
  `services/handlers/manifest`, its owning production package.
- Rewired the check-manifest Lambda entry point to the owning adapter.
- Added adapter tests proving JWT-partitioned point reads, exhaustive paginated
  folder-name queries, and conditional create-only writes.
- Targeted test and root typecheck pass.

## Approved contract and completed repair

The user approved the selected-root contract: `POST /stashes` requires and
persists `manifestFolderName`; registration creates and records one stable,
server-owned selected-root Folder; clients never provide a folder ID. File
records retain the data required to form a manifest only after their contents
are verified committed.

`completeStash` now writes the manifest in the same DynamoDB transaction as
the guarded Stash completion and quota reconciliation. The transaction has a
conditional create-only MANIFEST put, so it cannot leave a completed Stash
without a dedupe record. Dedicated tests assert that transaction shape and
that the production Dynamo manifest adapter returns exact and partial results
after completion.

No deployment, AWS mutation, infrastructure edit, package-lock edit, or git
commit occurred. Full-suite verification remains the controller integration
gate.
