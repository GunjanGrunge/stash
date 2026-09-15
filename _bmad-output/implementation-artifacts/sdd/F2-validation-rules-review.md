# F2 Validation — Rules & Security Review (duplicate folder detection)

Reviewer: validation subagent (read-only). Date: 2026-09-15.
Scope reviewed: `services/handlers/manifest/src/*.ts`,
`services/handlers/manifest/test/*.ts`, and their use of
`services/shared/src/*.ts` (read-only context).
Authorities: `AGENT.md` §2 + §4, `skills/stash-backend/SKILL.md`,
`skills/stash-architecture/SKILL.md`, `sia/guides/security-gate.md`.

Observed state: `npx vitest run` → **12 files, 102 passed, 1 skipped**
(the skip is the pre-existing `files/test/dynamodb-local.test.ts` Docker/Java
skip, not F2). `npx tsc -p services/handlers/manifest/tsconfig.json` → exit 0.
`npx tsc -p tsconfig.json --listFiles | grep -c handlers/manifest` → **0**
(known, AFR-005, fix already assigned). No `adversarial-manifest.test.ts`
existed at review time.

Every rule below is answered twice: **(a) does the code work**, and
**(b) did it repeat a known mistake**.

---

## 1. Per-rule verdict table

| Rule | Verdict | Evidence (file:line) | (a) works? | (b) repeats a known mistake? |
|---|---|---|---|---|
| **1 — Never reorganize a user's library** | respected, with a downstream hazard | `services/shared/src/paths.ts:61-62` byte-identical passthrough; `manifest-hash.ts:12-18` hex of raw UTF-8, no normalize/case-fold/trim; `check-manifest.ts:50-55,76-82` raw-byte identity keys; `test/check-manifest.test.ts:279-293` NFC≠NFD | Yes. Nothing in the diff rewrites a creator string. | No new instance. But see F2-2: the `partial` response can drive a *client* into merging two distinct same-named folders. |
| **2 — File, Folder and Stash are three concepts** | respected | `types.ts:12-27` `entity: "MANIFEST"` is its own record that *references* `folderId` rather than being a Folder; `types.ts:13-16` comment states it replaces neither | Yes. | No. |
| **3 — A checksum match is never an identity match** | **violated** (exact branch) | `check-manifest.ts:147-158`: `findByHash(userId, hash)` decides `exact` **without consulting `folderName`**; `manifest-hash.ts:29-37` hashes only path+size+checksum — folder identity is absent from the hash | Partly. The *partial* branch is correct and conservative (`check-manifest.ts:102-113`, `169-172`). The *exact* branch promotes a pure content hash to a folder identity claim. | **Yes — this is Rule 3's own failure shape**, in the one place the brief warned about. Detail in F2-1. |
| **4 — Never mark something Stashed that is not verified committed** | not applicable to this handler; hazard created | `check-manifest.ts:132-207` performs no state transition and no write at all (`test/check-manifest.test.ts:164-178` proves `writeCount()` unchanged) | Yes — nothing is marked. | Not repeated here, but `ManifestRecord` (`types.ts:17-27`) carries **no link to verified-committed state**, so whoever eventually calls `putManifest` can make every future check assert "already Stashed" for bytes that never landed. See F2-3. |
| **5 — No LLM in the product runtime** | respected | no model client, no network call anywhere in `services/handlers/manifest/src/`; only `node:crypto` (`manifest-hash.ts:1`, `check-manifest.ts:1`) | Yes. | No. |
| **6 — S3 keys are `users/<user_id>/<file_id>`, opaque IDs only** | not applicable | `objectKey` (`services/shared/src/keys.ts:8`) is never imported by this package; the diff builds no S3 key. Creator paths stay as record attributes (`types.ts:6-10`) | n/a — correctly, since a check endpoint has no object to name. | No. Notably the package did *not* invent its own key format, which is the mistake this rule exists to prevent. |
| **7 — `user_id` only from verified JWT claims** | respected | `check-manifest.ts:135` → `services/shared/src/claims.ts:16-24` reads only `requestContext.authorizer.jwt.claims.sub`; the body is parsed *after* (`check-manifest.ts:137`) and no branch ever reads a body/query/path user id; `test/check-manifest.test.ts:153-162` cross-tenant → `none`, `:211-217` missing sub → 401 | Yes. | No. |
| **8 — S3 versioning off, never overwrite a key** | not applicable to the handler; same shape present in the port | handler writes nothing (`check-manifest.ts:120-123`). But `memory-repository.ts:34-37` is a blind `items.set(...)` overwrite and `repository.ts:21` exposes no conditional-write affordance | n/a for S3. | **Yes, in shape** — a blind put on a key that two distinct folders can share. See F2-4. |
| **9 — Payload bytes never transit Lambda / API Gateway** | respected | no `@aws-sdk/client-s3` import, no presign, no body streaming anywhere in `services/handlers/manifest/src/`; the response carries only metadata (`types.ts:35-51`). The whole feature exists to answer *before* bytes move (`check-manifest.ts:116-117`) | Yes — this is the rule the feature is built around and it holds. | No. |
| **10 — STASH vocabulary in user-facing text** | not applicable | the diff ships no user-facing copy; strings are API error messages keyed by `code` (`services/shared/src/errors.ts:34-35`). Doc comments use "Stashed" correctly (`types.ts:29-34`) | n/a. | No. |
| **11 — Every `cdk deploy` / mutating AWS call is High severity** | not applicable | the diff contains no CDK change and no AWS call; `infra/` untouched by F2 | n/a. | No. |
| **12 — Never write AWS credentials into the repo** | respected | no literal, no env read, no `.env` access in the package. `logger` emits only counts — `check-manifest.ts:156`, `:193-196`, `:200` log `file_count` / `existing_count` / `new_count` and **never** a path, checksum or folder name | Yes, and deliberately so: creator content is kept out of CloudWatch. | No. |
| **AFR-001 — BMAD spine + SIA gates** | not applicable to the diff (process rule) | execution artifacts exist: `sdd/task-F2-brief.md`, `task-F2-dispatch.md`, `task-F2-report.md` | n/a. | No. |
| **AFR-002 — don't pin a tool config exhaustively plus an unverified exit code** | respected | `sdd/task-F2-brief.md` pins interfaces, not tool configs; `npx vitest run` exits 0 with the suite green, no spec conflict reported in `task-F2-report.md` | Yes. | No. |
| **AFR-003 — `uisamples/` is not a requirements source** | not applicable | no UI work; the only copy reference (`types.ts:29-34`, the "1,847 of 1,850" string) traces to PRD §7 duplicate handling, not to a mockup | n/a. | No. |
| **AFR-004 — identity stable across invocations, not minted per call; tests must use ≥2 calls on one repo** | respected on the read path; **gap on the write port** | `check-manifest.ts:136` is the only `randomUUID()` and it is a *correlation id*, not an entity identity — no identity is minted. The test clause is genuinely satisfied: `test/check-manifest.test.ts:180-209` runs three separate handler calls against one repository and asserts a stable `folderId`; `:164-178` runs three more | Yes for F2's own code. | **Partly.** The port `repository.ts:21` still offers only a blind `putManifest`, exactly the read-before-write/conditional-put affordance AFR-004 was written to require. No defect ships today (no caller), but the interface invites the F1 mistake. See F2-4. |
| **AFR-005 — gates must cover code structurally, not by enumeration** | violated (known; fix assigned) | root `tsconfig.json:11-19` enumerates `services/handlers/files/**` and omits `services/handlers/manifest/**`; verified `--listFiles \| grep -c handlers/manifest` → `0` while `npm run typecheck` exits 0 | The package *does* typecheck clean when its own `tsconfig.json` is used directly (exit 0), so no type defect is hiding behind the gap. | Yes — already captured, not re-reported as a new discovery. **Additional gaps found:** see F2-7 and F2-8. |

