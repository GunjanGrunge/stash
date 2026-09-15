# F1 — Controller decisions on validator findings

Two validators disagreed on one point and raised two open questions. Resolved
here, with reasoning, rather than silently.

## Q1 — workspaces glob: **widen, do not restructure**

Adopt `["infra", "services/shared", "services/handlers/*"]`. The review
validator's nuance is decisive: the handler package builds *by accident* today,
because its only devDependency is hoisted from `@stash/shared`, which declares
the identical one. So the breakage is latent, not visible — the worst kind.
Restructuring to satisfy a one-level glob would discard the `handlers/`
boundary that per-handler least-privilege IAM depends on.

## Q2 — duplicate `relativePath` within one batch: **reject the whole batch with 400**

The two validators conflict here: the adversarial validator asserted at
`adversarial-hierarchy.test.ts:513-521` that both files are created; the review
validator recommends 400. **The review validator is right, and its reasoning is
what settles it:**

- Rule 3 ("a checksum match is never an identity match") is about **content**.
  Rejecting a duplicate *path* uses no content information, so Rule 3 is
  untouched.
- The invariant actually at stake is **Rule 1**. A real filesystem cannot hold
  two `x.wav` in one folder. Accepting the input materializes a structure that
  is not the creator's — which is the reorganization Rule 1 forbids.
- Every alternative is worse: accept → the first silent reorganization arrives
  later when something must pick one; dedupe → choosing for the creator;
  last-write-wins → an overwrite, and versioning is off (Rule 8).
- It matches the handler's existing, well-tested all-or-nothing posture.

**Consequence:** the adversarial test at `:513-521` asserts the opposite and
must be updated as part of the fix. This is a genuine decision between two
defensible readings, not an oversight by either validator — recorded so it is
not silently re-litigated.

## F-6 severity raised: medium → **high**

The review validator rated it medium. Raising it: `data-stack.ts:31-37` gives
every GSI a sort key, `register-files.ts:146` writes only `gsi3pk`, and
DynamoDB projects an item only when **both** key attributes are present. `gsi3`
would therefore hold **zero items forever, silently** — disabling the checksum
index that PRD §7 duplicate detection is built on. A feature that silently does
nothing in production is worse than one that fails loudly.

**Fix direction:** the handler writes `gsi3sk = FILE#<fileId>` (many files can
share a checksum, so the index needs a sort key for uniqueness). Do **not**
drop the sort key from infra — `infra/lib/data-stack.ts` is Task 3's file and
is already proven by 9 assertions.

## F-2b — idempotency: fix now, do not defer

`register-files.ts:62` consumes `Idempotency-Key` **only as a log correlation
id**. That is worse than not handling it: it *looks* handled. A retried
500-file batch double-writes everything, and retry is guaranteed in this
product (PRD §13 requires resumable transfers over interrupted networks).
