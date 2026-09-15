# Task Report: Shared application IAM role + tagging

Status: **complete**
Host Evidence: subagent=`stash-task-role-iam`, host=claude-code.
Usage: 71,597 subagent tokens, 12 tool uses, 288s.

## What changed
- `infra/lib/app-role-stack.ts` — `StashAppRoleStack`, `public readonly role`
  (`StashAppRole`), props `{ table, bucket, userPoolArn? }`
- `infra/test/app-role-stack.test.ts` — 10 tests
- `infra/bin/stash.ts` — exports `buildApp()`, instantiates both stacks, applies
  five tags at App level

## Permissions granted (audited independently by the controller)
| Actions | Resource scope |
|---|---|
| dynamodb Get/Put/Update/Delete/Query/BatchGet/BatchWrite/TransactWrite/TransactGet/ConditionCheck | table ARN + `/index/*` |
| s3 GetObject/PutObject/AbortMultipartUpload/ListMultipartUploadParts | `<bucket>/users/*` only |
| s3 ListBucket/ListBucketMultipartUploads | bucket ARN, condition `s3:prefix = users/*` |
| logs CreateLogGroup/CreateLogStream/PutLogEvents | `log-group:/aws/lambda/stash-*` |
| cloudwatch:PutMetricData | `*` **with condition `cloudwatch:namespace = STASH`** |
| cognito-idp AdminGetUser/AdminUpdateUserAttributes | supplied `userPoolArn`, **omitted entirely when absent** |

**Deliberately excluded:** `s3:DeleteObject` (versioning is off — a delete is
unrecoverable, Rule 8), `dynamodb:Scan` (every access pattern is keyed),
`DeleteTable`/`UpdateTable`.

## Controller's independent audit (not the subagent's claim)
Parsed the synthesized template directly:
- **20 distinct actions granted.**
- **Dangerous actions present: NONE** — no `s3:DeleteObject`, no
  `dynamodb:Scan`, no `s3:*`/`dynamodb:*`/`iam:*`.
- **Statements with `Resource: "*"`: exactly 1** — `cloudwatch:PutMetricData`,
  carrying `StringEquals {cloudwatch:namespace: STASH}`. That action has no
  resource-level permission in AWS, so a `*` is unavoidable; the condition is
  what bounds it.
- **Tags verified on all three taggable resources** — IAM role, DynamoDB table
  and S3 bucket all carry `Project=STASH`, `Env=beta`, `Component=control-plane`,
  `ManagedBy=CDK`, `CostCenter=stash-beta`. The table and bucket are the two
  that actually drive the bill, so Cost Explorer grouping will work.

## Verification
`npx vitest run` → **15 files, 177 passed, 1 skipped** (167 + 10 new, no
regression). `npm run typecheck` → exit 0. `npm run synth` → succeeds, emits
`StashDataStack` and `StashAppRoleStack`. No deploy, no bootstrap, no AWS API
call; `.env` never read; the real account id appears nowhere in source (the test
uses a `111122223333` fixture).

## Notable: a RED that was a real assertion failure
The second RED was not a missing module but a genuine failure —
`expected [] to include ':log-group:/aws/lambda/stash-*'`. `formatArn` renders
the partition as `{"Ref":"AWS::Partition"}`, so the resource synthesizes as an
`Fn::Join`, not a plain string. The subagent fixed the **test** with a helper
that flattens CFN intrinsics and asserts on the rendered ARN — rather than
weakening the assertion or hard-coding the partition. The scope is still proven.

## Reviewer verdict: **complete** — reviewer: controller

Rules: **AFR-007 respected** — the shared role is the user-directed deviation,
and resource scoping is genuinely the compensating control, verified by audit
rather than asserted. Rule 8 **respected** (no DeleteObject). Rule 11
**respected** — synth only, no AWS mutation. Rule 12 **respected** — `.env`
untouched, no credentials or account id in source.

## Open items before any deploy
1. **Cross-stack reference annotation**
   (`crossStackReferencesDefaultStrong`). Harmless at synth, but strong
   cross-stack refs can lock `StashDataStack` against later changes once
   deployed. Worth a decision before the first apply, not after.
2. `{"Ref":"AWS::Partition"}` in the logs ARN — correct and portable; only worth
   hard-coding to `aws` if a literal is preferred.
3. The `docs/` directory the subagent could not account for was created by the
   **controller** (the cost model), not by it. Correctly flagged rather than
   assumed.
