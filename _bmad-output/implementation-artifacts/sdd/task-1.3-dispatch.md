# Task 1.3 Dispatch

**Task ID:** STASH-TAURI-1.3
**Task:** Add foundation unit/property/contract tests for the migrated React/Tauri UI.
**Dispatch timestamp:** 2026-09-17T14:46:10+05:30
**Host/workspace:** `c:\Users\Bot\Desktop\stash` (Windows PowerShell; repository worktree, no separate branch/worktree).
**Implementer route:** Scoped desktop foundation-test implementation route, using the existing isolated UI package and Node/Vite harness.
**Prior context:** Task 1.1 and Task 1.2 are present in the worktree; their 9 UI tests, gateway runtime harness, 22 desktop contracts, and Rust command boundary are retained.

## Dispatch constraints
- Read and follow `AGENT.md` and the approved Tauri 2 plan.
- Owned test/fixture/config/evidence files only; preserve unrelated pre-existing changes.
- Do not edit Rust/backend code, vendored tooling, AWS, `.kiro/specs`, or product capability code.
- Do not add open-range dependencies. Use Node built-in tests and a deterministic seeded harness.
- Use fake gateway/invoke/window data only; no real backend, Tauri runtime, AWS, filesystem, browser network, or secrets.

## Execution route
1. Map current pure auth functions, gateway boundary, hierarchy presentation behavior, and CSS/ARIA contracts.
2. Add four-seed generated fixtures and Vite-built foundation runtime tests.
3. Run them through `npm test` alongside the existing UI tests.
4. Run UI typecheck/build, desktop Node contracts, Cargo check, and diff check.
5. Produce brief, dispatch, report, reviewer verdict, and progress evidence with explicit limitations.
