# Task 1.3 Report — foundation unit/property/contract tests

**Status:** Complete — validated.
**Scope:** The approved STASH Task 1.3 foundation slice, plus the narrowly scoped UI production error-boundary repair requested during review; no backend/native/product capability expansion.

## Files added/updated
- `desktop/apps/stash-desktop/ui/src/platform/tauri/gateway.ts` — narrowly scoped production `safeActionError` sanitizer repair; preserves explicit known Cognito mappings and safe short messages while rejecting credential/session/object-key/URL/authorization/bearer material.
- `desktop/apps/stash-desktop/ui/tests/foundation/foundation.test.ts` — executable foundation properties and fake gateway/CSS/ARIA contracts; repaired exact breadcrumb/root assertions and added representative sanitizer cases.
- `desktop/apps/stash-desktop/ui/src/test/fixtures.ts` — deterministic xorshift32 generator, generated folder trees, immutable presentation sorting, known-ancestor path helpers.
- `desktop/apps/stash-desktop/ui/tests/foundation/raw.d.ts` — test-local Vite `?raw` declaration.
- `desktop/apps/stash-desktop/ui/test/foundation-runtime.vite.config.ts` — builds the TypeScript foundation runtime without a new dependency.
- `desktop/apps/stash-desktop/ui/test/foundation-runtime.test.mjs` — Node built-in runner entry.
- `desktop/apps/stash-desktop/ui/package.json` — adds `build:foundation-test`; `test` now builds both test runtimes before `node --test`.
- `desktop/apps/stash-desktop/ui/tsconfig.json` — includes the test source/config declarations.
- Required SDD evidence files and appended `progress.md`.

## Generated cases and exact properties
- **P1:** 3 auth event sequences plus 3 outcome/focus checks; state validity is checked after every event. Public auth mappings contain no challenge session or credential material.
- **P2:** 4 deterministic seeds (`0x1a2b3c4d`, `0x5eed1234`, `0x7f4a7c15`, `0x13579bdf`), each generating a depth-3/breadth-3 folder tree. Parent/child IDs, File/Folder identity, immutable sorting, folder path append, and known breadcrumb ancestor slicing are checked.
- **P4/P6:** 17 gateway cases across the nine approved command names plus invalid folder input, malformed DTOs, secret-bearing error fallback, public auth secrecy, child sanitization, and unavailable behavior. The gateway is exercised with fake `__TAURI__` invoke/window implementations only.
- **P5:** 33 token/action/accessibility cases: 13 semantic token names checked in both light and dark blocks, focus/reduced-motion rules, three title-bar accessible names, and non-color planned/status/error/sort labeling contracts. No user preference reducer exists, so safe preference/state transitions are explicitly not claimed.

## Validation results
- `npm test` from `desktop/apps/stash-desktop/ui`: **11 passed** — the existing 9 UI tests plus 2 foundation runner tests.
- `npm run typecheck`: **passed**.
- `npm run build`: **passed**; generated React distribution includes JS/CSS.
- `node --test tests/welcome-contract.test.mjs tests/post-signin-contract.test.mjs` from `desktop/apps/stash-desktop`: **22 passed**.
- `cargo check --manifest-path desktop/Cargo.toml -p stash-desktop`: **passed**.
- `git diff --check`: **exit 0**; only pre-existing line-ending conversion warnings were reported.

## Repair details and boundary
The production change and the test-coverage change are distinct:

- **Production sanitizer change:** `ui/src/platform/tauri/gateway.ts` now keeps the existing friendly mappings for `UserNotFoundException`/`NotAuthorizedException` and `InvalidPasswordException`, preserves ordinary short messages, and returns the fallback for raw messages containing sensitive field terms/values, credential or session material, object keys, URLs, authorization headers, bearer values, provider/stack diagnostics, or oversized text. This is a UI error-display boundary only; it does not close the pre-existing Rust mapper deviation, which remains a separate documented backend-policy issue.
- **Test coverage change:** `ui/tests/foundation/foundation.test.ts` now compares `navigateToKnownAncestor(path, index)` exactly with `path.slice(0, index + 1)` for a valid index and checks `[]` for the root case, while retaining generated identity/sorting checks. It also covers password, session, object-key, presigned URL, authorization/bearer, known Cognito mapping, and normal safe-message cases.

All gateway responses and errors in the suite are fake values; no real backend, Tauri runtime, AWS, filesystem, browser network API, or secret was accessed. Tests verify that challenge sessions/credential-like values do not cross the public auth result and that unsafe DTO fields are discarded. The existing desktop contract suite remains intact.

Exact repair files: `desktop/apps/stash-desktop/ui/src/platform/tauri/gateway.ts`, `desktop/apps/stash-desktop/ui/tests/foundation/foundation.test.ts`, `_bmad-output/implementation-artifacts/sdd/task-1.3-report.md`, `_bmad-output/implementation-artifacts/sdd/task-1.3-reviewer-verdict.md`, and appended `_bmad-output/implementation-artifacts/sdd/progress.md`. No Rust/backend, vendored tooling, AWS, `.kiro/specs`, or unrelated worktree files were changed.
This does not claim full React DOM/runtime coverage, full request-ID stale-response semantics (the current Files implementation has a component cancellation guard only), contrast/screen-reader/200% scaling proof, user-selectable theme/reduced-motion preference state, or full Home/Search/Stash It/Recent Stashes/Offline/Transfers/Settings/Devices/product capabilities. No Rust/backend repair was made.
