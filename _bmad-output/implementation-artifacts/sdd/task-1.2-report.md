# Task 1.2 Report — React shell and auth/Files migration

**Result:** Implemented with scoped deviations recorded below.

## Exact implementation files

### Task 1.2 implementation additions/changes
- `desktop/apps/stash-desktop/ui/src/main.tsx` — generated React entry and stylesheet import.
- `ui/src/app/App.tsx` — gateway bootstrap, Rust restore transition, signed-in shell/sign-out transition.
- `ui/src/domain/types.ts` — serializable auth, child, usage, mount, path, and sort DTOs.
- `ui/src/state/authMachine.ts` — restoring/welcome/sign-in/NEW_PASSWORD_REQUIRED/signed-in reducer transitions.
- `ui/src/platform/contracts.ts` — shared desktop gateway port.
- `ui/src/platform/tauri/gateway.ts` — sole Tauri global/invoke owner, command allowlist, argument validation, DTO validation, bounded safe errors, unavailable adapter.
- `ui/src/components/TitleBar.tsx` — custom drag region and accessible native window controls.
- `ui/src/components/WelcomeScreen.tsx` — welcome, sign-in, local required-field validation, remember checkbox default-off, temporary-password handoff, safe errors, placeholder account creation.
- `ui/src/components/NavigationRail.tsx` — approved exact nav labels, persistent `+ Stash it`, persistent search entry, usage/mount/account surfaces.
- `ui/src/components/FilesScreen.tsx` — `list_children`, breadcrumbs from returned folder IDs, File/Folder distinction, sorting, keyboard selection/details, loading/empty/error/retry, `mount_status`, mount/unmount.
- `ui/src/components/Shell.tsx` — authenticated Files route and truthful planned/unavailable states.
- `ui/src/styles.css` — approved semantic light/dark tokens, focus rings, compact responsive layout, reduced-motion treatment.
- `ui/src/assets.d.ts`, `ui/vite.config.ts`, `ui/package.json` — CSS/asset typing, approved assets copied into generated output, isolated test glob.
- `ui/test/foundation.test.mjs`, `ui/test/migration.test.mjs` — React entry, auth, gateway allowlist/shape, Files, shell, and generated CSS parity tests.
- `desktop/apps/stash-desktop/src-tauri/tauri.conf.json` — `build.frontendDist` changed from `../ui` to `../ui/dist`; CSP/window/capabilities unchanged.
- `desktop/apps/stash-desktop/tests/welcome-contract.test.mjs`, `post-signin-contract.test.mjs` — generated-entry assertions; legacy parity/security assertions retained.
- `desktop/apps/stash-desktop/README.md` — clean-checkout UI build-before-Tauri command documented.

### Preserved migration reference/pre-existing files
Legacy `ui/index.html`, `welcome.js`, `post-signin.js`, `styles.css`, and existing brand assets remain intact. The existing package lock, Task 1.1 foundation files, Rust/auth changes, UX changes, and unrelated worktree artifacts were preserved; no backend command implementation or AWS infrastructure was modified by this task.

## Migration decisions
- Files is the authenticated landing route because it is the only live post-sign-in screen; all other rail items show an explicit planned/unavailable state.
- `+ Stash it` and search remain persistent entry points but do not invent picker/search endpoints.
- The temporary-password challenge session is held only in the gateway's ephemeral private closure long enough to call the existing Rust command; React receives no session and no browser storage is used. Password input is uncontrolled and never persisted.
- Tauri responses are checked at the gateway boundary; folder IDs are validated before IPC using the same safe character/length contract as Rust.
- Generated Vite output is `ui/dist`; approved copied wordmarks are loaded from the generated root asset paths.
- The README’s `npm --prefix desktop/apps/stash-desktop/ui ci` then `run build` sequence is the documented clean-checkout Tauri build hook/equivalent. `cargo tauri dev` was intentionally not run.

