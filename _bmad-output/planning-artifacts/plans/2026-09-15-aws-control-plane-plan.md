# STASH — AWS Control-Plane Foundation: Implementation Plan

**Date:** 2026-09-15 · **Status:** DRAFT — awaiting approval
**Spec:** `_bmad-output/planning-artifacts/specs/2026-09-15-aws-control-plane-design.md` (approved)
**Contract:** `AGENT.md` · **Evidence root:** `_bmad-output/implementation-artifacts/sdd/`

Whoever executes a task has **no memory of this session** and sees only their
own brief. Every task therefore states exact file paths, exact interface
names, and real content — never "similar to Task N".

## Stack (decided, not assumed)

AWS CDK v2 · TypeScript (Node 20) · Vitest · DynamoDB single-table ·
S3 SSE-S3, versioning off, Standard · Cognito, MFA optional · `ap-south-1`.

## Delegation Rule

Claude Code supports subagents, so every implementation task is
`Delegation: scoped implementer subagent`. Only Task 13 (wiring) and the
Integration phase are `controller-owned`, and neither writes handler or
stack logic — they reconcile files other tasks were forbidden to touch.
The controller never implements a task-owned file.

Per task, before any file changes: `sdd/task-N-brief.md`,
`sdd/task-N-dispatch.md`, then `sdd/task-N-report.md` with a reviewer verdict,
and an appended entry in `sdd/progress.md`.

## Ownership Map (no two tasks share a file)

| Task | Owns |
|---|---|
| 1 | `package.json`, `tsconfig.base.json`, `vitest.config.ts`, `.nvmrc` |
| 2 | `infra/package.json`, `infra/tsconfig.json`, `cdk.json` |
| 3 | `infra/lib/data-stack.ts`, `infra/test/data-stack.test.ts` |
| 4 | `infra/lib/identity-stack.ts`, `infra/test/identity-stack.test.ts` |
| 5 | `services/shared/**` |
| 6 | `services/handlers/stash-lifecycle/**` |
| 7 | `services/handlers/manifest/**` |
| 8 | `services/handlers/uploads/**` |
| 9 | `services/handlers/reads/**` |
| 10 | `infra/lib/api-stack.ts`, `infra/test/api-stack.test.ts` |
| 11 | `infra/lib/observability-stack.ts`, `infra/test/observability-stack.test.ts` |
| 12 | `services/integration-test/**` |
| 13 | `infra/bin/stash.ts` — **the deliberate integration task** (see below) |
| 14 | `README.md` |
| 15 | `docs/deploy-runbook.md` |

**Declared overlap, owned deliberately:** Tasks 3, 4, 10 and 11 each create a
stack, and all four would otherwise need to edit the CDK app entry point.
They are **forbidden to touch `infra/bin/stash.ts`**. Task 13 owns that file
exclusively and instantiates all four stacks. This is the integration task
the Owned Files rule requires — named here, not left implicit.

---

## Task 1 — Repository toolchain

**Delegation:** scoped implementer subagent
**Files:** `package.json`, `tsconfig.base.json`, `vitest.config.ts`, `.nvmrc`

**Interfaces**
- Consumes: nothing (first task).
- Produces: npm workspaces `["infra", "services/*"]`; scripts `test`
  (`vitest run`), `typecheck` (`tsc -b`), `synth` (`npm -w infra run synth`);
  `tsconfig.base.json` with `"strict": true`, `"target": "ES2022"`,
  `"module": "NodeNext"`, `"moduleResolution": "NodeNext"`,
  `"noUncheckedIndexedAccess": true`. Node version pinned to `20`.

**Steps**
1. Write `vitest.config.ts` with `test.include: ["**/*.test.ts"]` and
   `test.environment: "node"`.
2. Run `npx vitest run` — confirm it fails with "No test files found".
   That failure is the check that the toolchain is not yet proven.
