# F1 — Validation & Rules Review

**Reviewer role:** review validator (read-only over source/tests)
**Date:** 2026-09-15
**Scope reviewed:** `services/shared/src/*.ts`, `services/shared/test/*.ts`,
`services/handlers/files/src/*.ts`, `services/handlers/files/test/*.ts`,
`infra/lib/data-stack.ts`, `infra/test/data-stack.test.ts`
**Authorities applied:** `AGENT.md` §2 (12 rules) + §4 (AFR-001/002/003),
`skills/stash-backend/SKILL.md` (7 security + 5 correctness invariants),
`skills/stash-architecture/SKILL.md`, `sia/guides/security-gate.md`,
`sia/guides/questioning-and-approval.md` (severity table).

**Observed suite state (run, not claimed):** first pass — `npx vitest run` →
`Test Files 8 passed (8)`, `Tests 45 passed | 1 skipped (46)`, 11.38s.
**A ninth test file, `services/handlers/files/test/adversarial-hierarchy.test.ts`,
appeared mid-review (concurrent authoring) and is RED — 2 of its 18 tests fail.
See the Addendum at the end; it changes the verdict.**

---

## 1. Per-Rule Verdict Table

### AGENT.md §2 — Project Rules

| # | Rule | Verdict | Evidence |
|---|---|---|---|
| 1 | Never reorganize a user's library; `original_relative_path` preserved verbatim | **respected (code) / violated in effect (cross-batch)** | `services/shared/src/paths.ts:15-62` validates and returns the input byte-identically with an explicit no-normalize comment at :61; proven at `services/shared/test/paths.test.ts:64-98` (NFD preserved at :89-94, CJK+emoji at :72-78, leading/trailing spaces at :80-87) and `services/handlers/files/src/register-files.ts:135` (`originalRelativePath: input.relativePath`). **However**, `register-files.ts:95` scopes the folder-dedupe `Map` to a single invocation, so a second batch into an existing folder creates a *duplicate* folder node — see Finding F-1. The stored path strings stay byte-identical; the reconstructed *tree* does not. |
| 2 | File, Folder and Stash are three different concepts | **respected** | `services/handlers/files/src/types.ts:15-26` (`FolderRecord`) and `:28-53` (`FileRecord`) are separate shapes with separate `sk` prefixes (`register-files.ts:112` `FOLDER#`, `:129` `FILE#`); `stashId` is an attribute + `gsi2pk` (`:132`, `:144`), never a substitute for `parentFolderId` (`:134`). Nothing collapses the three. Caveat (not a Rule-2 violation): no `STASH#` entity is written and `stashId` is accepted unvalidated — Finding F-4. |
| 3 | A checksum match is never an identity match | **respected** | `register-files.ts:126` mints a fresh `randomUUID()` per input entry and `:138` derives the key from that id; `checksum` only reaches the detection index `gsi3pk` at `:146`. `types.ts:51` documents it as "DETECTION only". Nothing in the diff branches on checksum. Empirically: the property test registers ~all files with `checksum: "sum"` (`hierarchy-property.test.ts:157`) and every one becomes a distinct file with a distinct key (asserted `:170-174`). No dedicated two-identical-checksums test exists — see Finding F-7 (coverage). |
| 4 | Never mark something Stashed that is not verified committed | **respected** | `register-files.ts:139` writes `state: "pending"` and nothing in the diff writes `"committed"` (`grep` of the diff: `committed` appears only as a union member at `types.ts:42` and in comments). The commit transition is out of F1's scope; F1 correctly does not anticipate it. |
| 5 | No LLM in the product runtime | **respected** | No model client, prompt string, HTTP call or SDK import exists anywhere in the reviewed files. Only imports are `node:crypto`, `aws-lambda` types, `aws-cdk-lib`, `constructs` and intra-repo modules. Tokenization fields are deliberately inert: `register-files.ts:140-141` `searchTokens: []`, `extractedMetadata: {}`, documented as reserved at `types.ts:43-46`. |
| 6 | S3 keys are `users/<user_id>/<file_id>`, opaque IDs only | **respected** | `services/shared/src/keys.ts:8-12` constructs exactly that and `:16-23` rejects any non-opaque id (regex `/^[A-Za-z0-9._-]+$/` at `:14`, explicit `.`/`..` rejection at `:20`). Only call site is `register-files.ts:138`, passing the JWT sub and a server-minted UUID — no creator string can reach it. Proven negatively at `services/shared/test/keys.test.ts:9-25` (no filename fragment, exactly two slashes) and `register-files.test.ts:84-102`, and across 200 random trees at `hierarchy-property.test.ts:170-174`. This is the strongest-evidenced rule in the diff. |
| 7 | `user_id` only from verified JWT claims | **respected** | `services/shared/src/claims.ts:16-24` reads `requestContext.authorizer.jwt.claims.sub` and nothing else; 401 on absent/blank. Both handlers use it as the sole source (`register-files.ts:61`, `list-children.ts:29`) and the pk is derived from it (`register-files.ts:94`). Body `user_id`/`userId` are never read — `parseBody` output is consulted only for `stashId` and `files` (`:65,:70`). Tested at `claims.test.ts:54-73` (body, query string, path param all ignored) and `register-files.test.ts:120-134` (`expect(JSON.stringify(item)).not.toContain("attacker")`). |
| 8 | S3 versioning off → never overwrite an existing key | **respected, with a residual gap** | `infra/lib/data-stack.ts:45` `versioned: false` with the rationale at `:41-42`; asserted two ways at `infra/test/data-stack.test.ts:79-90` (property absent *and* `Match.absent()`). Every write path mints a new `fileId` (`register-files.ts:126`), so no key is reusable. Gap: `putEntities` (`memory-repository.ts:8-10`, port at `repository.ts:8`) carries no `attribute_not_exists` condition, so the port does not *structurally* forbid an overwrite for the future DynamoDB implementation. UUID collision risk is negligible; flagged as low (Finding F-6). |
| 9 | Payload bytes never transit Lambda or API Gateway | **respected** | `registerFiles` accepts only `relativePath`, `sizeBytes`, `checksum` (`register-files.ts:76-91`) — metadata only. No body field carries content, no base64 decode, no S3 PutObject anywhere in the diff. `listChildren` returns records only. |
| 10 | STASH vocabulary in user-facing text | **not applicable to what this diff touches** | The diff contains no user-facing copy: no UI, no labels, no client strings. The only externally visible strings are API error messages (`errors.ts:22-35`, `paths.ts:18-57`) which are developer/protocol-facing, use no branded generic nouns, and do not brand Files/Folders/Search/Settings/Devices. Nothing in the diff mis-brands a generic concept. |
| 11 | Every `cdk deploy`/mutating AWS CLI call is High severity | **respected** | No deploy occurred and none is invocable from this diff: `infra/test/data-stack.test.ts:6-10` uses `Template.fromStack` (pure in-process synthesis, no credentials, no network). There is no `infra/bin/stash.ts` app entry point and `npm run synth` fails outright (see Finding F-5), so the stack cannot currently be deployed even accidentally. |
| 12 | Never write AWS credentials into the repo/logs/briefs | **respected** | No credential, ARN, account id, endpoint or key literal in any reviewed file. `services/shared/src/logger.ts:12-20` emits only `level`, `correlation_id`, `msg` and explicitly caller-supplied fields; the sole call site passes two integers (`register-files.ts:152-155`). No event, header map or body is ever logged, so an `Authorization` header cannot leak through the logger. The correlation id derives from the `Idempotency-Key` header (`:62`) — client-chosen, not a secret. |

