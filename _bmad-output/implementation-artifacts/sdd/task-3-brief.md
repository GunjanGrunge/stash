# Task Brief: StashDataStack (DynamoDB + S3)

Goal: Define the STASH data stack — the single DynamoDB table holding the
logical filesystem, and the S3 bucket holding payloads.

Files (exclusive ownership boundary):
- `infra/lib/data-stack.ts`
- `infra/test/data-stack.test.ts`

**You are forbidden to touch `infra/bin/stash.ts`.** Task 13 owns it and will
instantiate your stack. Creating or editing it is an escalation.

Interfaces — produce EXACTLY:
```ts
export interface StashDataStackProps extends cdk.StackProps {}
export class StashDataStack extends cdk.Stack {
  readonly table: dynamodb.Table;   // construct id "StashTable"
  readonly bucket: s3.Bucket;       // construct id "StashBucket"
  constructor(scope: Construct, id: string, props?: StashDataStackProps);
}
```
Table: partitionKey `pk` (STRING), sortKey `sk` (STRING),
`billingMode: PAY_PER_REQUEST`, `pointInTimeRecovery: true`,
`removalPolicy: RETAIN`. Three GSIs named exactly `gsi1` (`gsi1pk`/`gsi1sk`),
`gsi2` (`gsi2pk`/`gsi2sk`), `gsi3` (`gsi3pk`/`gsi3sk`), all STRING.
Bucket: `encryption: s3.BucketEncryption.S3_MANAGED`, `versioned: false`,
`blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL`, `enforceSSL: true`,
`lifecycleRules: [{ abortIncompleteMultipartUploadAfter: cdk.Duration.days(7) }]`,
`removalPolicy: RETAIN`.

Steps (TDD):
1. Write `infra/test/data-stack.test.ts` using `Template.fromStack` from
   `aws-cdk-lib/assertions`, asserting: the table has three GSIs named
   `gsi1`, `gsi2`, `gsi3`; `BucketEncryption` is AES256;
   `VersioningConfiguration` is ABSENT from the bucket resource;
   `PublicAccessBlockConfiguration` has all four flags true; a lifecycle rule
   exists with `AbortIncompleteMultipartUpload: { DaysAfterInitiation: 7 }`;
   and an `AWS::S3::BucketPolicy` statement denies `s3:*` when
   `aws:SecureTransport` is `"false"`.
2. Run `npx vitest run infra/test/data-stack.test.ts` — confirm it FAILS
   because `../lib/data-stack` cannot be resolved. Record the error.
3. Write `infra/lib/data-stack.ts` to the interface above.
4. Run the test again — confirm every assertion passes.
5. Verification: paste the passing Vitest output.

Acceptance Criteria: all assertions pass. Paste real output.

Effort Budget: 35 tool calls.

Relevant Standing Rules (verbatim):
- Rule 8: S3 versioning is off, so never overwrite an existing key. Assert
  `versioned: false` EXPLICITLY rather than relying on the CDK default — the
  test must prove it, because an accidental overwrite is unrecoverable.
- Rule 11: Every `cdk deploy` or mutating AWS CLI call is High severity and
  needs user approval. **This task never deploys and makes no AWS API call.**
- Rule 12: Never write AWS credentials into the repository or any artifact.

Working directory: `/mnt/c/Users/Bot/Desktop/stash`
Host Evidence: host=claude-code; subagent=stash-task-3-data-stack.

Escalate, do not improvise, when: an unexpected dependency the brief did not mention; a file the brief did not list needing changes; a conflicting or already-modified file; a requirement ambiguous enough to support two different implementations; a missing tool, credential, or piece of environment; a test failing for a reason unrelated to this task; or the Effort Budget exceeded with the task still incomplete. Report status `blocked` with exactly what was found — improvising past any of them is scope creep even when it would probably work.