---

## 2. Security gate (`sia/guides/security-gate.md`)

| Threat class | Applicable here? | Finding |
|---|---|---|
| **XSS / JS injection** | Not at this layer, with a caveat | The handler returns `JSON.stringify(...)` only (`check-manifest.ts:157,197,202`); there is no DOM, no `innerHTML`, no `eval`. **Caveat:** `newFiles` echoes creator-controlled `relativePath` and `checksum` verbatim (`check-manifest.ts:190`), and Rule 1 forbids sanitizing them. That is correct here — the escaping obligation belongs to whatever renders the list. Worth stating explicitly in the client contract so it is not assumed to have been done server-side. |
| **SQL / NoSQL / DynamoDB-expression / command injection** | Applicable — clean | No shell call, no `child_process`, no query string is built anywhere in the diff. The persistence port takes **typed arguments, not expressions** (`repository.ts:13-21`), so no creator string can reach a condition/filter/projection expression. `memory-repository.ts:29-31` filters in JS. Backend invariant 4 (parameterized expressions only) is satisfied by construction. The real DynamoDB implementation does not exist yet — this remains the place to re-run this check. |
| **Prompt injection** | Not applicable | No LLM anywhere in the runtime path (Rule 5). Creator strings are never placed in a model context. |
| **Hard-coded secrets** | Applicable — clean | No key, token, URL-embedded credential or endpoint literal in any file of the package. Auth is not bypassed: `userIdFromEvent` throws 401 before any repository read (`check-manifest.ts:135` runs before `:147`). |
| **Unescaped LLM output** | Not applicable | No LLM output exists. |