### Inherited Non-Negotiables (AGENT.md §2 tail)

| Rule | Verdict | Evidence |
|---|---|---|
| 1 — never assume on a non-trivial decision | **partially violated** | Two non-trivial semantic decisions were made silently rather than surfaced: accepting duplicate `relativePath` within one batch as two files (Finding F-2), and rejecting every path containing `\` (`paths.ts:39-41`), which silently makes a legal POSIX filename such as `AC\DC/hells.wav` a 400 — verified: `400 {"code":"bad_request","message":"original_relative_path must use / as the separator"}`. Neither is recorded as an option-with-trade-offs anywhere in the diff or its comments. |
| 2 — never delete/restructure on own initiative | **respected** | Nothing in the diff deletes or restructures existing artifacts; `RemovalPolicy.RETAIN` on both data resources (`data-stack.ts:27,:51`) is the conservative choice and is tested (`data-stack.test.ts:26-31,:116-121`). |
| 3 — never declare a stage done prematurely | **at risk** | F1's claim is broader than the evidence (see §5). The DynamoDB-Local suite is honest about this (`dynamodb-local.test.ts:43-47`), which is good practice; the risk is in how the claim is worded upstream, not in the test file. |
| 4 — surface design decisions as options | **partially violated** | Same two decisions as row 1. |

### AGENT.md §4 — Accumulated Feedback Rules

| AFR | Verdict | Evidence |
|---|---|---|
| **AFR-001** — BMAD drives artifacts, SIA supplies the gates; implementation by scoped subagents, never the controller | **respected as far as the code diff can show** | The code lands under the SIA-writable trees `services/` and `infra/` (AGENT.md §10), and this review artifact lands under `_bmad-output/implementation-artifacts/sdd/` as §7 requires. Nothing in the diff touches `_bmad/`, `.claude/skills/bmad-*`, `.agent/`, `.agents/` or `.github/agents/`. Whether the *controller* wrote these files rather than a subagent is not determinable from the diff — it must be checked against the task's host-dispatch record, and is outside this reviewer's read scope. |
| **AFR-002** — a brief must not pin a tool's config exhaustively *and* assert an exit code without verifying real exit semantics | **respected — and the exact recurrence was avoided** | The historical failure was Vitest 2 exiting 1 on "No test files found" because `passWithNoTests` was omitted from an exhaustive config block. `vitest.config.ts` still specifies only `include`/`exclude`/`environment` and still has no `passWithNoTests` — **but the mistake no longer bites**, because real test files now exist and `npx vitest run` exits 0 with `8 passed / 45 tests`. The condition that made the config lethal is gone. Note the latent form: if all test files were ever excluded or moved, the same red-exit trap returns unannounced. |
| **AFR-003** — `uisamples/` mockups are a design idea, not a requirements source | **not applicable to what this diff touches** | This is a backend/infra diff with zero UI surface. No file in the reviewed set references `uisamples/`, derives a field, label, screen or acceptance criterion from a mockup, or introduces client UI work. The rule is live but unengaged here. |
| **AFR-R01** (retired) | **n/a** | Retired and superseded by AFR-001; correctly not applied. |

### stash-backend Invariants — separate pass

| Invariant | Verdict |
|---|---|
| S1 `user_id` from verified claims, tested explicitly | respected (`claims.ts`, `claims.test.ts:54-73`) |
| S2 creator paths never in an S3 key | respected (`keys.ts`, `keys.test.ts:9-25`) |
| S3 validate client paths, accept byte-identically | respected (`paths.ts:15-62`); backslash rejection is stricter than the invariant's list — Finding F-8 (low) |
| S4 parameterized DynamoDB expressions only | respected vacuously — no DynamoDB expression exists yet (`repository.ts` is a 2-method port). See §2 security gate. |
| S5 cross-tenant returns 404, not 403 | **deviation**: verified behaviour is `200 {"parentFolderId":"<other user's id>","items":[]}` — Finding F-3 |
| S6 no secrets in code/logs/errors | respected (`logger.ts:12-20`) |
| S7 no LLM call | respected |
| C1 nothing Stashed until verified | respected (out of scope, correctly not pre-empted) |
| C2 quota enforced server-side, 507 | **not implemented** — `sizeBytes` is validated (`register-files.ts:82-85`) then never summed or checked. Out of F1's stated scope, but the batch write is unbounded — Finding F-9 |
| C3 mutating batch ops idempotent on `Idempotency-Key` | **violated** — Finding F-2b |
| C4 concurrency via conditional writes on `version`, 409 | **not implemented** — no `version` attribute on either record (`types.ts:15-53`); out of F1 scope, noted for the next slice |
| C5 checksum match ≠ identity match | respected (Rule 3 above) |

---

## 2. Security Gate (`sia/guides/security-gate.md`)

| Threat class | Applicable here? | Verdict + evidence |
|---|---|---|
| **XSS / JS injection** | **Not applicable at this layer.** No DOM, no `innerHTML`, no `eval`, no HTML/template rendering exists in the diff — these are Lambda handlers returning `JSON.stringify` bodies and a CDK stack. | n/a. One forward-looking note: `list-children.ts:36-39` serializes raw creator-controlled strings (`name`, `originalRelativePath`) into a JSON response. That is correct for JSON, but the eventual client MUST treat these as text, never as markup — a creator can legally name a folder `<img src=x onerror=...>` because Rule 1 forbids sanitizing it. This is the right place for the escaping burden to land on the consumer, and it should be recorded as a client-side requirement. |
| **SQL / NoSQL / expression / command injection** | **Applicable, and clean.** | *Expression injection:* no DynamoDB expression string is built anywhere in the diff — `repository.ts:7-13` exposes only `putEntities` and `listChildren(userId, parentFolderId)`, and `memory-repository.ts:16-20` compares composed key strings with `===`, never interpolating into a query language. Key composition (`register-files.ts:94,118,142,144,146`, `memory-repository.ts:16-17`) does embed user-controlled data (`userId`, `stashId`, `checksum`, `folderId`) into `#`-delimited strings; that is a *key-namespace* concern, not an injection one, and `userId` is a Cognito sub while `folderId` is a server UUID. Residual note: `stashId` and `checksum` are arbitrary non-empty strings (`register-files.ts:66,:87`) and can contain `#`, so a crafted `stashId` of `x#SUM#y` produces a `gsi2pk` that collides in shape with a `gsi3pk` — the indexes are distinct, so no cross-read occurs, but `stashId`/`checksum` deserve a charset constraint (Finding F-10, low). *Command injection:* the only child process is `execFileSync` in `dynamodb-local.test.ts:18` with a constant command and a constant literal argv (`"docker"/["info"]`, `"java"/["-version"]`) — `execFileSync`, not `exec`, so no shell is spawned and no user input reaches it. Clean. |
| **Prompt injection / jailbreak patterns** | **Not applicable.** | There is no LLM in any runtime path (Rule 5, verified above), so there is no prompt to inject into. Creator paths are stored and returned as opaque data and never placed in any model context. |
| **Hard-coded secrets** | **Applicable, and clean.** | No key, token, password, account id, ARN, endpoint or `.env` read anywhere in the reviewed files. Test fixtures use obvious placeholders (`accountId: "123456789012"`, `claims.test.ts:15`). The logger cannot exfiltrate one (`logger.ts:12-20` emits only caller-named fields; the sole call site passes two counts, `register-files.ts:152-155`). Related "missing auth check" sub-class: **auth is present and enforced first in both handlers** — `register-files.ts:61` and `list-children.ts:29` call `userIdFromEvent` before any parsing or repository access, so an unauthenticated request cannot even reach `parseBody`. `register-files.test.ts:136-143` proves the 401 path writes nothing (`expect(repo.all()).toHaveLength(0)`). Transport security at rest/in flight is enforced in infra: `enforceSSL: true` + `BLOCK_ALL` public access (`data-stack.ts:46-47`), tested at `data-stack.test.ts:92-101,:123-135`. CORS is not configured anywhere in the diff — the API stack does not exist yet, so this is deferred, not missing. |
| **Unescaped LLM output rendered to a user** | **Not applicable.** | No LLM output exists to render (Rule 5). |

