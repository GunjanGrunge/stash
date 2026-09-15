# Task Brief: Shared services library

Goal: Build the shared library that every STASH Lambda handler consumes —
claims extraction, error types, path validation, S3 key construction, logging
and idempotency.

Files (exclusive ownership boundary):
- `services/shared/package.json`
- `services/shared/src/claims.ts`
- `services/shared/src/errors.ts`
- `services/shared/src/paths.ts`
- `services/shared/src/keys.ts`
- `services/shared/src/logger.ts`
- `services/shared/src/idempotency.ts`
- `services/shared/src/index.ts`
- `services/shared/test/claims.test.ts`
- `services/shared/test/paths.test.ts`
- `services/shared/test/keys.test.ts`

Interfaces — produce these EXACT signatures; Tasks 6–9 import them by name:
```ts
export function userIdFromEvent(event: APIGatewayProxyEventV2WithJWTAuthorizer): string;
export class HttpError extends Error { constructor(status: number, code: string, message: string); }
export const notFound: (what: string) => HttpError;      // 404
export const quotaExceeded: () => HttpError;             // 507
export const conflict: (message: string) => HttpError;   // 409
export const badRequest: (message: string) => HttpError; // 400
export function validateRelativePath(p: string): string; // throws badRequest
export function objectKey(userId: string, fileId: string): string; // `users/${userId}/${fileId}`
export function logger(correlationId: string): { info(msg: string, fields?: Record<string, unknown>): void };
export function idempotencyKeyFromEvent(event: APIGatewayProxyEventV2WithJWTAuthorizer): string | undefined;
```
`index.ts` re-exports all of them. Use `@types/aws-lambda` for the event type.

Steps (TDD — write the test first, watch it fail, then implement):
1. Write `test/claims.test.ts`: `userIdFromEvent` returns
   `event.requestContext.authorizer.jwt.claims.sub`; THROWS when that claim is
   absent; and IGNORES a `user_id` present in the request body — assert the
   body value never appears in the result.
2. Write `test/paths.test.ts`: `validateRelativePath` REJECTS
   `../etc/passwd`, `/absolute/path`, `a/../../b`, a string containing a NUL
   byte, a path over 1024 chars, and any single segment over 255 chars.
   It ACCEPTS `KSHMR Vol 5/Kicks/Kick_G#_128.wav` and a unicode path,
   returning them BYTE-IDENTICAL to the input.
3. Write `test/keys.test.ts`: `objectKey("u1","f1")` === `users/u1/f1`;
   and for a file originally named `Kick_G#_128.wav`, the returned key
   contains NO part of that filename and no `/` beyond the two structural ones.
4. Run `npx vitest run services/shared` — confirm all three FAIL on
   unresolved modules. Record why they failed.
5. Write the eight source files to the exact signatures above.
6. Run the tests again — confirm all green.
7. Verification: paste the full Vitest output.

Acceptance Criteria: all three test files green, with the
body-`user_id`-ignored, path-traversal-rejected and byte-identical-unicode
assertions explicitly passing. Paste real output.

Effort Budget: 45 tool calls.

Relevant Standing Rules (verbatim — these are exactly what this task's files
govern):
- Rule 1: Never reorganize a user's library. `original_relative_path` is
  preserved verbatim — no renaming, flattening, categorizing or moving. This
  is why `validateRelativePath` must return its input byte-identical rather
  than normalizing, lower-casing or rewriting it.
- Rule 6: S3 object keys are `users/<user_id>/<file_id>` — opaque IDs only.
  Creator-supplied paths never enter a key.
- Rule 7: `user_id` comes ONLY from verified JWT claims. Never from a request
  body, query string or path parameter.
- Rule 12: Never write AWS credentials into the repository or any artifact.

Working directory: `/mnt/c/Users/Bot/Desktop/stash`
Host Evidence: host=claude-code; subagent=stash-task-5-shared-lib.

Escalate, don't improvise, when: an unexpected dependency the brief did not mention; a file the brief did not list needing changes; a conflicting or already-modified file; a requirement ambiguous enough to support two different implementations; a missing tool, credential, or piece of environment; a test that fails for a reason unrelated to this task's own change; or the Effort Budget exceeded with the task still incomplete. Report status `blocked` with exactly what was found — improvising past any of them is scope creep even when the improvisation would probably work.