3. Write `package.json` with the workspaces and scripts above, devDeps
   `typescript@^5.6`, `vitest@^2`, `@types/node@^20`, `aws-cdk-lib@^2`,
   `constructs@^10`, `aws-cdk@^2`.
4. Write `tsconfig.base.json` and `.nvmrc` (`20`).
5. Run `npm install`, then `npx vitest run` again — confirm the exit code is
   now 0 with zero tests, proving the runner resolves.
6. Verification: paste the output of `npm install` and `npx tsc --version`
   (must print 5.x).

**Acceptance:** `npm install` succeeds and `npx tsc --version` reports 5.x.

---

## Task 2 — CDK workspace

**Delegation:** scoped implementer subagent
**Files:** `infra/package.json`, `infra/tsconfig.json`, `cdk.json`

**Interfaces**
- Consumes: root workspaces and `tsconfig.base.json` from Task 1.
- Produces: `cdk.json` with `"app": "npx tsx infra/bin/stash.ts"`, context
  `"@aws-cdk/core:target-partitions": ["aws"]`; `infra` script
  `synth` → `cdk synth`. Env constants exported later by Task 13.

**Steps**
1. Write `infra/package.json` (name `@stash/infra`, private, deps
   `aws-cdk-lib`, `constructs`, devDep `tsx`).
2. Write `infra/tsconfig.json` extending `../tsconfig.base.json`.
3. Write `cdk.json` as above.
4. Run `npx cdk synth` — confirm it fails because `infra/bin/stash.ts` does
   not exist yet (Task 13 owns it). Record the exact error.
5. Verification: the failure message names the missing entry file, proving
   wiring is correct and only the entry point is absent.

**Acceptance:** `cdk.json` resolves and the only synth blocker is the
not-yet-written entry file owned by Task 13.

---

## Task 3 — `StashDataStack` (DynamoDB + S3)

**Delegation:** scoped implementer subagent
**Files:** `infra/lib/data-stack.ts`, `infra/test/data-stack.test.ts`

**Interfaces**
- Consumes: nothing from other tasks.
- Produces, exactly:
  ```ts
  export interface StashDataStackProps extends cdk.StackProps {}
  export class StashDataStack extends cdk.Stack {
    readonly table: dynamodb.Table;      // logical id "StashTable"
    readonly bucket: s3.Bucket;          // logical id "StashBucket"
    constructor(scope: Construct, id: string, props?: StashDataStackProps);
  }
  ```
  Table: `partitionKey` `pk` (STRING), `sortKey` `sk` (STRING),
  `billingMode: PAY_PER_REQUEST`, `pointInTimeRecovery: true`,
  `removalPolicy: RETAIN`. GSIs named exactly `gsi1` (`gsi1pk`/`gsi1sk`),
  `gsi2` (`gsi2pk`/`gsi2sk`), `gsi3` (`gsi3pk`/`gsi3sk`).
  Bucket: `encryption: S3_MANAGED`, `versioned: false`,
  `blockPublicAccess: BLOCK_ALL`, `enforceSSL: true`,
  `lifecycleRules: [{ abortIncompleteMultipartUploadAfter: Duration.days(7) }]`,
  `removalPolicy: RETAIN`.

**Steps**
1. Write `infra/test/data-stack.test.ts` asserting, via
   `Template.fromStack`: the table has three named GSIs; the bucket has
   `BucketEncryption` AES256; `VersioningConfiguration` is absent;
   PublicAccessBlockConfiguration all true; a lifecycle rule with
   `AbortIncompleteMultipartUpload: { DaysAfterInitiation: 7 }`; and a bucket
   policy statement denying `s3:*` when `aws:SecureTransport` is `false`.
2. Run `npx vitest run infra/test/data-stack.test.ts` — confirm it fails
   because `../lib/data-stack` cannot be resolved.
3. Write `infra/lib/data-stack.ts` to the interface above.
4. Run the test again — confirm all assertions pass.
5. Verification: paste the passing Vitest output into the task report.

