# Task 1.3 Brief — foundation unit/property/contract tests

**Task:** Execute only Task 1.3 from the approved STASH Tauri 2 desktop app plan.
**Date:** 2026-09-17
**Dependencies:** Task 1.1 isolated React/Vite UI and Task 1.2 React shell/gateway migration.
**Authority:** `AGENT.md`, the approved `2026-09-17-tauri2-desktop-app-plan.md`, and the reviewed Task 1.2 artifacts.

## Objective
Add deterministic, dependency-free foundation tests for the migrated React/Tauri UI using Node's built-in test runner, a Vite-built TypeScript runtime, and fake gateway/invoke data. Preserve the existing 9 UI tests and 22 desktop Node contracts.

## Owned files
- `desktop/apps/stash-desktop/ui/tests/foundation/foundation.test.ts`
- `desktop/apps/stash-desktop/ui/tests/foundation/raw.d.ts`
- `desktop/apps/stash-desktop/ui/src/test/fixtures.ts`
- `desktop/apps/stash-desktop/ui/test/foundation-runtime.vite.config.ts`
- `desktop/apps/stash-desktop/ui/test/foundation-runtime.test.mjs`
- isolated-package `package.json` test-script addition and `tsconfig.json` test include
- `_bmad-output/implementation-artifacts/sdd/task-1.3-*.md` and appended `progress.md`

No Rust/backend, vendored tooling, AWS, `.kiro/specs`, or unrelated worktree files are in scope.

## Acceptance and properties
- **P1:** table-driven auth reducer sequences preserve valid views; public auth outcome mapping carries only approved fields; remembered challenge preference maps correctly; invalid sign-in focus is deterministic. The current component cancellation guard is not claimed as full request-ID coverage because no request-ID reducer exists yet.
- **P2:** a seeded xorshift32 generator creates four folder trees at depth 3/breadth 3. Generated parent/child IDs remain exact; File and Folder identity is distinct; presentation sorting copies rather than mutates; folder opening appends only the returned location; breadcrumb navigation slices known ancestors and never invents one.
- **P4/P6:** fake `__TAURI__` invoke/window data exercises the live gateway; only the nine approved command names are observed; valid argument trimming and invalid folder-ID rejection are checked before invoke; malformed restore/list/mount DTOs reject; generated child DTOs discard unknown object-key/token fields; public auth results exclude challenge/password material; bounded secret-bearing errors use safe fallback; unavailable/browser behavior is explicit.
- **P5:** semantic light/dark tokens are complete for the current CSS token set; focus-visible and reduced-motion rules remain present; title-bar actions, planned state, status/error state, and sorting controls retain accessible naming/status contracts. Preference state transitions are not claimed because no user-selectable preference reducer exists yet.

## Determinism and dependency policy
Seeds are `0x1a2b3c4d`, `0x5eed1234`, `0x7f4a7c15`, and `0x13579bdf`; the generator uses a local xorshift32 implementation. No dependency was added; the existing exact-pinned Node/Vite/TypeScript toolchain is reused.

## Validation
- UI: `npm test`, `npm run typecheck`, `npm run build` from `desktop/apps/stash-desktop/ui`.
- Desktop contracts: `node --test tests/welcome-contract.test.mjs tests/post-signin-contract.test.mjs`.
- Rust boundary check only: `cargo check --manifest-path desktop/Cargo.toml -p stash-desktop`.
- Hygiene: `git diff --check`.

## Risk and approval notes
This is additive test/config work only. It does not call a real Tauri runtime, backend, AWS, filesystem, browser network API, or secrets, and does not change native command behavior. It does not claim full React DOM, contrast, screen-reader, 200% scaling, or full product capability coverage; those remain integration/product evidence or later plan tasks.
