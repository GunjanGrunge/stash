# F2 Fix Validation Report

Validator: stash-f2-fix-validator (independent, post-repair). Host: claude-code.
Date: 2026-09-15. Files owned: `services/handlers/manifest/test/fix-validation.test.ts`, this report.
No src, existing test, or config file was modified.

## Verdict

All six repairs HOLD. No new defect found. 17 new tests added (89 pass in the
manifest package, 167 pass + 1 skipped repo-wide, typecheck exit 0).

## Evidence

```
$ npx vitest run services/handlers/manifest
 Test Files  4 passed (4)
      Tests  89 passed (89)

$ npx vitest run
 Test Files  14 passed (14)
      Tests  167 passed | 1 skipped (168)      # baseline 148+1; +19 from this file's suites

$ npm run typecheck
> tsc -p tsconfig.json
typecheck_exit=0

$ npx tsc -p tsconfig.json --listFiles | grep -c handlers/manifest
9      # 8 before this report's test file was added; controller measured 8
```

## Per-repair findings

### F2-1 manifestHash folder framing — HOLDS
18 crafted (folderName, entries) pairs hashed; all 18 digests distinct. Included a
folderName literally `folder:61`, one spelling a whole forged line
(`folder:61\n61:1:6161`), pure-hex names (`61`, `6161`), names containing `:`,
`\n`, `#`, empty names, and name/path and path/checksum boundary shifts
(`("AB","c.wav")` vs `("A","Bc.wav")`, `("a","bcc")` vs `("ab","cc")`).
The claim is structurally sound, not merely empirically: hex output is
`[0-9a-f]` only, so an entry line can never begin `folder:`; the folder line
carries exactly one `:` and an entry line exactly two (`String(number)` never
contains `:` or `\n`), so the two line shapes are disjoint.
Trade-off confirmed bounded: a RENAMED folder returns `{match:"none"}` with
zero writes, zero mutations, one record still in the store, no `folderId`/old
name in the response, and the original folder still resolving `exact` to its
own id. It costs bandwidth only.

### F2-2 ambiguity — HOLDS
- Exactly one overlapping candidate among three zero-overlap same-name
  candidates still returns `partial` with the right `folderId`, and none of the
  three non-candidates leak.
- All-candidates-zero-overlap returns `{match:"none"}` (the `none` path, not the
  ambiguity path) with no id leak.
- The ambiguous body has exactly one key, `match`. No `folderId`, `folderName`,
  `existingCount`, `newFiles`, `newBytes`, path or checksum of any candidate
  appears in the serialized response.
- Zero writes and a byte-identical repository snapshot across the ambiguity
  branch.
- Determinism: 16 calls across 4 different candidate insertion orders produced
  one single distinct response string.
- Cannot be bypassed via another user's same-name overlapping folder (tenancy
  holds; that folder neither creates nor suppresses ambiguity).

### F2-3 pairKey with sizeBytes — HOLDS
Five boundary-shift forgeries against a stored `("a", 1, "bcc")` — `("a",1,"b")`,
`("a",11,"cc")`, `("a",1,"bc")`, `("ab",1,"cc")`, `("a",1,"Bcc")` — all returned
`none`; the genuine triple returned `exact`. Exponent/fractional/huge sizes
(`0, 1, 1.5, 1e21, 1e21+1e6, MAX_SAFE_INTEGER, 1e20`) each produce a distinct
digest; `1e21` (whose `String()` is `"1e+21"`) round-trips to `exact`. A stored
2-byte file does not absorb a 4 GB candidate at the same path with the same
checksum.

### F2-5 validateFolderName — HOLDS
- All 33 control code points (0x00–0x1F inclusive, plus 0x7F) rejected 400,
  NUL and DEL included, with no write and no id leak.
- The limit is genuinely BYTES. Verified at the exact boundary for 1-, 2-, 3-
  and 4-byte code points: 255 bytes accepted, 256/258 bytes rejected. A
  255-CHARACTER multi-byte name (`"ñ".repeat(255)`, `"🎧".repeat(255)`) is
  rejected.
- Byte-identical: NFD, NFC, leading space, trailing space, upper-cased and
  zero-width-suffixed variants of one name are six distinct stored identities,
  each resolving `exact` to its own `folderId`, with `folderName` echoed back
  hex-for-hex identical to the input. No trim, normalize or case-fold.
- Surrogate pairs, lone surrogates (`\ud800`, `\udfff`, `a\ud800b`), standalone
  combining marks, BOM and ZWSP never throw; every response is valid JSON.