**Security gate result: PASS.** No finding of any of the five classes. Two forward-looking notes recorded (client-side escaping of creator-controlled names; charset constraint on `stashId`/`checksum`), neither of which is a gate failure at this layer.

---

## 3. Findings

Severity per `sia/guides/questioning-and-approval.md`. All findings were
reproduced by executing the code, not inferred from reading it.

### F-1 — Folder identity is per-request, so a second batch duplicates the folder tree — **medium (high if F1 is signed off as "hierarchy preserved")**

`services/handlers/files/src/register-files.ts:95` creates
`const folders = new Map<string, FolderRecord>()` *inside* the handler
invocation, and `:108-121` mints a brand-new `folderId` whenever the prefix is
absent from that per-request map. Nothing consults the repository for an
existing folder at the same `(pk, parentFolderId, name)`, and
`memory-repository.ts:8-10` / `repository.ts:8` blindly append.

**Failure scenario (reproduced):**
1. `POST /files` `{stashId:"s1", files:[{relativePath:"Samples/Drums/kick.wav"}]}` → 201
2. `POST /files` `{stashId:"s2", files:[{relativePath:"Samples/Drums/snare.wav"}]}` → 201
3. `GET` ROOT children →
   `ROOT children: [ 'FOLDER:Samples', 'FOLDER:Samples' ]`, total folder records `4`.