**Acceptance:** every assertion in step 1 passes.
**Standing rule in scope:** project rule 8 — versioning off means never
overwrite a key; assert `versioned: false` explicitly rather than by default.

---

## Task 4 — `StashIdentityStack` (Cognito)

**Delegation:** scoped implementer subagent
**Files:** `infra/lib/identity-stack.ts`, `infra/test/identity-stack.test.ts`

**Interfaces**
- Produces, exactly:
  ```ts
  export class StashIdentityStack extends cdk.Stack {
    readonly userPool: cognito.UserPool;              // logical id "StashUserPool"
    readonly userPoolClient: cognito.UserPoolClient;  // logical id "StashDesktopClient"
    constructor(scope: Construct, id: string, props?: cdk.StackProps);
  }
  ```
  Pool: sign-in by email, `mfa: cognito.Mfa.OPTIONAL`,
  `mfaSecondFactor: { sms: false, otp: true }`, password policy min length 12
  requiring lower/upper/digits/symbols, `selfSignUpEnabled: false`,
  custom attribute `quota_bytes` (`cognito.NumberAttribute`, mutable),
  `removalPolicy: RETAIN`.
  Client: `generateSecret: false`, `authFlows: { userSrp: true }`,
  `accessTokenValidity: Duration.minutes(60)`,
  `refreshTokenValidity: Duration.days(30)`, no hosted-UI OAuth flows.

**Steps**
1. Write `infra/test/identity-stack.test.ts` asserting: `MfaConfiguration`
   is `OPTIONAL`; the client has no `ClientSecret` generated
   (`GenerateSecret: false`); `ExplicitAuthFlows` includes
   `ALLOW_USER_SRP_AUTH` and **excludes** `ALLOW_USER_PASSWORD_AUTH`;
   `AdminCreateUserConfig.AllowAdminCreateUserOnly` is true; the schema
   contains `quota_bytes`.
2. Run the test — confirm it fails on the unresolved module.
3. Write `infra/lib/identity-stack.ts` to the interface above.
4. Run the test again — confirm it passes.
5. Verification: paste the passing output.

**Acceptance:** all assertions pass, with the no-client-secret and
no-plain-password-auth assertions explicitly green (PRD §12).

---

## Task 5 — Shared services library

**Delegation:** scoped implementer subagent
**Files:** `services/shared/package.json`, `services/shared/src/claims.ts`,
`services/shared/src/errors.ts`, `services/shared/src/paths.ts`,
`services/shared/src/keys.ts`, `services/shared/src/logger.ts`,
`services/shared/src/idempotency.ts`, `services/shared/src/index.ts`,
`services/shared/test/claims.test.ts`, `services/shared/test/paths.test.ts`,
`services/shared/test/keys.test.ts`

**Interfaces** — produced for Tasks 6–9, exact signatures:
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

**Steps**
1. Write `services/shared/test/claims.test.ts`: `userIdFromEvent` returns
   `event.requestContext.authorizer.jwt.claims.sub`; **throws** when the
   claim is absent; and **ignores** a `user_id` present in the request body
   (assert the body value never appears in the result).
2. Write `services/shared/test/paths.test.ts`: `validateRelativePath`
   rejects `../etc/passwd`, `/absolute/path`, `a/../../b`, a NUL byte, a
   path over 1024 chars, and a segment over 255 chars; accepts
   `KSHMR Vol 5/Kicks/Kick_G#_128.wav` and a unicode path unchanged (assert
   byte-identical return — project rule 1).
3. Write `services/shared/test/keys.test.ts`: `objectKey` output contains
   neither the original filename nor any `/` beyond the two structural ones
   (project rule 6).
4. Run all three — confirm they fail on unresolved modules.
5. Write the eight source files to the signatures above.
6. Run all three again — confirm green.
7. Verification: paste the full Vitest output.

