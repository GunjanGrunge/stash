---
name: stash-aws
description: Use for any AWS work in STASH — CDK stacks, IAM, DynamoDB, S3, Cognito, API Gateway, budgets, deploys, or credentials. Carries the account-safety gates and the resource-level decisions already made.
---

# STASH — AWS Skill

**Authority:** `AGENT.md` outranks this file. Region: **ap-south-1**.
IaC: **AWS CDK v2 (TypeScript)**. No AWS infrastructure MCP server exists in
this environment — provisioning is CDK over AWS CLI v2.

## Account Safety (non-negotiable)

1. **Every `cdk deploy`, `cdk bootstrap`, `cdk destroy`, or mutating AWS CLI
   call is High severity and requires explicit user approval immediately
   before it runs.** Never bundle an apply into a larger approval.
2. `cdk synth` and `cdk diff` are safe and need no approval — they make no
   AWS API call. Prefer them for verification.
3. **Credentials live in `.env` (gitignored) or `~/.aws`.** Never `cat` the
   `.env`, never echo a key, never write one into a file, log, brief or
   report. Load with `set -a; . ./.env; set +a`.
4. Verify access with `aws sts get-caller-identity` — its output is safe to
   show. As of 2026-09-15 the stored credentials fail with
   `InvalidClientTokenId`, so deploys are blocked until refreshed.
5. Never run `npm audit fix` or otherwise move pinned versions to resolve an
   advisory without raising it first.

## Resource Decisions Already Made (2026-09-15 — do not re-litigate)

| Resource | Decision | Why |
|---|---|---|
| S3 encryption | SSE-S3 | KMS per-request charges would distort the beta's cost measurement |
| S3 versioning | **off** | cheapest; consequence: **never overwrite a key** — every Stash writes a new `file_id` |
| S3 storage class | Standard | Intelligent-Tiering's per-object monitoring fee is punitive at 14,291-small-sample scale |
| S3 lifecycle | abort incomplete MPU after 7 days | dead uploads otherwise bill silently |
| DynamoDB | on-demand | 2 beta users cannot justify provisioned capacity |
| Removal policy | RETAIN on table + bucket | `cdk destroy` must not delete a creator's library |
| Cognito | SRP, no client secret, MFA optional, self sign-up off | a desktop binary cannot hold a secret safely |
| API | HTTP API + JWT authorizer | lower cost per request than REST API |

## IAM Rules, Enforced By Tests Not Review

- One execution role per handler. Never a shared "lambda-role".
- **No statement may use `Resource: "*"`** — asserted in
  `infra/test/api-stack.test.ts`; a wildcard fails the build.
- The presign role's `s3:PutObject` is scoped to `.../users/*` only.
- Read handlers get no write actions (`grantReadData`, never
  `grantFullAccess`).
- **Every route must carry the JWT authorizer** — a route without one fails
  the build, not the review.

## Cost Telemetry Is A Deliverable

The beta's most important commercial output is *real monthly AWS cost per
active 1 TB user*. So: explicit log-group retention (absent = infinite =
silent cost), AWS Budgets alerts at 80% and 100%, and cost-allocation tags
`Project=STASH`, `Env=beta`.