## Dependencies
Exact existing pins retained; no new dependency added:
- `react` / `react-dom`: `19.3.0`
- `@types/react` / `@types/react-dom`: `19.3.0`
- `@vitejs/plugin-react`: `6.1.1`
- `typescript`: `7.0.2`
- `vite`: `8.3.0`

## Validation
- `npm test` from `desktop/apps/stash-desktop/ui`: **7 passed**.
- `npm run typecheck`: **passed**.
- `npm run build`: **passed**, generated `dist/index.html`, CSS, JS, and wordmark assets.
- `node --test tests/welcome-contract.test.mjs tests/post-signin-contract.test.mjs`: **22 passed** after generated-entry update.
- `cargo check --manifest-path desktop/Cargo.toml -p stash-desktop`: **passed**.
- `git diff --check`: **exit 0**; only existing LF/CRLF conversion warnings were reported.

## Unresolved capabilities and deviations
- Home summaries, Search, Stash It ingestion/picker/transfer, Recent Stashes, Offline/cache, Transfers, Settings, Devices, browser-native picker, and full nested/read-write backend integrations are **not implemented** and are visibly unavailable/planned.
- Current Rust mount remains its existing root-level committed-file, read-only, process-local WinFsp implementation; the UI does not claim full hierarchy or durable drive integration.
- The existing Rust `auth.rs` error mapper still contains a pre-existing account-enumerating `UserNotFoundException` branch and raw fallback debug path. Task 1.2 did not modify backend code per the user’s explicit constraint; the React gateway normalizes common account/provider errors before display. A backend-owned follow-up remains required for complete non-enumerating auth semantics.
- Existing desktop tests still retain legacy static DOM/script checks as migration reference; generated-entry tests now assert the actual Tauri-loaded entry. Full React runtime DOM integration and Task 1.3 property-based coverage remain future work.

## Reviewed Task 1.2 repair — 2026-09-17

The reviewed migration issues were repaired without changing Rust/backend code, vendored tooling, AWS, `.kiro/specs`, or unrelated worktree changes.

### Repair
- Moved the Cognito challenge session entirely into the closure-owned Tauri gateway. React `AuthOutcome`, reducer state/events, Welcome props, and adapter contracts no longer contain a session. `signIn` stores the opaque native response privately and returns only `{ outcome: "NewPasswordRequired", username }`; `completeNewPassword(username, newPassword, remember)` retrieves it internally while preserving the native IPC argument keys/order. Pending challenge data is cleared on sign-in failure, completion failure/success, explicit back/reset, sign-out, and restore transitions. No browser storage is used.
- Rebuilt `list_children` DTOs from an allowlist. Only safe entity-specific IDs, name, sizeBytes, state, and originalRelativePath are emitted; malformed records are filtered and object keys, URLs, hashes/checksums, tokens, index keys, metadata, and unknown properties cannot cross into Files.
- Added typed `CapabilityState<T>` loading/ready/stale/offline/unavailable states. Usage failures now render `Storage unavailable`; mount-status failures render `Mount unavailable` with inline retry actions in both the navigation rail and Files view. New unavailable/planned states use inline live regions instead of browser alerts.
- Added visual-order sign-in validation through `firstInvalidSignInField`: username is focused first when empty, otherwise password.

### Exact repair files
- `desktop/apps/stash-desktop/ui/src/domain/types.ts`
- `desktop/apps/stash-desktop/ui/src/platform/contracts.ts`
- `desktop/apps/stash-desktop/ui/src/platform/tauri/gateway.ts`
- `desktop/apps/stash-desktop/ui/src/state/authMachine.ts`
- `desktop/apps/stash-desktop/ui/src/components/WelcomeScreen.tsx`
- `desktop/apps/stash-desktop/ui/src/components/FilesScreen.tsx`
- `desktop/apps/stash-desktop/ui/src/components/Shell.tsx`
- `desktop/apps/stash-desktop/ui/src/components/NavigationRail.tsx`
- `desktop/apps/stash-desktop/ui/src/app/App.tsx`
- `desktop/apps/stash-desktop/ui/src/styles.css`
- `desktop/apps/stash-desktop/ui/package.json`
- `desktop/apps/stash-desktop/ui/.gitignore`
- `desktop/apps/stash-desktop/ui/test/migration.test.mjs`
- `desktop/apps/stash-desktop/ui/test/gateway-runtime-entry.ts`
- `desktop/apps/stash-desktop/ui/test/gateway-runtime.test.mjs`
- `desktop/apps/stash-desktop/ui/test/gateway-runtime.vite.config.ts`
- `_bmad-output/implementation-artifacts/sdd/task-1.2-report.md`
- `_bmad-output/implementation-artifacts/sdd/task-1.2-reviewer-verdict.md`
- `_bmad-output/implementation-artifacts/sdd/progress.md`