**Acceptance:** all three test files green.
**Standing rules in scope:** rules 1, 6, 7, 12.

---

## Task 6 — Stash lifecycle handlers

**Delegation:** scoped implementer subagent
**Files:** `services/handlers/stash-lifecycle/package.json`,
`services/handlers/stash-lifecycle/src/create-stash.ts`,
`.../src/cancel-stash.ts`, `.../src/complete-stash.ts`, `.../src/repository.ts`,
`services/handlers/stash-lifecycle/test/create-stash.test.ts`,
`.../test/cancel-stash.test.ts`, `.../test/complete-stash.test.ts`

**Interfaces**
- Consumes from Task 5: `userIdFromEvent`, `HttpError`, `quotaExceeded`,
  `conflict`, `badRequest`, `logger`, `idempotencyKeyFromEvent`.
- Produces: `export const handler` in each of the three src files.
  Item shapes: Stash `pk=USER#<userId>`, `sk=STASH#<stashId>`,
  `state: "open"|"completed"|"cancelled"`, `reservedBytes`, `committedBytes`,
  `createdAt`. User profile `pk=USER#<userId>`, `sk=PROFILE`,
  `quotaBytes`, `usedBytes`.

**Steps**
1. Write `create-stash.test.ts` with `aws-sdk-client-mock`: on success a
   `TransactWriteItems` reserves `usedBytes + manifestTotal` under
   `ConditionExpression` `usedBytes + :n <= quotaBytes`; a
   `ConditionalCheckFailed` maps to HTTP **507** and no Stash item is
   written; a replayed `Idempotency-Key` returns the original `stashId`
   without a second write.
2. Write `cancel-stash.test.ts`: cancelling an `open` Stash sets state
   `cancelled` and decrements `usedBytes` by the full reservation;
   cancelling an already-`completed` Stash returns **409** and changes
   nothing.
3. Write `complete-stash.test.ts`: `committedBytes` is recomputed from a
   `gsi2` query of `committed` files only, `usedBytes` is corrected from the
   reservation to that actual total, and a file still in `uploading` is
   **not** counted (project rule 4).
4. Run all three — confirm they fail on unresolved handlers.
5. Write `repository.ts` and the three handlers.
6. Run again — confirm green.
7. Verification: paste the output.

**Acceptance:** all three test files green, including the 507, the 409, and
the "uploading is not committed" assertion.
**Standing rules in scope:** rules 4, 7.

---

## Task 7 — Manifest / duplicate-folder handler

**Delegation:** scoped implementer subagent
**Files:** `services/handlers/manifest/package.json`,
`services/handlers/manifest/src/check-manifest.ts`,
`.../src/manifest-hash.ts`,
`services/handlers/manifest/test/check-manifest.test.ts`,
`.../test/manifest-hash.test.ts`

**Interfaces**
- Consumes from Task 5: `userIdFromEvent`, `validateRelativePath`, `badRequest`.
- Produces:
  ```ts
  export function manifestHash(entries: ManifestEntry[]): string; // sha256 hex
  export interface ManifestEntry { relativePath: string; sizeBytes: number; checksum: string; }
  export type ManifestCheckResult =
    | { match: "exact"; folderId: string; fileCount: number; totalBytes: number }
    | { match: "partial"; folderId: string; existingCount: number; newFiles: ManifestEntry[] }
    | { match: "none" };
  ```

**Steps**
1. Write `manifest-hash.test.ts`: the hash is order-independent (same
   entries shuffled hash equal) and path-sensitive (`Vol 4/Kicks/x.wav` vs
   `Vol 5/Kicks/x.wav` with identical checksums hash **differently** —
   project rule 3).
2. Write `check-manifest.test.ts`: an identical manifest returns
   `match: "exact"` with counts; 1,847 of 1,850 matching returns
   `match: "partial"` with exactly the 3 new entries; an unseen manifest
   returns `match: "none"`; and assert the handler performs **no** S3 call
   at all (dedupe happens before payload upload — spec §4 step 4).
