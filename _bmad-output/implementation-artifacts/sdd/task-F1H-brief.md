# Task Brief: F1 handlers — registerFiles + listChildren + hierarchy proof

Goal: Prove STASH's central promise end to end at the control-plane level —
a folder tree registered through `registerFiles` and read back through
`listChildren` returns **byte-identical**, with opaque S3 keys and no
path rewriting.

Files (exclusive ownership boundary — touching anything else is an escalation):
- `services/shared/tsconfig.json`   ← assigned; Task 5 is complete and its boundary is released. Create ONLY this file there; do not modify any existing `services/shared/**` file.
- `services/handlers/files/package.json`
- `services/handlers/files/tsconfig.json`
- `services/handlers/files/src/types.ts`
- `services/handlers/files/src/repository.ts`
- `services/handlers/files/src/memory-repository.ts`
- `services/handlers/files/src/register-files.ts`
- `services/handlers/files/src/list-children.ts`
- `services/handlers/files/test/register-files.test.ts`
- `services/handlers/files/test/list-children.test.ts`
- `services/handlers/files/test/hierarchy-property.test.ts`
- `services/handlers/files/test/dynamodb-local.test.ts`

Interfaces — CONSUME from `@stash/shared` (already built, do not reimplement):
```ts
userIdFromEvent(event): string          // throws HttpError(401) when sub absent
validateRelativePath(p: string): string // returns input BYTE-IDENTICAL; throws badRequest(400)
objectKey(userId, fileId): string       // `users/${userId}/${fileId}`
badRequest(msg) / notFound(what) / conflict(msg) / quotaExceeded()
logger(correlationId) / idempotencyKeyFromEvent(event)
```
Import via a relative path to `services/shared/src/index.js` (the workspace is
ESM/NodeNext; Task 5's tests import siblings as `../src/x.js`).

Interfaces — PRODUCE exactly:
```ts
export interface RegisterFileInput { relativePath: string; sizeBytes: number; checksum: string; }
export interface FolderRecord {
  pk: string; sk: string; entity: "FOLDER"; folderId: string; name: string;
  parentFolderId: string | null; relativePath: string;
  gsi1pk: string; gsi1sk: string;
}
export interface FileRecord {
  pk: string; sk: string; entity: "FILE"; fileId: string; stashId: string;
  name: string; parentFolderId: string; originalRelativePath: string;
  sizeBytes: number; checksum: string; objectKey: string;
  state: "pending" | "uploading" | "committed" | "failed";
  searchTokens: string[];            // MUST be [] — reserved for the later search scope
  extractedMetadata: Record<string, unknown>;  // MUST be {} — reserved
  gsi1pk: string; gsi1sk: string; gsi2pk: string; gsi2sk: string; gsi3pk: string;
}
export interface Repository {
  putEntities(items: Array<FolderRecord | FileRecord>): Promise<void>;
  listChildren(userId: string, parentFolderId: string | null): Promise<Array<FolderRecord | FileRecord>>;
}
export class MemoryRepository implements Repository { ... }
export function registerFiles(deps: { repo: Repository }): (event: any) => Promise<{ statusCode: number; body: string }>;
export function listChildren(deps: { repo: Repository }): (event: any) => Promise<{ statusCode: number; body: string }>;
```
Key construction (exact):
- `pk = USER#<userId>` for every item
- Folder `sk = FOLDER#<folderId>`; File `sk = FILE#<fileId>`
- `gsi1pk = USER#<userId>#PARENT#<parentFolderId ?? "ROOT">`, `gsi1sk = <name>`
- `gsi2pk = USER#<userId>#STASH#<stashId>`, `gsi2sk = FILE#<fileId>`
- `gsi3pk = USER#<userId>#SUM#<checksum>`
- File `objectKey = objectKey(userId, fileId)` — opaque UUID, NEVER the path

Behaviour of `registerFiles`:
1. `userId` from claims only. Body carries `{ stashId, files: RegisterFileInput[] }`.
2. Validate EVERY `relativePath` with `validateRelativePath` before writing
   anything. If any one fails, reject the WHOLE batch with 400 and write
   nothing (partial acceptance is forbidden).
3. Derive the folder chain from each path by splitting on `/`. Create one
   `FolderRecord` per distinct directory, reusing folders already created in
   the same call. `relativePath` on a folder is its own full path prefix,
   byte-identical to the corresponding slice of the input.
4. Files get `state: "pending"`, `searchTokens: []`, `extractedMetadata: {}`.
5. Return 201 with the created `fileId`s.

Behaviour of `listChildren`: `userId` from claims; reads
`parentFolderId` from the path parameter (`"ROOT"` or absent means top level);
returns children sorted by `name` ascending.

Steps (TDD — test first, watch it fail, then implement):
1. Write `test/register-files.test.ts`: a 3-level tree creates the right
   folder chain with correct `parentFolderId` links; `originalRelativePath` is
   byte-identical to input; returned `objectKey` matches `users/<uid>/<uuid>`
   and contains NO part of the original filename; a batch containing one bad
   path (`../escape.wav`) is rejected 400 with NOTHING written; a body
   `user_id` is ignored in favour of the claim.
2. Write `test/list-children.test.ts`: children returned sorted by name; a
   nested folder's children are reachable by its `folderId`; another user's
   `pk` is never returned.
3. Write `test/hierarchy-property.test.ts` — **the proof of F1**: generate at
   least 200 random folder trees (depth 1–5, 1–12 files each, names drawn from
   ASCII, spaces, `#`, `&`, `'`, CJK, emoji, and 200-char names), register each
   through `registerFiles` against `MemoryRepository`, then reconstruct the
   full set of file paths by walking `listChildren` recursively from ROOT and
   joining names with `/`. Assert the reconstructed set is **exactly equal**
   to the input set, compared as UTF-8 bytes. Assert the generated case count
   is >= 200 so the test cannot pass vacuously.
4. Write `test/dynamodb-local.test.ts`: the same round-trip against real
   DynamoDB Local. **Docker is installed but NOT running in this environment
   and there is no Java**, so this test MUST detect that and `describe.skip`
   with an explicit reason string naming the missing prerequisite — it must
   never silently pass. Do not attempt to start Docker.
5. Run `npx vitest run services/handlers/files` — confirm RED, record why.
6. Implement the source files.
7. Run again — confirm green, and confirm the dynamodb-local suite reports as
   SKIPPED with its reason, not passed.
8. Run `npx vitest run` (whole repo) — confirm no existing test regressed.
9. Verification: paste the real output of steps 5, 7 and 8.

Acceptance Criteria: all new tests green; the property test reports >= 200
generated cases; the DynamoDB-Local suite reports skipped-with-reason; the
full repo suite still passes (32 existing tests + yours). Paste REAL output.

Effort Budget: 60 tool calls.

Relevant Standing Rules (verbatim):
- Rule 1: Never reorganize a user's library. `originalRelativePath` is stored
  verbatim; no renaming, flattening, categorizing, moving, or unicode
  normalization. Task 5 proved NFD vs NFC matters — macOS hands out NFD and
  Windows NFC, so any normalization silently corrupts cross-platform libraries.
- Rule 2: File, Folder and Stash are three DIFFERENT concepts. A Stash is
  metadata about one ingestion event; it never replaces folders. Keep them as
  separate entities.
- Rule 3: A checksum match is never an identity match. Two byte-identical
  files at different paths remain two assets with two `fileId`s and two keys.
  `gsi3pk` exists for DETECTION only — never dedupe, delete or repoint.
- Rule 6: S3 keys are `users/<user_id>/<file_id>`, opaque IDs only.
- Rule 7: `user_id` ONLY from verified JWT claims — never body, query or path.
- Rule 12: Never write AWS credentials anywhere; never `cat` the `.env`.
- Task 5 review decision: a missing `sub` claim throws **401**, not 400.
  Assert 401 for that case.

Note on tooling: the `Write` tool may be blocked in this session
("parent bg session hasn't isolated yet"). If so, write files with Bash
heredocs — Task 5 did exactly this successfully. This is expected, not a
blocker worth escalating.

Working directory: `/mnt/c/Users/Bot/Desktop/stash`
Host Evidence: host=claude-code; subagent=stash-task-F1H-files.

Escalate, don't improvise, when: an unexpected dependency the brief didn't
mention; a file the brief didn't list needing changes; a conflicting or
already-modified file; a requirement ambiguous enough to support two
implementations; a missing tool, credential or environment piece (other than
Docker/Write, both covered above); a test failing for a reason unrelated to
this task; or the Effort Budget exceeded with the task still incomplete.
Report status `blocked` with exactly what was found — improvising past any of
them is scope creep even when it would probably work.