The creator sees **two identically-named `Samples` folders**, each containing
its own `Drums`, each containing one file. Their filesystem contains one.
Reconstructing the tree by walking `listChildren` still yields the correct set
of byte-identical *path strings*, which is why the property test passes — but
the *shape* of the hierarchy is wrong, and this is the exact user-visible
outcome Rule 1 exists to prevent. Ingestion is inherently incremental (one
Stash = one ingestion event, PRD §4.2), so the second batch is the normal case,
not an edge case.

**Why no test catches it:** `hierarchy-property.test.ts:148-160` constructs a
fresh `MemoryRepository` and issues exactly **one** `registerFiles` call per
case, across all 200 cases. Every other test does the same
(`register-files.test.ts`, `list-children.test.ts:25-36` `seed()` — note
`list-children.test.ts:74-82` calls `seed` twice but with *different* users, so
it exercises tenancy, not folder reuse). Single-batch is a universal invariant
of the entire test suite, and the defect lives exactly in its blind spot.

**This is a repeat of a known mistake class, not just a bug:** it is the same
`unverified-claim` error class recorded in AFR-003 — a property proven under one
narrow condition (single batch, fresh repository) presented as proof of the
general claim ("folder hierarchy preserved"). 200 randomized cases look like
broad coverage while varying only the dimension that was already safe.

### F-2 — Duplicate `relativePath` inside one batch silently creates two files at one path — **medium**

`register-files.ts:76-91` (phase 1) validates each entry independently and
`:98-148` (phase 2) mints a UUID per entry with no cross-entry uniqueness check.

**Reproduced:** `{files:[{relativePath:"A/x.wav",checksum:"a"},{relativePath:"A/x.wav",checksum:"b"}]}`
→ `201 {"fileIds":["ccb34d72-…","c6eea545-…"]}`, and listing folder `A` returns
`[ 'x.wav', 'x.wav' ]`. Two files, one path, one folder. See §4 Q2 for the
recommendation.

### F-2b — `registerFiles` is not idempotent, and the `Idempotency-Key` is quietly repurposed as a log correlation id — **medium**

`skills/stash-backend/SKILL.md` correctness invariant C3 requires mutating
batch operations to be idempotent on `Idempotency-Key`, with a replay returning
the original result rather than double-writing. `registerFiles` is a mutating
batch operation. `register-files.ts:62` reads the header — and uses it only as
the logger's correlation id:
`const log = logger(idempotencyKeyFromEvent(event) ?? randomUUID());`
The key never reaches a conditional write, a dedupe record, or a replay lookup.

**Failure scenario:** the desktop client POSTs a 500-file batch, the response is
lost to a network timeout, the client retries with the *same* `Idempotency-Key`
as designed → 1000 file records, 2× folder records (compounding F-1), and the
creator's library shows every file twice. The retry is the client doing exactly
the right thing.

This is the more dangerous half of the finding: the header *is* consumed, so a
reader (or a reviewer skimming for `idempotencyKeyFromEvent`) sees the shared-
library helper imported and used and concludes idempotency is handled. It is
not. Also note the TDD contract in `stash-backend/SKILL.md` names "idempotent
replay" as a *mandatory* per-handler unit test; there is no such test in
`services/handlers/files/test/`.

### F-3 — Cross-tenant and unknown folder ids return `200 []`, not `404` — **low**

`stash-backend` security invariant S5: "Cross-tenant requests return 404, not
403. Existence is not disclosed." `list-children.ts:32-40` returns 200 with an
empty `items` array for any `folderId` that yields no rows.

**Reproduced:** user `u2` requesting user `u1`'s real `folderId` →
`200 {"parentFolderId":"004fc195-…","items":[]}`.