### Specifically requested checks

**Prototype pollution via creator-controlled keys — clean, and by design rather than by luck.**
Every composite key in the diff is built from **hex** of the raw UTF-8 bytes, never from the string itself:
`pairKey` (`check-manifest.ts:50-55`), the duplicate-path guard (`check-manifest.ts:76`), and
`bytesKey` (`memory-repository.ts:5-7`). A `relativePath` or `folderName` of `__proto__`,
`constructor` or `prototype` hexes to `5f5f70726f746f5f5f` etc. and is inert. The containers are
`Set` and `Map` (`check-manifest.ts:66,106`, `memory-repository.ts:14`), not plain objects, so
even an un-encoded key could not reach `Object.prototype`. No `obj[userKey] = ...` assignment
exists anywhere in the diff. Reads of creator data use fixed literal keys
(`e["relativePath"]`, `e["sizeBytes"]`, `e["checksum"]` at `check-manifest.ts:72,83,87`), and
`JSON.parse` creates `__proto__` as an own data property, so `parseBody` (`:24-29`) cannot pollute.

**Creator-controlled string interpolated into a composite key without a charset constraint — none.**
This is the question that usually finds a bug, and here the answer is genuinely clean: the hex
alphabet `[0-9a-f]` cannot contain the `#` separator used by `pairKey`/`bytesKey`, nor the `:`
and `\n` separators used by `manifest-hash.ts:17,34`. The only *un-encoded* interpolations are
`` `USER#${userId}` `` and `` `MANIFEST#${manifestHash}` `` (`memory-repository.ts:21,28`), where
`userId` is a Cognito `sub` from a verified claim and `manifestHash` is a 64-char hex digest —
both constrained, neither creator-controlled. `folderName` is **never** interpolated into a key;
it is only compared with `===` (`memory-repository.ts:30`). See F2-5 for the separate validation
gap on `folderName` (a size/DoS issue, not an injection one).

---

## 3. Correctness of `manifestHash` against adversarial field-boundary forgery

**Verdict: the encoding is unambiguous. Field-boundary forgery is impossible, not merely unlikely.**

