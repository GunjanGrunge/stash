# Subagent report - API readiness repair

## Change

Restored the distinction between direct handler tests and deployed Lambda composition. `checkManifest` and `registerFiles` now require an API route parameter and validate the owned open Stash only when the `stashes` lookup is supplied by the Lambda entry point. Thus production calls retain the `{id}` safeguards, while repository-level domain tests intentionally remain route-independent.

The registration route-safety test now supplies that deployed-composition dependency and proves a body/path Stash-ID disagreement returns `400` without writes. The manifest test proves an unknown Stash returns `404` and a closed Stash `409`. The frontend reference now says decimal 1 TB (`1000000000000` bytes) and accurately states that folder-children does not paginate.

## Verification

Verification ran in a newly copied, dependency-clean checkout at `C:\Users\Bot\Desktop\stash-readiness-verify` after `npm ci`.

- `npm test -- --silent --reporter=dot`: pass — 35 files, 419 passed, 1 skipped.
- `npm run typecheck`: exit 0.
- `npm run synth`: exit 0 — 5 stacks synthesized; local API template contains the 14 routes.

Synth produced only the existing warnings: DynamoDB point-in-time-recovery property deprecation, Node.js 20 Lambda runtime deprecation, and CDK cross-stack-reference configuration. No deploy or AWS mutation was run.

## Scope

Changed only the five files allowed by the brief plus this report. No unlisted application files were changed.
