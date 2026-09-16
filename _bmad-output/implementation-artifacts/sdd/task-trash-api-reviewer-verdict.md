# Reviewer verdict: Trash API lifecycle

## PASS

The HTTP lifecycle is caller-scoped and recoverable: delete is a metadata-only
transition, normal file reads hide trashed/purging records, Trash is isolated
per creator, and restore is blocked once the retention worker has claimed the
record. The API does not delete S3 objects or decrement quota, preserving the
30-day recovery contract.

The clean-room integration gate passed after the sparse-index type correction:

- `npm ci` completed in a new copy;
- `npm test -- --silent --reporter=dot` reported 40 files, 444 passed and 1
  skipped;
- `npm run typecheck` completed with exit 0;
- `npm run synth` completed with six stacks.

Synthesized API evidence independently confirms 17 JWT API routes and 17 API
Lambda functions, including `DELETE /files/{id}`, `GET /trash`, and
`POST /files/{id}/restore`. No deployment was performed; the currently live
API remains on its previously deployed route set until separately approved.