3. Run both — confirm failure.
4. Write `manifest-hash.ts` and `check-manifest.ts`.
5. Run again — confirm green.
6. Verification: paste the output.

**Acceptance:** both green, including the no-S3-call and the
same-checksum-different-pack assertions.
**Standing rules in scope:** rules 2, 3.

---

## Task 8 — Upload authorization handlers

**Delegation:** scoped implementer subagent
**Files:** `services/handlers/uploads/package.json`,
`services/handlers/uploads/src/register-files.ts`, `.../src/sign-parts.ts`,
`.../src/complete-upload.ts`, `.../src/abort-upload.ts`,
`services/handlers/uploads/test/register-files.test.ts`,
`.../test/sign-parts.test.ts`, `.../test/complete-upload.test.ts`,
`.../test/abort-upload.test.ts`

**Interfaces**
- Consumes from Task 5: `userIdFromEvent`, `validateRelativePath`,
  `objectKey`, `conflict`, `badRequest`, `notFound`.
- Consumes from Task 7: `ManifestEntry`.
- Produces: `export const handler` per file. File item: `pk=USER#<userId>`,
  `sk=FILE#<fileId>`, `state: "pending"|"uploading"|"committed"|"failed"`,
  `originalRelativePath`, `sizeBytes`, `checksum`, `objectKey`,
  `gsi2pk=USER#<userId>#STASH#<stashId>`, plus empty `searchTokens: []` and
  `extractedMetadata: {}` reserved for the later search scope.

**Steps**
1. Write `register-files.test.ts`: a 3-level folder tree registers Folder
   items preserving `parentFolderId` and byte-identical
   `originalRelativePath`; files start `pending`; the returned `objectKey`
   matches `users/<userId>/<uuid>` and **contains no part of the original
   filename** (project rule 6); a batch over 25 items is split rather than
   rejected; a replayed `Idempotency-Key` does not double-write.
2. Write `sign-parts.test.ts`: the presigned URL TTL is ≤ 15 minutes and the
   file flips `pending → uploading`; signing a file already `committed`
   returns **409**.
3. Write `complete-upload.test.ts`: on `CompleteMultipartUpload`, the
   resulting object size is compared with the registered `sizeBytes` and the
   state flips to `committed` **only** under a
   `ConditionExpression` on `state = "uploading"`; a size mismatch leaves
   state `failed` and the report asserts the file is **not** counted as
   Stashed (project rule 4).
4. Write `abort-upload.test.ts`: aborting issues `AbortMultipartUpload` and
   releases that file's reserved bytes exactly once (a second abort is a
   no-op, not a double credit).
5. Run all four — confirm failure.
6. Write the four handlers.
7. Run again — confirm green.
8. Verification: paste the output.

**Acceptance:** all four green, with the key-opacity, size-verification and
double-abort assertions explicitly passing.
**Standing rules in scope:** rules 1, 4, 6, 8, 9.

---

## Task 9 — Read handlers

**Delegation:** scoped implementer subagent
**Files:** `services/handlers/reads/package.json`,
`services/handlers/reads/src/list-children.ts`, `.../src/get-file.ts`,
`.../src/list-stashes.ts`, `.../src/get-usage.ts`, `.../src/devices.ts`,
`services/handlers/reads/test/list-children.test.ts`,
`.../test/get-file.test.ts`, `.../test/list-stashes.test.ts`,
`.../test/get-usage.test.ts`, `.../test/devices.test.ts`

**Interfaces**
- Consumes from Task 5: `userIdFromEvent`, `notFound`.
- Produces: `export const handler` per file. `get-usage` returns
  `{ usedBytes: number; quotaBytes: number }`.