### Validation
- UI `npm test`: **9 passed**, including a Vite-built gateway boundary test with fake invoke responses, malformed children, secret-bearing child fields, private challenge-session assertions, and focus-order assertions.
- UI `npm run typecheck`: **passed**.
- UI `npm run build`: **passed**; generated React distribution contains JS/CSS.
- Desktop Node contracts: **22 passed**.
- `cargo check --manifest-path desktop/Cargo.toml -p stash-desktop`: **passed** on the isolated rerun; the first parallel invocation returned `-1` without diagnostics while waiting on the Cargo build lock.
- `git diff --check`: **passed** with existing line-ending conversion warnings only.

### Remaining deviations
This repair does not claim Home, Search, Stash It ingestion, Recent Stashes, Offline snapshots, Transfers, Settings, Devices, full nested/read-write backend integration, or full product capabilities. Offline/stale states are typed and honest; the current build does not fabricate snapshots or endpoints. Task 1.3 property-based coverage remains out of scope. The pre-existing Rust account-enumeration/raw-debug mapper remains unchanged because backend/Rust edits were prohibited.

## Follow-up repair — repeated NewPasswordRequired public mapping — 2026-09-17

The remaining gateway boundary defect was repaired without changing Rust/backend code, vendored tooling, AWS, `.kiro/specs`, or unrelated worktree changes. `gateway.ts` now separates the internal parsed auth result (which may carry `privateSession`) from `publicAuthOutcome()`, which always constructs exactly `{ outcome: "SignedIn", username }` or `{ outcome: "NewPasswordRequired", username }`. Both `signIn()` and `completeNewPassword()` use the public mapper; the opaque session remains in the gateway closure and the existing `complete_new_password` IPC argument shape is unchanged.

The built gateway boundary scenario now returns a repeated `NewPasswordRequired` response from the first completion, then completes on the next invocation. Its test asserts that the repeated public result contains neither `privateSession` nor `session`, while the next internal IPC call receives `session: "opaque-next-challenge"`.

Exact follow-up files:
- `desktop/apps/stash-desktop/ui/src/platform/tauri/gateway.ts`
- `desktop/apps/stash-desktop/ui/test/gateway-runtime-entry.ts`
- `desktop/apps/stash-desktop/ui/test/gateway-runtime.test.mjs`
- `_bmad-output/implementation-artifacts/sdd/task-1.2-report.md`
- `_bmad-output/implementation-artifacts/sdd/task-1.2-reviewer-verdict.md`
- `_bmad-output/implementation-artifacts/sdd/progress.md`

Follow-up validation:
- UI `npm test`: **9 passed**.
- UI `npm run typecheck`: **passed**.
- UI `npm run build`: **passed**; generated React distribution includes JS/CSS.
- Desktop Node contracts (`node --test tests/welcome-contract.test.mjs tests/post-signin-contract.test.mjs`): **22 passed**.
- `cargo check --manifest-path desktop/Cargo.toml -p stash-desktop`: **passed**; no Rust files were changed.
- `git diff --check`: **exit 0**; only existing LF/CRLF conversion warnings were reported.

This follow-up does not claim Home, Search, Stash It ingestion, Recent Stashes, Offline snapshots, Transfers, Settings, Devices, full product capabilities, or Task 1.3 coverage. Those remain outside Task 1.2 scope.