### Typed event — HOLDS
17 hostile events (`undefined`, `null`, `""`, a string, a number, `[]`, `{}`,
`requestContext: null`, non-string `sub`, missing body, `"{"`, `"[]"`, `"null"`,
numeric body, array body, `headers: null`, `headers: "x"`) all resolve to 400 or
401 with parseable JSON, no `folderId` leak, and no write. Events with throwing
property getters on `requestContext`, `headers` and `body` are caught by the
handler's try/catch and return a generic error body that does not contain the
thrown message — no unhandled rejection. (These return 500, not 400/401; that is
the correct classification for an event object that cannot be read at all, and
nothing leaks.)

### AFR-005 tsconfig glob — HOLDS
`--listFiles | grep -c handlers/manifest` = 9 (8 before this report's own test
file existed; the controller's measurement of 8 reproduces). The glob
`services/handlers/*/src/**/*.ts` + `.../test/**/*.ts` is a wildcard on the
package segment, so YES — a package at `services/handlers/<anything>/src` is
included with no config edit. This is not reasoning alone: `services/handlers/files/`
is never named in tsconfig.json and all 6 of its files appear in `--listFiles`.

## Revised-test audit (highest-risk part of the change)

**`a very long folderName never throws and never matches a short one`**
(adversarial-manifest.test.ts:603) — NOT weakened. Its original guarantee was
two-part: never throws, never matches a short folder. Both are still asserted —
`statusCode` 400 (a handled result, so no throw), `body.match` undefined, and
`"folder-short"` absent from the response. The assertion changed from "returns
200 none" to "returns 400", which is the newly REQUIRED behaviour, not a
relaxation: 400 is strictly stronger than 200/none for the false-positive
guarantee. Residual note: with the 255-byte cap, the deep comparison path is no
longer exercised with a long name at all, but that path is now unreachable by
construction, so there is nothing left to guard there.

**`F2-2: two same-name candidates both sharing files are AMBIGUOUS -> none,
deterministically`** (adversarial-manifest.test.ts:706) — NOT weakened. The
original guarantee was determinism across repeated calls; it is still asserted
by the same mechanism (5 calls, `new Set(results).size === 1`). The revision
ADDED two assertions the original did not have: neither `folder-a` nor
`folder-b` may appear in the response. It also strengthened the expected value
from "the best-overlap candidate" to a deep-equal on `{match:"none"}`. This is a
tightening, not a loosening. I independently re-proved determinism over 4
different insertion orders, which the revised test does not do.

## Read-only / Rule 3 regression — HOLDS

- No manifest src file contains `aws-sdk`, `@aws-sdk`, `S3Client`, `PutObject`,
  `GetObject`, `fetch(`, `node:http`, `node:https` or `DynamoDBClient`
  (asserted by reading all five src files in the test).
- Exercised exact, partial, ambiguous, none, 400 and 401 against one repository:
  `writeCount()` unchanged and a deep snapshot of every stored record identical
  before and after.
- Rule 3: two DIFFERENT folders with byte-identical contents both resolve
  `exact` to their OWN `folderId`; both records still present, unmerged,
  unrepointed, undeduped, byte-identical after the calls.

## Low findings (reported, not fixed)

- **L1 (stale comment).** `services/handlers/manifest/src/check-manifest.ts:234`
  still reads "CONSERVATIVE DEFAULT, pending user ratification." The user has
  since ratified this decision explicitly. Misleading to a future reader who may
  think the behaviour is provisional and change it.
- **L2 (stale comment).** `services/handlers/manifest/test/adversarial-manifest.test.ts:89`
  still reads "folderName is NOT part of manifestHash, so findByHash returns
  Client A's record" — that premise was reversed by F2-1. The test's assertion is
  still correct; only its rationale is now false.
- **L3 (cosmetic, non-defect).** `parseBody` returns an object body without an
  `Array.isArray` guard, whereas the JSON-string path rejects arrays explicitly.
  Both end at 400 via `validateFolderName`, so there is no behavioural gap.

## What remains UNPROVEN

- **Real DynamoDB.** Docker is not running, so there is no DynamoDB Local. Every
  repository assertion here is against `MemoryManifestRepository`. The DynamoDB
  implementations of `findByHash` and `findByFolderName` do not exist yet, so
  their tenancy scoping, byte-exactness of folder-name keys, and pagination of
  `findByFolderName` (a user with many same-name folders spanning a 1 MB query
  page could silently truncate the candidate list and turn an ambiguous case
  back into a `partial`) are entirely unverified. This is the single largest
  open risk and it is NOT closed by this report.
- **API Gateway / Lambda wiring.** No deployed invocation was exercised; the
  typed-event tests construct events in-process.
- **Concurrency.** No test covers a `putManifest` racing a `check`.