**Steps**
1. Write `list-children.test.ts`: queries `gsi1` with
   `gsi1pk = USER#<userId>#PARENT#<folderId>`, returns children sorted by
   name, and paginates via an opaque cursor.
2. Write `get-file.test.ts`: **requesting another user's `fileId` returns
   404, not 403** (spec §5 — existence is not disclosed), and the query is
   scoped by `pk=USER#<callerId>` taken from claims only (project rule 7).
3. Write `list-stashes.test.ts`: returns Stashes newest first with state
   and counts.
4. Write `get-usage.test.ts`: reads the profile item and returns both
   numbers.
5. Write `devices.test.ts`: registering a device writes a `DEVICE#` item;
   revoking sets `revokedAt` and the item is **retained**, not deleted, so
   the audit trail survives (PRD §12).
6. Run all five — confirm failure.
7. Write the five handlers.
8. Run again — confirm green.
9. Verification: paste the output.

**Acceptance:** all five green, with the cross-tenant-404 assertion explicit.
**Standing rules in scope:** rules 7, 12.

---

## Task 10 — `StashApiStack`

**Delegation:** scoped implementer subagent
**Files:** `infra/lib/api-stack.ts`, `infra/test/api-stack.test.ts`

**Interfaces**
- Consumes: `StashDataStack.table` / `.bucket` (Task 3),
  `StashIdentityStack.userPool` / `.userPoolClient` (Task 4), and the handler
  entry paths from Tasks 6–9.
- Produces:
  ```ts
  export interface StashApiStackProps extends cdk.StackProps {
    table: dynamodb.Table; bucket: s3.Bucket;
    userPool: cognito.IUserPool; userPoolClient: cognito.IUserPoolClient;
  }
  export class StashApiStack extends cdk.Stack {
    readonly httpApi: apigwv2.HttpApi;
    constructor(scope: Construct, id: string, props: StashApiStackProps);
  }
  ```
  Routes exactly as spec §3.4, including `POST /stashes/{id}/cancel`.
  One `NodejsFunction` and one IAM role per handler.

**Steps**
1. Write `infra/test/api-stack.test.ts` asserting: **every** route has
   `AuthorizerId` set (iterate all `AWS::ApiGatewayV2::Route` resources — a
   route without an authorizer fails the build); **no** IAM policy statement
   in the template has `Resource: "*"`; the presign role's `s3:PutObject`
   resource ends with `/users/*`; read handlers have no `dynamodb:PutItem`;
   and the route count matches the 13 routes in spec §3.4.
2. Run it — confirm failure on the unresolved module.
3. Write `infra/lib/api-stack.ts`: HTTP API, `HttpJwtAuthorizer` bound to the
   user pool issuer, per-handler functions with least-privilege grants
   (`grantReadData` vs `grantWriteData`, never `grantFullAccess`).
4. Run again — confirm green.
5. Verification: paste the output, including the wildcard-free assertion.

**Acceptance:** all assertions pass; the no-wildcard and
every-route-authorized assertions are the gate.
**Standing rules in scope:** rules 7, 9, 11, 12.

---

## Task 11 — `StashObservabilityStack`

**Delegation:** scoped implementer subagent
**Files:** `infra/lib/observability-stack.ts`,
`infra/test/observability-stack.test.ts`

**Interfaces**
- Consumes: `StashApiStack.httpApi`, `StashDataStack.table`/`.bucket`.
- Produces:
  ```ts
  export interface StashObservabilityStackProps extends cdk.StackProps {
    httpApi: apigwv2.HttpApi; table: dynamodb.Table; bucket: s3.Bucket;
    monthlyBudgetUsd: number; budgetAlertEmail: string;
  }
  export class StashObservabilityStack extends cdk.Stack { ... }
  ```

**Steps**
1. Write the test asserting: every `AWS::Logs::LogGroup` has an explicit
   `RetentionInDays` (never absent — absent means infinite retention and a
   silent recurring cost); an `AWS::Budgets::Budget` exists with
   `NotificationsWithSubscribers` at 80% and 100%; cost-allocation tags
   `Project=STASH` and `Env=beta` are applied at stack level.
