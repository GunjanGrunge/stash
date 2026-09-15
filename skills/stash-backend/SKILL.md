---
name: stash-backend
description: Use when writing or reviewing STASH Lambda handlers, the shared services library, DynamoDB access code, or their tests. Carries the security invariants and the TDD contract every handler must satisfy.
---

# STASH — Backend Skill

**Authority:** `AGENT.md` outranks this file. TypeScript, Node 20, Vitest,
`aws-sdk-client-mock` for unit tests, DynamoDB Local for integration.

## Security Invariants (every handler, every time)

1. **`user_id` comes only from verified JWT claims** —
   `event.requestContext.authorizer.jwt.claims.sub`. A `user_id` in a body,
   query string or path is ignored. Test it explicitly.
2. **Creator paths never enter an S3 key.** Keys are
   `users/<user_id>/<file_id>` with server-generated UUIDs.
   `original_relative_path` is a DynamoDB attribute only.
3. **Validate every client path**: reject absolute paths, `..` segments, NUL
   bytes, >1024 chars total, >255 chars per segment. Accept everything else
   **byte-identical** — never normalize, lower-case or rewrite it.
4. **Parameterized DynamoDB expressions only.** No user input concatenated
   into a condition, filter or projection expression.
5. **Cross-tenant requests return 404, not 403.** Existence is not disclosed.
6. **No secrets** in code, logs or errors. Presigned URLs are redacted in
   structured logs.
7. **No LLM call** in any product runtime path (PRD §4.5).

## Correctness Invariants

- **Nothing is Stashed until verified.** The flip to `committed` is a
  conditional write on `state = "uploading"`, after comparing the S3 object's
  size/ETag with the registered manifest entry. A mismatch leaves `failed`.
- **Quota is enforced server-side** with a conditional update
  (`usedBytes + :n <= quotaBytes`); failure returns **507** and writes nothing.
- **Mutating batch operations are idempotent** on a client `Idempotency-Key`;
  a replay returns the original result rather than double-writing.
- **Concurrency** uses conditional writes on a `version` attribute; a loser
  gets **409** with both states. Binary creator assets are never auto-merged.
- **A checksum match is never an identity match.** Same content in two packs
  stays two assets with two keys.

## TDD Contract

Every handler task follows: write the failing test → run it and confirm *why*
it fails → write the minimal implementation → run it green → paste the real
output. **A report claiming a test passed without pasted output is
incomplete** and gets sent back.

Each handler's unit tests must cover: happy path, auth failure, cross-tenant
attempt, quota exceeded (where applicable), idempotent replay, and every
error row the spec lists for it.

## Shared Library Contract

Import from `services/shared` — never re-implement:
`userIdFromEvent`, `HttpError`, `notFound` (404), `quotaExceeded` (507),
`conflict` (409), `badRequest` (400), `validateRelativePath`, `objectKey`,
`logger`, `idempotencyKeyFromEvent`.
