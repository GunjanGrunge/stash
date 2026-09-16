# Task Brief: manifest lifecycle repair

## Goal

Make completed Stashes persist a manifest made only from their verified
committed files, and use the production DynamoDB manifest repository for
subsequent exact/partial checks. No AWS deployment or infrastructure change.

## Required invariants

- JWT-derived user identity scopes every read and write.
- `checkManifest` remains entirely read-only.
- A manifest contains only files already verified `committed`; pending,
  uploading, and failed files must never be represented as Stashed.
- Paths remain byte-identical and S3 keys remain opaque IDs.
- The manifest repository follows every DynamoDB Query page (AFR-006).

## Design dependency

The existing Stash/File contracts retain neither the selected folder display
name nor a stable selected-root folder identity. `ManifestRecord` requires both
`folderName` and `folderId`; fabricating either in `completeStash` would make a
successful duplicate response point to an invented folder. The lifecycle
writer is blocked pending an approved contract for that metadata.