No information leaks (an empty result is indistinguishable from a real empty
folder, and the `gsi1pk` construction at `memory-repository.ts:17` makes the
other tenant's rows genuinely unaddressable — the architecture invariant holds).
But it is a literal deviation from S5, it makes "folder does not exist"
indistinguishable from "folder is empty" for the *legitimate* owner, and note
the response echoes the attacker-supplied `folderId` back at
`list-children.ts:37`. Low, but it should be a deliberate recorded decision
rather than an omission.

### F-4 — `stashId` is accepted unvalidated and no `STASH#` entity exists — **low (medium for the next slice)**

`register-files.ts:65-68` accepts any non-empty string as `stashId` and stamps
it onto every file (`:132`, `:144`). No `STASH#` record is written, the Stash
state machine (`open → completed | cancelled`, `stash-architecture/SKILL.md`) is
not consulted, and no quota reservation is checked. A client can register files
against a `stashId` that was never opened, or against one already `cancelled`.
Correct scoping for F1 (the Stash entity is a later task), but the handler
currently accepts input it cannot honour, so the gap must be explicitly carried
forward rather than assumed closed.

### F-5 — `infra` is not a workspace, `npm run synth` fails, and `npm run typecheck` never type-checks anything — **medium**

Verified:
- `npm ls --workspaces --depth=0` resolves exactly one workspace: `@stash/shared -> ./services/shared`.
- `npm run synth` → `npm error No workspaces found: --workspace=infra`. `infra/` contains only `lib/` and `test/` — **there is no `infra/package.json` and no `infra/bin/stash.ts`**, though `stash-architecture/SKILL.md` names `infra/bin/stash.ts` as the only file that instantiates stacks. `StashDataStack` is therefore never instantiated in any CDK app; it exists only inside the unit test's `new cdk.App()` (`data-stack.test.ts:7-9`).
- `npx tsc -b` → `error TS5083: Cannot read file '.../tsconfig.json'`. Only `tsconfig.base.json` exists; no project references it. **No file in this diff is ever type-checked.** `strict` and `noUncheckedIndexedAccess` are declared in `tsconfig.base.json:3,:9` and never applied, and Vitest transpiles without type checking — so the repo's two headline quality scripts, `typecheck` and `synth`, are both broken while `test` is green.

This is the same shape as AFR-002: a declared tool configuration whose real
invocation semantics were never executed end-to-end. AFR-002's letter was
respected (see the AFR table); its *spirit* — verify the command you claim
works — was not extended to `typecheck` and `synth`.

### F-6 — `gsi3` is declared with a sort key the writer never populates, so the checksum index will be empty in real DynamoDB — **medium**

`infra/lib/data-stack.ts:30-39` builds all three GSIs from the same loop, giving
each a **sort key**: `gsi${n}sk` (`:37`). `infra/test/data-stack.test.ts:51-64`
duly asserts a `gsi3sk` attribute definition exists.

But `register-files.ts:146` writes **only `gsi3pk`** — `FileRecord`
(`types.ts:52`) declares no `gsi3sk` at all, and `FolderRecord` declares neither
`gsi2*` nor `gsi3*`.

**Failure scenario:** DynamoDB only projects an item into a GSI when it carries
**every** key attribute of that index. With `gsi3sk` absent from every `FILE`
item, `gsi3` will contain **zero items** in production. The first checksum
lookup written against it returns empty, and — because Rule 3 forbids acting on
a checksum match — the failure is silent: nothing breaks loudly, duplicate
*detection* simply never fires. Neither the infra test (which only inspects the
template) nor the handler tests (which use an in-memory repo that ignores GSI
key completeness, `memory-repository.ts:18-20`) can catch this. The two halves
of the diff disagree, and the seam between them is exactly where the integration
phase in AGENT.md §7 is supposed to look.

Fix direction (not applied): either give `gsi3` no sort key, or write a
`gsi3sk` (e.g. `FILE#<fileId>`, mirroring `gsi2sk` at `:145`).

### F-7 — Rule 3 has no dedicated test — **low**

Rule 3 is the one product rule with no test that names it. The property test
incidentally proves it (200 trees, all files sharing `checksum: "sum"`, each
getting a distinct `fileId` and key), but a rule this load-bearing deserves an
explicit `it("two files with an identical checksum stay two assets with two keys")`.

### F-8 — Every path containing `\` is rejected, including legal POSIX filenames — **low**

`paths.ts:39-41` rejects any path containing a backslash. `stash-backend` S3
lists exactly what to reject: absolute paths, `..`, NUL, >1024 total, >255 per
segment — a backslash is not on that list, and on macOS/Linux `\` is a perfectly
legal filename character. Verified: `AC\DC/hells.wav` → 400. Rule 1 is not
violated (it rejects rather than rewrites — the right failure direction), but
a creator with an `AC\DC` folder cannot Stash it at all. This is a real product
decision that was made silently; it should be surfaced as a choice.

### F-9 — No quota enforcement on an unbounded batch — **low for F1, must not be forgotten**

`sizeBytes` is validated (`register-files.ts:82-85`) and stored (`:136`) but
never summed or checked against a quota; `files` has no maximum length
(`:71-73`). A single request may register unlimited entries. Out of F1's stated
scope (invariant C2 belongs with the Stash/quota slice), but the write is
currently unbounded in both count and declared bytes.

### F-10 — `stashId` and `checksum` have no charset constraint and are embedded in composite index keys — **low**

`register-files.ts:66,:87` accept any non-empty string; `:144` and `:146`
interpolate them into `gsi2pk`/`gsi3pk`. A `stashId` containing `#` produces
ambiguous key namespaces (no cross-index read results, since the indexes are
separate — hence low). Constrain both to an opaque charset, as `keys.ts:14`
already does for ids.

### What is genuinely good, and why

Stating this precisely rather than as praise:
- **Rule 6 is not merely implemented, it is proven negatively.** `keys.test.ts:9-25` asserts the *absence* of seven filename fragments and counts slashes; `hierarchy-property.test.ts:170-174` re-asserts opacity on every file of every one of 200 random trees. A test that asserts what must not appear is much stronger than one asserting what must.
- **Validation is whole-batch-before-any-write.** `register-files.ts:76-91` completes entirely before `:98` begins building records, and `:151` is the single write. `register-files.test.ts:104-118` proves a bad path in the *middle* of a batch leaves `repo.all()` at length 0 — partial acceptance is genuinely impossible, not just discouraged.
- **The byte-identity tests test the right thing.** `hierarchy-property.test.ts:132,:165-167` compares **hex encodings** of the paths, not the strings — so a normalization that JavaScript's `===` would forgive still fails. `paths.test.ts:89-94` explicitly asserts NFD survives (`expect(out).not.toBe(nfd.normalize("NFC"))`), which is the single most likely way a creator's library gets silently corrupted on a macOS→cloud round trip. This is the diff's best work.
- **The unrunnable test is honest.** `dynamodb-local.test.ts:41-58` detects the missing prerequisites, prints the specific missing one, and states in the skip reason itself that the round trip "is NOT proven against real DynamoDB in this environment". It refuses to be mistaken for evidence. That is exactly right, and it is the opposite of the failure AFR-003 records.

---

## 4. Two Open Questions — Reasoned Recommendations

### Q1 — Root `workspaces` glob `"services/*"` does not match `services/handlers/files`

**Verified facts.** `npm ls --workspaces --depth=0` resolves one workspace:
`@stash/shared -> ./services/shared`. `services/handlers/files/package.json`
(`@stash/handlers-files`) is **not** a workspace; neither is `services/handlers`,
which has no `package.json`. `infra` is listed in `workspaces` but has no
`package.json` at all, so `npm run synth` fails with `No workspaces found`.

Note a nuance the question understates: the handler's only devDependency,
`@types/aws-lambda@^8.10.145`, *is* present in root `node_modules` (8.10.163) —
hoisted from `@stash/shared`, which declares the identical dependency. So the
handlers currently build **by accident**. The day `@stash/shared` drops that
dependency, the handler package silently loses its types with no signal. The
brokenness is latent, not visible, which is worse than a hard failure.

**Recommendation: widen the glob and add the missing `infra/package.json` — do
not restructure.**

```
"workspaces": ["infra", "services/shared", "services/handlers/*"]
```

Reasoning:
- **Do not restructure.** Flattening `services/handlers/files` → `services/files` would work, but it discards a boundary the architecture skill relies on: `StashApiStack` "handlers" are per-handler with per-handler IAM roles, and the `handlers/` directory is where the "never share one role across handlers" rule becomes visible in the tree. Restructuring to satisfy a glob is the tail wagging the dog, and AGENT.md inherited rule 2 forbids restructuring on a reviewer's or implementer's own initiative anyway.
- **Prefer explicit segments over `services/**`.** npm workspace globs are one-level; `services/*` will never match a grandchild. Listing `services/shared` and `services/handlers/*` is explicit, survives the next handler being added (`services/handlers/stashes`, `services/handlers/search`), and does not accidentally enrol a future non-package directory.
- **`infra` must get a real `package.json` regardless** — it is already declared a workspace and already fails. While doing so, add `infra/bin/stash.ts`, since the architecture skill names it as the only legal stack-instantiation site and it does not exist (F-5).
- **Fix `typecheck` in the same change.** A `tsconfig.json` with project references per workspace turns the currently-silent `TS5083` into a real gate. Otherwise the workspace fix improves dependency hygiene while type errors still ship unchecked.

Severity for the controller: **medium** (build/config, no data or auth impact, fully reversible). The change is mechanical; the judgement is only about *not* restructuring.

### Q2 — Two identical `relativePath` values in one `registerFiles` batch

**Verified current behaviour:** accepted, `201`, two `fileId`s, and folder `A`
then lists `[ 'x.wav', 'x.wav' ]`.

**Recommendation: reject an exact duplicate `relativePath` within a single batch
with `400`, rejecting the whole batch and writing nothing.**

The argument, and why Rule 3 does not block it:

1. **Rule 3 is about content, not paths.** It says *a checksum match is never an identity match* — two files with identical bytes at two different paths stay two assets. It protects the creator from dedupe-by-hash silently collapsing their library. Rejecting a duplicate **path** is the opposite operation: it is a statement about the *namespace*, using no content information whatsoever. Rule 3 is untouched, and the two rules are fully compatible — a batch containing the same bytes at `A/x.wav` and `B/x.wav` must still produce two files with two keys, and under this recommendation it does.

2. **The invariant being protected is Rule 1, not Rule 3.** Rule 1 says never reorganize the creator's library and preserve their structure exactly. A real filesystem *cannot* contain two entries named `x.wav` in folder `A`. Accepting the batch therefore materializes a hierarchy the creator's disk cannot have produced — a structure that is not theirs. Preserving fidelity means preserving impossibility too: a shape the source filesystem forbids should not be representable in the mirror.

3. **The alternative outcomes are all worse.** Accepting it means the drive shows two `x.wav` in one folder, and any future mount, sync or "open file" action must pick one arbitrarily — the first silent reorganization in the system, arriving through the back door. Silently de-duplicating to one file would be an actual Rule 1 violation (choosing for the creator). Last-write-wins would be a Rule 8-flavoured overwrite. A `400` is the only option that neither invents structure nor discards data.

4. **A duplicate path in one batch is a client bug, and a loud one.** The batch describes a single scan of a single tree. Two identical paths in it means the client double-enumerated, or concatenated two scans. Failing fast tells the client author immediately; accepting it writes corruption that surfaces weeks later as a mystery duplicate in someone's library. This is also consistent with the handler's existing and well-tested posture: whole-batch validation, all-or-nothing, 400 with nothing written (`register-files.ts:75-91`, `register-files.test.ts:104-118`) — the check belongs in phase 1 alongside the others, as one `Set<string>` of exact byte-strings.

5. **Comparison must be exact bytes.** Duplicate detection must use the raw string (or its hex/UTF-8 bytes), never a case-folded or Unicode-normalized comparison. `Café` (NFC) and `Café` (NFD) are *different* paths under Rule 1 and both must be accepted — `NAME_POOL` at `hierarchy-property.test.ts:46-47` deliberately carries both forms, so this is already an exercised case and must not regress.

**Scope boundary the controller should note:** this recommendation covers
duplicates *within one batch* only. The *cross-batch* case is F-1 and is a
different and more serious problem — it needs folder identity to become a
repository lookup or a conditional write, not a per-request `Map`. Fixing Q2
alone will make the system look consistent while F-1 still duplicates the tree
across successive Stashes; the two should be decided together.

Severity for the controller: **medium** (an API contract change — an input that
returns 201 today would return 400 — which the severity table puts at "alter an
API shape": flag and batch, not silent).

---

## 5. Verdict

### `complete with findings` - **superseded to `blocked` by the Addendum below**

The diff is competent, deliberate work. Rules 5, 6, 7, 9 and 12 are respected
with genuinely strong evidence — Rule 6 in particular is proven by
absence-assertions across 200 randomized trees, and the NFD/hex-comparison
discipline in `paths.test.ts` and `hierarchy-property.test.ts` shows the author
understood *how* byte-identity actually fails rather than just asserting it. The
whole-batch-validate-then-write structure is correct and properly tested. The
skipped DynamoDB-Local suite is honest about what it does not prove, which is
rarer and more valuable than a passing test.

It is not `blocked`: nothing here is unsafe, no tenancy or auth defect exists,
the security gate passes cleanly, and 45 tests genuinely pass. It is not
`complete`: six findings are real, two of them (F-1, F-6) would produce
user-visible or silently-wrong behaviour in production.

### Is F1's claim proven?

**"Keys opaque" — YES, proven.** The strongest-evidenced claim in the diff
(`keys.ts:8-23`, `keys.test.ts:9-32`, `register-files.test.ts:84-102`,
`hierarchy-property.test.ts:170-174`). No creator byte can reach an S3 key;
`objectKey` rejects anything non-opaque at the boundary.

**"Tenancy enforced" — YES at the code level, with one deviation.** `user_id`
is structurally unobtainable from anywhere but the verified claim
(`claims.ts:16-24`, sole call sites `register-files.ts:61`,
`list-children.ts:29`), every key is `USER#`-prefixed
(`register-files.ts:94,:118,:142,:144,:146`), and `memory-repository.ts:16-17`
makes another tenant's rows unaddressable rather than merely denied — matching
the architecture invariant. Tested at `claims.test.ts:54-73` and
`list-children.test.ts:74-82`. The deviation is F-3: cross-tenant returns
`200 []` rather than the specified `404`. No disclosure results, but the letter
of security invariant S5 is not met.

**"Folder hierarchy preserved byte-identically" — PARTIALLY proven, and the
unproven part matters.**
*Proven:* path **strings** survive registration and reconstruction byte-for-byte
across 200 randomized trees including NFD, CJK, emoji, `#`, `&`, apostrophes,
double spaces and 200-character segments, compared as hex
(`hierarchy-property.test.ts:132,:165-167`).
*Not proven — and in fact false:* that the reconstructed **tree shape** is
correct once more than one batch is registered. F-1 reproduces two identical
`Samples` folders at ROOT after two successive Stashes into the same folder.
Every test in the suite uses a single `registerFiles` call against a fresh
repository, so the property test's 200 cases vary path *content* broadly while
holding the one dimension that fails — batch count — fixed at 1.

### Explicitly NOT proven by the evidence present

1. **Nothing is proven against real DynamoDB.** DynamoDB Local cannot run in this environment (no Docker daemon, no Java — detected and reported at `dynamodb-local.test.ts:25-47`). The entire round trip rests on `MemoryRepository` (`memory-repository.ts`), a 27-line array filter. It models pk/gsi1 key discipline faithfully and deliberately, but it does **not** model: GSI key-completeness (which is precisely why F-6 slipped through — real DynamoDB would drop every item from `gsi3`), conditional-write semantics, `BatchWriteItem`'s 25-item limit and unprocessed-items behaviour (relevant to the unbounded batch in F-9), item-size limits, eventual consistency on GSI reads, or `sk`/`gsi1sk` byte ordering. `list-children.ts:7-12` sorts with `Buffer.compare` explicitly to match DynamoDB's byte ordering — a correct and thoughtful choice, and one that is *asserted* rather than *verified* here.
2. **Idempotent replay is not proven and does not hold** (F-2b). The shared helper is imported and used, but only as a log correlation id.
3. **Nothing is type-checked** (F-5). `npx tsc -b` fails to start; `strict` and `noUncheckedIndexedAccess` never apply.
4. **The stack is not synthesizable as an app** (F-5). No `infra/package.json`, no `infra/bin/stash.ts`; `npm run synth` errors. `StashDataStack` has only ever been instantiated inside a unit test.
5. **Quota, the Stash entity/state machine, the commit guard and optimistic concurrency** are all absent — correctly, as later scope — but F1 must not be signed off in language implying they are covered.

### Recommended gate action

Do not accept F1 as "folder hierarchy preserved" without either fixing F-1 and
F-6 or restating the claim as *"path strings are preserved byte-identically
within a single registration batch, against an in-memory repository"* — which is
exactly what the evidence supports, and is still a real result. F-6 should be
fixed before any real deployment regardless, since it is a silent
infra/handler disagreement that no existing test can detect.

### Reviewer honesty note

Files were read in full, not sampled. Findings F-1, F-2, F-3 and F-8 were
**reproduced by executing the code** in a scratch test outside the repository
(since deleted); no source, test or config file was modified. `npx vitest run`,
`npm ls --workspaces`, `npm run synth` and `npx tsc -b` were run as observations
only. The one thing this review could not establish is whether these files were
authored by a scoped subagent or by the controller (AGENT.md §7) — that requires
the host-dispatch record, which is outside the reviewed set.

---

## Addendum — `adversarial-hierarchy.test.ts` (appeared mid-review; changes the verdict)

`services/handlers/files/test/adversarial-hierarchy.test.ts` (522 lines) did not
exist when this review's file list was first enumerated and appeared during the
review (concurrent authoring). It is in scope, so it was read in full and run.

**Result: `Tests 2 failed | 16 passed (18)`.** The repository test suite is
therefore **RED**, not green as recorded at the top of this report.

### The two failures independently confirm Finding F-1

```
FAIL  repeat registration into an existing folder > adds a second file to the
      SAME folder instead of forking the folder
  AssertionError: the creator has ONE folder named Beats; a second folder
  record splits their library in two: expected 2 to be 1
  at adversarial-hierarchy.test.ts:490:7

FAIL  repeat registration into an existing folder > does not duplicate a deep
      chain when a sibling branch is added later
  AssertionError: folder A must exist exactly once: expected 2 to be 1
  at adversarial-hierarchy.test.ts:505:7
```

This is the same defect this review reproduced independently as F-1, found by a
different route, and the test file's own header comment (`:9-13`) names the
exact blind spot this review identified — that the property test "never
registers the same folder twice". Two independent lines of evidence now agree,
and one of them is a committed failing test.

**Consequences for this report:**

1. **F-1 is upgraded from medium to `high`.** It is no longer a latent gap
   inferred by a reviewer; it is a reproducible failing assertion in the
   repository, on the exact claim F1 is being signed off against. Per the
   severity table, an unresolved failing test on the feature's headline claim
   blocks.
2. **The §5 verdict changes from `complete with findings` to `blocked`.** The
   gate cannot pass a red suite. Nothing else in this report changes: the
   security gate still passes, tenancy and key opacity are still sound, and
   findings F-2 through F-10 stand exactly as written.

### What the 16 passing adversarial tests add to the evidence base

These materially *strengthen* the byte-identity and opacity claims well beyond
what the property test alone supported, and should be credited:

- **Unicode merge traps all survive** (`:102-181`): NFC vs NFD as distinct
  siblings in one folder (`:103-126`), Turkish dotted/dotless I, eszett vs
  STRASSE, the Kelvin sign vs `K`, the fi-ligature vs `fi` (`:128-148`),
  ZWJ vs unjoined emoji, ZWSP/ZWNJ, RTL/LTR overrides, a leading BOM, `U+10FFFF`,
  **lone surrogates** and stacked combining marks (`:150-180`). Every one
  round-trips hex-identical through `JSON.stringify`. This closes the lone-
  surrogate concern this review had flagged as a theoretical risk.
- **Structural traps hold** (`:187-286`): a file and a folder with the same name
  in one parent (`:188-199`); a folder literally named `ROOT` does not collide
  with the `"ROOT"` sentinel at `list-children.ts:17` and does not mis-parent
  the tree (`:201-217`) — the sentinel design is validated, not merely assumed;
  names that are only spaces or only dots (`:219-238`); segments that mimic the
  key scheme itself (`USER#`, `FILE#`, `PARENT#ROOT`, `##`) (`:240-263`).
- **Scale and ordering** (`:292-360`): 500 siblings with none dropped or
  duplicated, including 40 names identical for their first 200 characters, and
  an explicit pairwise assertion that output is in UTF-8 **byte** order
  (`:321-326`) — this verifies the `Buffer.compare` choice at
  `list-children.ts:7-12` rather than trusting it. A 40-level deep tree yields
  exactly 40 folders (`:329-340`). Boundary sizes hit exactly: a 1024-byte path
  and 255-byte multi-byte segments (`:342-359`).
- **Tenancy under attack** (`:417-472`): an attacker supplying the victim's real
  `folderId` gets `[]`, and six crafted `parentFolderId` values
  (`../victim`, `USER#victim#PARENT#ROOT`, `ROOT#PARENT#ROOT`, ...) never escape
  the attacker's partition. Confirms this review's Rule 7 verdict by attack
  rather than by construction.
- **A malformed subject claim fails closed** (`:403-410`): subs such as
  `../other`, `a/b`, `u#1`, `..` and one containing a NUL escape produce `400`
  with `repo.all() === []`, not a 500 and not a smuggled key. This exercises the
  `objectKey` guard (`keys.ts:16-23`) on the *user* id, which no prior test did.

### Two corrections this file forces to earlier findings

- **F-8 (backslash rejection) is downgraded to a note, not a finding.**
  `adversarial-hierarchy.test.ts:270` asserts a path containing a backslash
  **must** return 400. A second author has now deliberately codified the
  rejection as intended behaviour. The product question (a creator with a legal
  POSIX folder name containing a backslash cannot Stash it) is still worth a
  one-line decision record, but it is a ratified choice rather than an
  unexamined one.
- **Q2 now has a test asserting the opposite of this review's recommendation.**
  `adversarial-hierarchy.test.ts:513-521` — "keeps duplicate identical paths
  inside one batch in the one correct folder" — asserts `201` with **two** files
  named `x.wav` in one folder, i.e. it codifies today's behaviour as correct.
  This review recommends `400` (§4 Q2). **The controller must now decide, and
  either the handler or that test changes.** This review does not change its
  recommendation — the reasoning in §4 Q2 stands, and note that the test asserts
  the *outcome* without arguing why a filesystem-impossible shape should be
  representable — but the controller should know a peer reviewer reached the
  opposite conclusion, and that this is exactly the "surface as options, do not
  decide alone" case in AGENT.md's inherited rule 4.

### Revised verdict

**`blocked`**, pending F-1. The block is narrow and the fix is well understood:
folder identity must become a repository lookup or a conditional write keyed on
`(pk, parentFolderId, name)` instead of the per-invocation `Map` at
`register-files.ts:95`. Everything else in this diff is sound, the security gate
passes, and the adversarial file has made the byte-identity and opacity claims
substantially better proven than they were before it landed — against
`MemoryRepository` only, which remains the standing limitation (§5).