2. Run it — confirm failure.
3. Write `infra/lib/observability-stack.ts`.
4. Run again — confirm green.
5. Verification: paste the output.

**Acceptance:** all assertions pass.

---

## Task 12 — Integration tests against DynamoDB Local

**Delegation:** scoped implementer subagent
**Files:** `services/integration-test/package.json`,
`services/integration-test/src/harness.ts`,
`services/integration-test/test/folder-roundtrip.test.ts`,
`services/integration-test/test/manifest-match.test.ts`,
`services/integration-test/test/concurrency.test.ts`,
`services/integration-test/README.md`

**Interfaces**
- Consumes: the item shapes from Tasks 6–9 and `objectKey` from Task 5.
- Produces: `startLocalDynamo(): Promise<{ endpoint: string; stop(): Promise<void> }>`.

**Steps**
1. Write `folder-roundtrip.test.ts` as a **property test**: generate random
   folder trees (depth 1–5, names including spaces, `#`, `&`, emoji, CJK,
   and 200-char names), register them, read them back through
   `list-children`, and assert the reconstructed tree is **byte-identical**
   to the input. This is PRD §4.1 held to a test.
2. Write `manifest-match.test.ts`: exact / partial / none against a real
   table, including two packs with identical checksums staying separate
   assets (project rule 3).
3. Write `concurrency.test.ts`: two simultaneous conditional writes to one
   file — exactly one wins, the other returns 409, and no silent merge
   occurs (PRD §8).
4. Run all three — confirm they fail before the harness exists.
5. Write `harness.ts` using DynamoDB Local via `docker run -p 8000:8000
   amazon/dynamodb-local`, skipping with a clear message if Docker is absent
   rather than passing vacuously.
6. Run again — confirm green.
7. Verification: paste the output including the property test's case count.

**Acceptance:** all three green; the property test must not be vacuous
(assert it ran ≥ 100 generated cases).
**Standing rules in scope:** rules 1, 2, 3.

---

## Task 13 — CDK app entry wiring *(the declared integration task)*

**Delegation:** controller-owned *(reconciliation only — writes no stack or
handler logic; every stack class it instantiates was authored by Tasks 3, 4,
10 and 11, which were forbidden to touch this file)*
**Files:** `infra/bin/stash.ts`

**Interfaces**
- Consumes: `StashDataStack`, `StashIdentityStack`, `StashApiStack`,
  `StashObservabilityStack` — exactly as each task's Interfaces block
  declares them.
- Produces: a synthesizable CDK app pinned to `env: { region: "ap-south-1" }`.

**Steps**
1. Write `infra/bin/stash.ts` instantiating the four stacks in dependency
   order and passing `table`, `bucket`, `userPool`, `userPoolClient`,
   `httpApi` through as each props interface requires.
2. Run `npx cdk synth` — confirm all four stacks synthesize.
3. Run `npm test` — confirm every task's assertions still pass together.
4. Verification: paste the synth output showing four stack names.

**Acceptance:** `cdk synth` emits four stacks and the full suite is green.

---

## Task 14 — README with SIA attribution badge

**Delegation:** scoped implementer subagent
**Files:** `README.md`

**Interfaces** — consumes nothing; produces the documented entry point.

**Steps**
1. Write `README.md`: what STASH is (from the PRD's Working Product
   Statement only — **invent no features and no claims**), the current scope
   (AWS control-plane foundation), prerequisites (Node 20, AWS CLI v2,
   credentials), and the commands `npm install`, `npm test`, `npm run synth`.
2. Place this badge near the top, preserving any existing badges:
   `[![Powered by SIA — Self-Improving Agents](https://img.shields.io/badge/Powered%20by-SIA%20%E2%80%94%20Self--Improving%20Agents-007BFF?style=flat-square)](https://github.com/GunjanGrunge/SIA_package)`