The encoding is (`manifest-hash.ts:12-18`, `:29-36`):

```
line  = hex(utf8(relativePath)) ":" String(sizeBytes) ":" hex(utf8(checksum))
digest = sha256( sorted(lines) each followed by "\n" )
```

Why the boundaries hold — the argument is about **alphabets**, which is the only argument that
actually works here:

1. `Buffer.toString("hex")` emits strictly `[0-9a-f]`. Neither `:` nor `\n` is in that alphabet,
   so no path and no checksum — however adversarial, including one containing literal `":"`,
   `"\n"`, or a full forged line — can ever produce the separator. This is the property that a
   naive `path + ":" + checksum` join would lack, and it is the single most important decision in
   the file.
2. `String(sizeBytes)` for a finite non-negative `Number` emits only `[0-9.eE+-]` (e.g. `1e+21`,
   `1.5`). Again no `:` and no `\n`. `sizeBytes` is proven finite and non-negative upstream at
   `check-manifest.ts:84-86` before it ever reaches the hash.
3. Therefore `line.split(":")` recovers exactly three fields, and `hex → bytes` is injective, so
   `line` determines `(relativePath, sizeBytes, checksum)` uniquely. `("a/b","cc")` vs
   `("a","b/cc")` — the classic forgery — encode as `612f62:1:6363` vs `61:1:622f6363`, which
   differ. `test/manifest-hash.test.ts:45-49` pins exactly this.
4. Entry boundaries: `\n` terminates every line and cannot occur inside one (points 1–2), so the
   concatenation is a prefix-free framing. An entry cannot be split into two, and two entries
   cannot be fused into one.
5. Ordering: `lines.sort()` (`manifest-hash.ts:30`) canonicalizes the multiset, so the digest is a
   function of the *set of entries*, not of client walk order. Duplicates are preserved by sort, so
   the encoding is injective on multisets too (and the handler rejects duplicate paths anyway at
   `check-manifest.ts:77-81`).

Residual, both harmless: `String(-0) === "0"`, so `-0` and `0` bytes collide — semantically the
same size, and `-0 < 0` is false so `-0` passes validation; and `String` is otherwise injective on
distinct `Number` values, so `1e21` and `1000000000000000000000` are the *same* number, not an
ambiguity. Forging a collision therefore requires a genuine SHA-256 collision.

**The one thing the hash does not cover, and it matters:** `folderName` is **not** an input to
the digest. Two folders with different names but identical internal contents produce the *same*
`manifestHash`. That is the correct choice for the hash itself (it is a content fingerprint), but
`check-manifest.ts:147` then uses that fingerprint alone as an identity decision. That is F2-1.

---

## 4. The partial-match arithmetic

Code under review: `check-manifest.ts:102-113`.

```
known        = Set( stored.entries.map(pairKey) )
newFiles     = entries.filter(e => !known.has(pairKey(e)))
existingCount= entries.length - newFiles.length
newBytes     = sum(newFiles.sizeBytes)
```

**Verdict: arithmetic is correct, including the same-path-different-checksum case. No off-by-one
at 1,847 / 1,850.**

- `pairKey` (`check-manifest.ts:50-55`) is `hex(path) # hex(checksum)` — size is deliberately *not*
  part of it, so the comparison is "same file at same place with same content".
- **Path matches, checksum differs → counted as NEW.** `pairKey` differs, so the entry survives the
  filter and lands in `newFiles`. This is the correct and the safe direction: claiming an edited
  file is "already Stashed" would silently drop the creator's edit. Pinned at
  `test/check-manifest.test.ts:131-151` (`existingCount` 1, `newFiles` = the changed one,
  `newBytes` 9 — the *new* size, not the stored one, which is right because that is what will be
  uploaded).
