# Task Brief: F2 — duplicate folder detection

Goal: Implement manifest-based duplicate folder detection that runs BEFORE any
payload upload, returning exact / partial / none per PRD §7.

Files (exclusive ownership boundary):
- `services/handlers/manifest/package.json`
- `services/handlers/manifest/tsconfig.json`
- `services/handlers/manifest/src/types.ts`
- `services/handlers/manifest/src/manifest-hash.ts`
- `services/handlers/manifest/src/repository.ts`
- `services/handlers/manifest/src/memory-repository.ts`
- `services/handlers/manifest/src/check-manifest.ts`
- `services/handlers/manifest/test/manifest-hash.test.ts`
- `services/handlers/manifest/test/check-manifest.test.ts`

Do NOT touch `services/shared/**`, `services/handlers/files/**`, `infra/**`,
root `package.json`/`tsconfig.json`/`vitest.config.ts`/`.gitignore`.
The root workspaces glob is already `services/handlers/*`, so your package is
picked up automatically.

Consume from `services/shared` (built, green — do not reimplement):
`userIdFromEvent` (401 on missing sub), `validateRelativePath` (byte-identical
passthrough), `badRequest`, `notFound`, `conflict`, `logger`,
`idempotencyKeyFromEvent`. Import by relative path to
`services/shared/src/index.js` (ESM/NodeNext), as the files handler does.

Produce EXACTLY:
```ts
export interface ManifestEntry { relativePath: string; sizeBytes: number; checksum: string; }
export interface ManifestRecord {
  pk: string; sk: string; entity: "MANIFEST";
  manifestHash: string; folderId: string; folderName: string;
  fileCount: number; totalBytes: number;
  entries: ManifestEntry[];
}
export type ManifestCheckResult =
  | { match: "exact";   folderId: string; folderName: string; fileCount: number; totalBytes: number }
  | { match: "partial"; folderId: string; folderName: string; existingCount: number; newFiles: ManifestEntry[]; newBytes: number }
  | { match: "none" };
export function manifestHash(entries: ManifestEntry[]): string;  // sha256 hex
export interface ManifestRepository {
  findByHash(userId: string, manifestHash: string): Promise<ManifestRecord | undefined>;
  findByFolderName(userId: string, folderName: string): Promise<ManifestRecord[]>;
  putManifest(record: ManifestRecord): Promise<void>;
}
export class MemoryManifestRepository implements ManifestRepository { ... }
export function checkManifest(deps: { repo: ManifestRepository }): (event: any) => Promise<{ statusCode: number; body: string }>;
```
Key construction: `pk = USER#<userId>`, `sk = MANIFEST#<manifestHash>`.

`manifestHash` rules:
- **Order-independent**: the same entries shuffled must hash identically.
  Sort canonically before hashing.
- **Path-sensitive**: `Vol 4/Kicks/x.wav` and `Vol 5/Kicks/x.wav` with identical
  checksums MUST hash differently.
- Hash over raw UTF-8 bytes of `relativePath` + size + checksum. Never
  normalize, case-fold or trim a path (Rule 1; NFC and NFD are DIFFERENT).

`checkManifest` behaviour:
1. `userId` from verified claims only (401 if absent).
2. Body: `{ folderName: string, entries: ManifestEntry[] }`. Validate every
   `relativePath`; reject the WHOLE request 400 if any fails, or if `entries`
   is empty, or if any `sizeBytes` is negative/non-finite, or any `checksum` is
   empty. Duplicate identical `relativePath` values within one manifest → 400
   (same reasoning as the files handler: a real filesystem cannot hold two
   files at one path).
3. Compute the hash. If a `ManifestRecord` exists for it → `exact`.
4. Otherwise look for a stored manifest with the same `folderName`. If one
   exists, diff by `(relativePath, checksum)` pairs: entries absent from the
   stored manifest are `newFiles` → `partial` with `existingCount` and
   `newBytes`. If a file exists at the same path but with a DIFFERENT checksum,
   it counts as a new file (the content changed) — say so in a comment.