3. Verification: render the Markdown and confirm the badge resolves and no
   statement in the README lacks a PRD or repository source.

**Acceptance:** badge present and clickable; every claim traceable to the PRD
or the repo.

---

## Task 15 — Deploy runbook

**Delegation:** scoped implementer subagent
**Files:** `docs/deploy-runbook.md`

**Steps**
1. Document, as runnable commands: configuring credentials, verifying with
   `aws sts get-caller-identity`, `npx cdk bootstrap aws://<account>/ap-south-1`,
   `npx cdk diff`, `npx cdk deploy` per stack in dependency order, rollback,
   and teardown (noting that RETAIN removal policies mean the table and
   bucket survive `cdk destroy` **by design** and must be removed manually).
2. State explicitly that each deploy is a High-severity action requiring
   approval immediately before it runs, and that it creates billable
   resources.
3. Verification: every command is copy-pasteable with no placeholder left
   except `<account>`, which is explicitly marked as user-supplied.

**Acceptance:** a reader with credentials can deploy without asking a
follow-up question.

---

## Commit Step

SIA-mediated commits preserve the human author
(`ZmaRk Hacker <stdevilgunjan@gmail.com>`) and append:

```text
Assisted-by: SIA — Self-Improving Agents
SIA-Run: _bmad-output/implementation-artifacts/sdd/task-<N>-report.md
```

Verify the `SIA-Run` path exists before each commit. Never `Co-authored-by`
for SIA, never alter Git identity, never amend prior commits.

---

## Integration Phase *(controller-owned; required before the plan is done)*

Recorded in `sdd/progress.md` per `sia/guides/subagent-task-brief.md`:

1. **Full suite:** `npm test && npm run synth` — paste actual output.
2. **Cross-task interfaces:** confirm in combined code that every Interfaces
   contract matches — `StashDataStack.table`/`.bucket` into
   `StashApiStackProps`; `StashIdentityStack.userPool`/`.userPoolClient` into
   the JWT authorizer; Task 5's exported signatures as consumed by Tasks 6–9;
   `ManifestEntry` shared between Tasks 7 and 8; `StashApiStack.httpApi` into
   Task 11.
3. **Combined diff** reviewed as one unit, not per task.
4. **Standing rules:** per-rule verdict for all 12 project rules against the
   combined diff (respected / violated / not applicable).
5. **Issues only visible once all code coexists** — recorded, not glossed.

**Deployment is separate.** No `cdk deploy` runs as part of this plan's
completion; each apply is its own High-severity approval and is currently
blocked on valid AWS credentials.

---

## Plan Self-Review

- **Spec coverage:** §2 architecture → T2, T13; §3.1 Cognito → T4; §3.2/§3.3
  DynamoDB + S3 → T3; §3.4 API + handlers → T6–T10; §3.5 IAM → T10; §3.6
  observability → T11; §4 data flow → T6–T9, T12; §5 error handling → T6, T8,
  T9, T12; §6 security → T5, T9, T10; §7 testing → every task plus T12.
  **Every spec section maps to at least one task.**
- **Placeholders:** none. Every type, signature, route and assertion is
  named concretely.
- **Interface consistency:** names used downstream (`objectKey`,
  `userIdFromEvent`, `ManifestEntry`, `StashDataStackProps`, `httpApi`)
  match the producing task's Interfaces block exactly.
- **File-ownership overlap:** none, except `infra/bin/stash.ts`, owned
  solely by Task 13 with Tasks 3, 4, 10, 11 explicitly forbidden — the
  dedicated integration task the Owned Files rule requires.
- **Delegation:** all 13 implementation tasks are `scoped implementer
  subagent`; only T13 and the Integration phase are controller-owned, and
  neither writes production logic.
- **Ends with an Integration phase:** yes.