- **Partition is exact.** `filter` splits `entries` into exactly two disjoint parts, so
  `existingCount + newFiles.length === entries.length` identically — an off-by-one is not
  representable in this formulation. At 1,850 candidate entries with 1,847 stored,
  `newFiles.length === 3` and `existingCount === 1847`, verified at
  `test/check-manifest.test.ts:67-86` (asserts `1847`, `toHaveLength(3)`, and the exact tail slice).
- **No double counting.** Duplicate `relativePath` within one manifest is rejected at
  `check-manifest.ts:77-81`, so candidate `pairKey`s are distinct and no entry is counted twice.
  Duplicate pairs on the *stored* side are absorbed by the `Set`, which is harmless.
- **`newBytes` sums only new files** (`:111`), which is the number the creator needs ("3 new files,
  X MB to upload"), not the folder total. Correct.
- Two interface notes, neither an arithmetic error:
  1. The `partial` result omits the candidate's total file count (`types.ts:43-50`), while `exact`
     includes `fileCount` (`:36-42`). The "1,847 of 1,850" copy requires the client to compute
     `existingCount + newFiles.length`. Asymmetric, easy to get wrong downstream; worth adding.
  2. Stored entries **absent** from the candidate (files the creator deleted locally) are invisible
     to the diff. Correct for this endpoint's question, but it means `existingCount` describes the
     *stored snapshot*, not current S3 reality — which is what makes F2-3 matter.
- `newBytes` has one arithmetic edge: see F2-6 (`Infinity` serializes to JSON `null`).

---

## 5. Candidate-selection review (`check-manifest.ts:163-182`)

The brief (`sdd/task-F2-brief.md`, step 4) says only "look for a stored manifest with the same
`folderName`. If one exists, diff...". It does not say what to do when several exist. The
implementer chose: skip zero-overlap candidates, then greatest `existingCount` wins, ties broken by
lowest `manifestHash`. Judged on its merits:

**What is right, and genuinely so:**
- **Zero-overlap candidates are skipped** (`:172`). A folder whose *name* alone coincides is
  reported `none`, not `partial`. This is precisely the under-reporting bias the product requires,
  and it is the difference between "you already have this" and "you have something else called the
  same thing". Pinned at `test/check-manifest.test.ts:115-129`.
- **The choice is deterministic across calls.** `(existingCount desc, manifestHash asc)` is a total
  order — strict `>` and strict `<` mean insertion order of `findByFolderName` cannot influence the
  result, and two candidates cannot tie on both keys (equal hash implies the same `sk`, i.e. the
  same item). This is the AFR-004 property applied to a read path, and
  `test/check-manifest.test.ts:180-209` exercises it across three separate calls on one repository.
- Choosing greatest overlap **maximises a statement that is individually true** — every one of
  those `existingCount` files really is present in that stored manifest at the same path with the
  same checksum.

**Where it can over-report — and it can:**
- **Across two distinct folders that share a name (F2-2).** `findByFolderName` returns manifests
  for *different* `folderId`s (`memory-repository.ts:29-31` filters on name only). If a creator has
  two unrelated folders both called `Drums` and stashes a third, the algorithm returns the
  `folderId` of whichever *other* folder shares the most files, and suppresses those shared files
  from `newFiles`. The response gives the client one `folderId`, one `folderName`, and no signal
  that multiple candidates existed or that the winner is a different folder.
- **Maximising overlap maximises suppression.** By construction the rule picks the candidate that
  removes the *most* files from `newFiles`. In the good case that saves the most bandwidth; in the
  wrong-candidate case it withholds the most files from upload. The tie-break direction is
  irrelevant to safety; the *objective function* is the risk.
- **Staleness is invisible.** A manifest is a snapshot; nothing reconciles it against current File
  state (F2-3). Greatest overlap will happily select an old manifest whose files were later deleted
  or never committed.

**Judgement:** the design is right at the boundary that matters most (zero overlap → `none`, and a
changed checksum → new file), and it is deterministic. It is **not** conservative at the boundary
*between candidates*: it silently picks a winner where the honest answer is "several folders of
this name partially match". A conservative variant would be to require the winner to be
unambiguous — e.g. report `none` (or return the candidate set) when two candidates have
comparable overlap — rather than to maximise suppression. This is an unratified design decision
made inside an implementation task and should go back through the approval gate rather than be
settled by a reviewer.

---

## 6. Findings

Severity per `AGENT.md` §2 ("Severity threshold for this project: standard"): Low proceeds
silently, Medium is flagged and batched, High blocks on explicit approval.

### F2-1 — `exact` match ignores `folderName`: a content hash is used as a folder identity — **High** (Rule 3)
`check-manifest.ts:147-158`; hash input at `manifest-hash.ts:12-18`.

`findByHash(userId, hash)` takes no `folderName`, and `manifestHash` does not include one. Any two
folders whose *internal* contents are identical share a digest.

Failure scenario: `relativePath` is naturally folder-*relative* (that is why `folderName` is a
separate top-level field at `check-manifest.ts:139`, and why `validateRelativePath` never requires
the first segment to equal it). A creator stashes `Vol 4` containing
`Kicks/x.wav` + `Snares/y.wav`. Later they stash `Vol 5` — a different folder, different files on
disk, but identical relative layout and identical checksums (a re-export, a duplicated project
template, a bounced stem set). The digest is identical, `findByHash` hits, and the creator is told
**`match: "exact"` with `folderName: "Vol 4"`, `folderId: folder-v4`** — "you already have this
folder". They cancel the Stash. `Vol 5` is never uploaded. That is the exact false-positive
data-loss path the handler's own doc comment (`check-manifest.ts:124-130`) says must never happen.

Note the existing guard test (`test/check-manifest.test.ts:97-113`) does **not** catch this,
because its fixture data prefixes the folder name into every `relativePath`
(`"Vol 4/Kicks/x.wav"`). The test therefore proves the hash is path-sensitive — true and valuable —
but it silently assumes a client convention that nothing in the code enforces. Whether
`relativePath` is folder-relative or folder-inclusive is **undefined in the brief, the types and
the validator**, and the exact branch is only safe under one of the two readings.

Fix direction (needs approval, per Inherited Rule 2): either bind `folderName` into the digest, or
make the exact lookup `(userId, folderName, hash)`, or state and *enforce* the folder-inclusive
`relativePath` convention. Note the last option conflicts with the partial branch, which keys on
`folderName` separately.

### F2-2 — `partial` can collapse two distinct folders that share a name — **High** (Rules 1, 2, 3)
`check-manifest.ts:163-182`, `:184-192`; `memory-repository.ts:29-31`.

`findByFolderName` matches on name only, across all of the creator's folders. Failure scenario: the
creator has `Projects/2024/Drums` and `Projects/2025/Drums`, both stashed. They now stash a third
`Drums` that shares 40 files with the 2024 one. Response: `match: "partial"`,
`folderId: <the 2024 folder>`, `existingCount: 40`, and those 40 files absent from `newFiles`. A
client that acts on the response — adds only `newFiles` to the returned `folderId` — has merged
three separate folders into one, which is precisely the reorganization Rule 1 forbids, and has
attached the new files to a Folder the creator never pointed at. The response carries no signal
that the winner is a *different* folder or that other candidates existed.

### F2-3 — `ManifestRecord` has no link to verified-committed state — **Medium** (Rule 4 hazard)
`types.ts:17-27`; `repository.ts:21`.

The record carries `fileCount`, `totalBytes` and `entries`, but nothing that says those files ever
reached `committed`. Nothing in the diff constrains *when* a manifest may be written. Failure
scenario: an ingestion path writes the manifest at Stash **start** (the natural place — it is what
the client already has in hand); the upload then fails for 200 of 1,850 files. Every subsequent
check reports those 200 as already Stashed and excludes them from `newFiles`, so they are never
retried. Rule 4 is a per-file verification rule; the manifest is a per-folder assertion layered on
top of it with no verification link. This is the first thing the (not yet written) `putManifest`
caller must get right.

### F2-4 — `putManifest` is a blind overwrite on a key two folders can share — **Medium** (Rule 8 shape, AFR-004)
`memory-repository.ts:34-37`; port at `repository.ts:21`.

`items.set(bytesKey(pk, sk), record)` with no read-before-write and no conditional affordance on
the port. Because `sk = MANIFEST#<hash>` and the hash excludes `folderName` (F2-1), two distinct
folders with identical contents map to **one** key. Failure scenario: `Vol 4` is stashed
(`folderId: folder-v4`); later `Vol 5`, identical contents, is stashed and its manifest is written
to the same `sk`. The `folder-v4` record is silently replaced. A subsequent check of `Vol 4` now
returns `folderId: folder-v5` — the creator's logical path has been repointed on a content match,
which Rule 3's second sentence forbids outright. Also the exact repeat of the AFR-004 "blind put"
shape, one layer up. No defect ships today only because there is no caller.

### F2-5 — `folderName` has no length, charset or control-character validation — **Medium**
`check-manifest.ts:139-142` (only `typeof === "string" && length > 0`), consumed at `:163`.

`relativePath` gets a full validator (`services/shared/src/paths.ts:15-62`: control chars, 1024-byte
cap, 255-byte segments, traversal, absolute, separator). `folderName` gets nothing comparable, yet
it is the second lookup key. Failure scenario: a 400 KB `folderName`, or one containing a NUL or a
newline, is accepted; against real DynamoDB it becomes a key/index value and blows the 1024-byte
key limit, surfacing to the creator as a 500 rather than a 400, and a newline inside it corrupts
any log line that later includes it. Not an injection (it never enters a key or expression — see
§2), but an unvalidated creator string on a key path. A `validateFolderName` in
`services/shared/src` is the symmetric fix.

### F2-6 — `newBytes` can serialize as JSON `null`; `sizeBytes` accepts non-integers — **Low**
`check-manifest.ts:84-86` (validation), `:111` (sum), `:190` + `:197` (serialization).

`sizeBytes` is validated only as a finite non-negative `number` — `1.5`, `1e308` and `0.1` all pass.
Two entries of `1e308` sum to `Infinity`, and `JSON.stringify({newBytes: Infinity})` yields
`{"newBytes":null}` (verified in this environment). Failure scenario: a malformed or hostile client
sends huge sizes; the creator's UI receives `newBytes: null` and renders "NaN MB to upload" or
throws. Also, non-integer byte counts are meaningless for a file size and accumulate float error
across 1,850 entries. Fix: require `Number.isSafeInteger(sizeBytes) && sizeBytes >= 0`, plus a
per-entry upper bound.

### F2-7 — the handler event is typed `any`, erasing the shared library's typed event contract — **Low** (gate coverage, additional to AFR-005)
`check-manifest.ts:19` (`parseBody(event: any)`), `:133` (`async (event: any)`);
`services/handlers/manifest/package.json` declares `@types/aws-lambda` as a devDependency that no
source file imports.

`userIdFromEvent` and `idempotencyKeyFromEvent` are declared against
`APIGatewayProxyEventV2WithJWTAuthorizer` (`services/shared/src/claims.ts:13-15`,
`idempotency.ts:13-15`), but passing `any` suppresses every check at the call sites
(`check-manifest.ts:135-136`). So even once the root tsconfig gap (AFR-005) is fixed, the event
shape — the one attacker-adjacent input — remains untypechecked. This is the same *class* as
AFR-005 (a gate that reports success over code it does not actually cover), one level down.

### F2-8 — no lint gate exists, and the manifest `tsconfig.json` is never invoked by any script — **Low** (gate coverage)
`package.json:9-13` defines only `test`, `typecheck`, `synth`; no ESLint/Biome config anywhere in
the repo. `services/handlers/manifest/tsconfig.json` is correct and passes standalone (exit 0
verified) but no npm script references it, so it provides no gate. By contrast
`vitest.config.ts:4` *does* use a glob (`**/*.test.ts`) and correctly picks up the new package —
worth noting as the one gate in the repo that already satisfies AFR-005.

### F2-9 — test label misattributes a rule — **Low** (documentation)
`test/check-manifest.test.ts:164`: "performs NO write: putManifest is never invoked during a check
(Rule 9)". The assertion is excellent and should stay, but Rule 9 is about payload bytes not
transiting Lambda; the no-write property belongs to Rule 3 / read-only-endpoint. A future reader
grepping for Rule 9 coverage will be misled. Same slip in the source comment at
`check-manifest.ts:120-123`, which correctly cites Rule 3 alongside — so only the test label is wrong.

**Nothing invented:** the encoding analysis (§3), the partial arithmetic (§4), tenancy, the
no-write proof and the NFC/NFD discipline were each checked for a defect and found genuinely
correct. Those sections say so rather than manufacturing a finding.

---

## 7. Verdict

**`complete with findings`.**

Two High findings (F2-1, F2-2) sit on the same root cause — folder identity is inferred from
content without the folder being part of the identity — and both are the Rule 3 failure mode in the
one place `AGENT.md` predicted it. Neither can ship as-is; both need a decision through the
approval gate, not a reviewer's patch.

**What F2 genuinely proves:**
- The manifest digest is a correctly canonicalized, boundary-unambiguous, order-independent
  fingerprint of a folder's contents. The hex encoding is the right call and is airtight (§3).
- The diff arithmetic is exact, and a same-path-different-checksum entry is correctly treated as a
  new file — the single most important correctness decision in the diff (§4).
- Tenancy holds: `user_id` comes only from the verified claim, and a cross-tenant manifest is never
  reported (`test/check-manifest.test.ts:153-162`).
- The endpoint writes nothing and touches no S3 — Rule 9 holds by construction, proven by
  write-count assertion, not by assertion in prose.
- Creator bytes are never normalized (NFC ≠ NFD end to end) and never logged.
- Composite keys are hex-encoded throughout, so prototype pollution and separator forgery are
  structurally impossible rather than accidentally absent.
- The AFR-004 test clause is satisfied in substance: identity stability is exercised across
  multiple calls on one repository, not a single shot.

**What F2 does NOT prove:**
- That `exact` means "this folder", rather than "some folder of yours with these contents" (F2-1).
- That a `partial` answer names the *right* folder when several share a name (F2-2).
- Anything about DynamoDB. There is no `DynamoManifestRepository`; every test runs against
  `MemoryManifestRepository`. Key-size limits, GSI shape for `findByFolderName`, item-size limits
  (an 1,850-entry `entries` array will approach the 400 KB DynamoDB item cap), pagination and
  conditional writes are all unproven.
- That a manifest ever reflects verified-committed reality (F2-3).
- That the root typecheck gate covers this package — it does not (AFR-005, verified `grep -c` → 0);
  and even once fixed, `event: any` keeps the event shape unchecked (F2-7).

**Context, as instructed:** `putManifest` has **no caller anywhere in the repo** (verified: the only
references are the port declaration, the memory implementation, and test fixtures). In production
today every check would return `match: "none"`, because no manifest record is ever written. F2 is a
correct and well-tested *engine* with no ingestion path wired to it; F2-1 through F2-4 are all
latent until that path is built, which makes now the cheap moment to settle them.

**Concurrency note:** another validator was said to be writing
`services/handlers/manifest/test/adversarial-manifest.test.ts`. It was not present at any point
during this review, and no finding above depends on it. Noted, not acted on.