5. Otherwise → `none`.
6. **Return 200 with the result. Authorize NO upload, touch NO S3, write NO
   file records.** This endpoint is read-only apart from nothing at all.

Steps (TDD — test first, watch it fail, then implement):
1. `test/manifest-hash.test.ts`: order-independence (shuffled entries hash
   equal); path-sensitivity (same checksum, different pack → different hash);
   size-sensitivity; NFC vs NFD paths hash DIFFERENTLY; a 1,850-entry manifest
   hashes deterministically across repeated calls.
2. `test/check-manifest.test.ts`: exact match returns counts and bytes;
   **1,847 of 1,850 returns `partial` with exactly the 3 new entries and
   correct `newBytes`**; unseen manifest returns `none`; two packs with
   byte-identical files at different paths do NOT match each other; a
   same-path-different-checksum entry counts as new; another user's manifest is
   never matched (tenancy); missing `sub` → 401; bad path / empty entries /
   duplicate path → 400; and assert the handler performs **no S3 call and no
   write** (the repo is a `MemoryManifestRepository` — assert `putManifest` was
   never invoked during a check).
3. Per **AFR-004**, at least one test must exercise **two separate calls against
   the same repository** — e.g. store a manifest, then check a superset of it
   and get `partial`, then check the identical manifest again and still get
   `exact` (stable across calls).
4. Run `npx vitest run services/handlers/manifest` — confirm RED, record why.
5. Implement.
6. Run again — green. Then `npx vitest run` (whole repo) — confirm the 78
   existing tests still pass. Then `npm run typecheck` — must exit 0.
7. Paste REAL output for RED, GREEN, whole-repo, and typecheck.

Acceptance Criteria: all new tests green; 78 pre-existing tests unbroken;
`npm run typecheck` exit 0; the no-write assertion explicitly passing.

Effort Budget: 60 tool calls. If exceeded, stop and report `partial`.

Relevant Standing Rules (verbatim):
- Rule 1: Never reorganize a user's library. Paths are byte-identical; never
  normalize, case-fold or trim. NFC and NFD are DIFFERENT paths.
- Rule 2: File, Folder and Stash are three DIFFERENT concepts. A Manifest
  describes a folder's contents at one ingestion event; it does not replace
  either.
- Rule 3: **A checksum match is never an identity match.** This is the rule
  this task is most likely to violate. Two byte-identical files in different
  packs are two assets. Duplicate DETECTION may report a match; it must never
  delete, repoint, merge or dedupe anything. This endpoint only reports.
- Rule 7: `user_id` ONLY from verified JWT claims. Never body/query/path.
  Missing `sub` → 401.
- Rule 9: Payload bytes never transit the control plane — this handler must
  make no S3 call at all.
- Rule 12: Never write AWS credentials anywhere; never `cat` the `.env`.
- AFR-004: entity identity must be stable across invocations, and any test
  proving an invariant must exercise at least two calls against one repository.

**The failure mode that matters most:** a FALSE POSITIVE. Wrongly telling a
creator "you already have this folder" can make them cancel a Stash and lose
files that were never actually uploaded. When in doubt, report LESS certainty
(`partial` or `none`), never more.

NOTE: the `Write` tool may be blocked ("parent bg session hasn't isolated yet");
use Bash heredocs. Expected — do not escalate. Docker is not running and there
is no Java; do not attempt DynamoDB Local.

Working directory: `/mnt/c/Users/Bot/Desktop/stash`
Host Evidence: host=claude-code; subagent=stash-task-F2-manifest.

Escalate, don't improvise, when: an unexpected dependency; a file the brief
didn't list needing changes; a conflicting or already-modified file; an
ambiguous requirement supporting two implementations; a missing tool,
credential or environment piece (other than Docker/Write, covered above); a
test failing for a reason unrelated to this task; or the Effort Budget
exceeded with the task incomplete. Report `blocked` with exactly what was found.
