# STASH — AWS Cost Model (private beta: 2 users × 500 GB)

**Date:** 2026-09-15 · **Region:** ap-south-1 (Mumbai) · **Account:** 239280166793
**Prices:** pulled live from the AWS Pricing API on 2026-09-15, not quoted from memory.
Two exceptions are marked ESTIMATE where the API did not return a clean figure.

PRD §18 names the beta's most important commercial output as *"real monthly AWS
cost per active 1 TB-quota STASH user."* This is the model that question will be
measured against.

## Live unit prices (ap-south-1)

| Item | Price | Source |
|---|---|---|
| S3 Standard storage (first 50 TB) | $0.025 / GB-month | Pricing API |
| S3 PUT/COPY/POST/LIST | $0.005 / 1,000 | Pricing API |
| S3 GET and all others | $0.0004 / 1,000 | Pricing API |
| Data transfer OUT to internet (first 10 TB) | $0.1093 / GB | Pricing API |
| DynamoDB write request units | $0.71 / million | Pricing API |
| DynamoDB read request units | $0.1425 / million | Pricing API |
| DynamoDB storage (beyond 25 GB free) | $0.285 / GB-month | Pricing API |
| DynamoDB PITR backup | $0.228 / GB-month | Pricing API |
| Lambda requests | $0.20 / million | Pricing API |
| Lambda duration | $0.0000166667 / GB-s | **ESTIMATE** (published standard rate) |
| API Gateway HTTP API (first 300 M) | $1.05 / million | Pricing API |
| CloudWatch Logs ingest | ~$0.57 / GB | **ESTIMATE** (API returned only vended-log SKUs) |
| Cognito | $0 (50,000 MAU free) | free tier |

## Assumptions (change these and the answer changes)

| Assumption | Value | Why |
|---|---|---|
| Users × quota | 2 × 500 GB = **1,000 GB** | as specified |
| Average object size | **5 MB** | blended. PRD examples run 2.3–3.0 MB (1,847 files / 4.2 GB; 14,291 items / 42.6 GB); video pulls the average up |
| Object count | **~204,800** | derived from the two above |
| Metadata per item | ~800 B → **0.15 GB** | `search_tokens`/`extracted_metadata` are empty today; they will grow this |
| New content per month | **5%** (50 GB) | steady state after initial ingest |
| API calls per month | **100,000** | browse, search, check, register |
| Free tiers applied | 100 GB/month egress (account-wide), 25 GB DynamoDB storage | both currently apply |

## Steady-state month

| Line item | USD |
|---|---|
| S3 Standard storage (1,000 GB) | 25.00 |
| S3 PUT requests (~11,776) | 0.06 |
| S3 GET requests (4,000) | 0.00 |
| DynamoDB storage (0.15 GB, within free tier) | 0.00 |
| DynamoDB PITR backup | 0.03 |
| DynamoDB writes (12,288 WRU) | 0.01 |
| DynamoDB reads (60,000 RRU) | 0.01 |
| Lambda requests (100,000) | 0.02 |
| Lambda duration (12,500 GB-s) | 0.21 |
| API Gateway HTTP (100,000) | 0.11 |
| CloudWatch Logs (~0.5 GB) | 0.28 |
| Cognito (2 MAU) | 0.00 |
| **Subtotal before data transfer out** | **25.73** |

## Data transfer out — the only thing that moves the number

| Scenario | Downloaded | Billable | Egress | **Total/month** | **Per user** |
|---|---|---|---|---|---|
| Light | 50 GB | 0 GB | $0.00 | **$25.73** | **$12.87** |
| Expected | 150 GB | 50 GB | $5.46 | **$31.20** | **$15.60** |
| Heavy | 500 GB | 400 GB | $43.72 | **$69.45** | **$34.73** |

**One-off first-month ingest** of 1,000 GB / 204,800 objects: **$1.34**. Upload
bandwidth into AWS is free; only the request count is billed.

## What this tells you

1. **Storage is 97% of the pre-egress bill.** At beta scale the architecture
   barely matters to cost — the quota does. Every optimisation that is not
   about stored bytes or egress is rounding error.
2. **Egress is the only variable that can double the bill.** It is also the one
   the product most directly controls: the local cache (PRD §10) exists partly
   as an egress-cost optimisation, and every cache hit is a download not paid
   for. Cache hit rate is therefore a cost metric, not just a UX metric.
3. **The 100 GB/month free egress allowance is doing real work here** — it
   absorbs the entire light scenario. It is account-wide, so it will not scale
   with user count: at 10 users it is ~1 GB each.
4. **Request costs are negligible at this scale** and will stay negligible until
   object counts rise by an order of magnitude.
5. **Marginal cost of a 3rd user ≈ $12.50/month** in storage plus their egress.
   Storage cost is close to perfectly linear per GB; nothing here amortises.

## What this model does NOT include

- The desktop client's own distribution/signing costs.
- CloudFront (not used; direct-to-S3 by design — PRD §11).
- NAT gateways, VPC endpoints (serverless design uses none).
- Support plan, or any 12-month new-account free-tier credits.
- Intelligent-Tiering monitoring (~$0.0025/1,000 objects/month ≈ $0.51/month at
  204,800 objects) — not used; S3 Standard was chosen 2026-09-15 partly for this
  reason.
- Cost of a second region, or cross-region replication (explicitly out of scope,
  PRD §14).

## How to verify against reality

Cost-allocation tags `Project=STASH`, `Env=beta`, `CostCenter=stash-beta` are
applied at the CDK App level, so every taggable resource inherits them. Once
deployed, activate those tags in Billing → Cost allocation tags, then group Cost
Explorer by `CostCenter` to compare actual spend against this model. The gap
between the two is the number PRD §18 actually asks for.
