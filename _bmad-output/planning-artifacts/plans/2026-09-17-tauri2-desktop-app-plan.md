# STASH Tauri 2 Desktop App — Implementation Plan

**Date:** 2026-09-17  
**Status:** Ready for implementation sequencing; implementation has not started  
**Authorities:** `AGENT.md` (project contract and execution evidence), `STASH_PRD_v0.1.md` (product scope), `_bmad-output/planning-artifacts/ux-designs/ux-stash-2026-09-16/DESIGN.md` (visual/design system), `_bmad-output/planning-artifacts/ux-designs/ux-stash-2026-09-16/EXPERIENCE.md` (screen and interaction contract)  
**Starting point:** `desktop/apps/stash-desktop/` existing Tauri shell and Rust IPC surface

## 1. Objective

Build the Windows-first STASH management desktop app on Tauri 2 with a React + TypeScript shared UI layer that is usable by a future browser build. Preserve the existing Rust-owned authentication, control-plane calls, session storage, read-only WinFsp boundary, and direct-transfer boundary. Incrementally move from the current Welcome / sign-in plus metadata-only browser to the approved fourteen-screen experience, while showing explicit unavailable, offline, pending, and recovery states whenever a real backend or native capability is not yet present.

The first implementation slice must establish the React/Tauri UI foundation and reproduce the approved visual shell: title bar, STASH wordmark, navigation rail, persistent `+ Stash it`, search entry point, storage usage, mount state, light/dark tokens, focus behavior, and Welcome/sign-in transition. Later slices add the approved screens and state contracts without creating a second filesystem hierarchy or a second native boundary.

## 2. Scope

### In scope

- Isolated React + TypeScript frontend package under `desktop/apps/stash-desktop/ui/`, built into the Tauri frontend distribution.
- Shared domain types, reducers/state machines, components, semantic design tokens, accessibility behavior, and deterministic screen rendering.
- A single Tauri IPC gateway in the UI; UI code does not call Cognito, AWS, HTTP, WinFsp, filesystem APIs, or cache APIs directly.
- Platform adapter interfaces separating desktop-only filesystem, mount, local-cache, native picker, drag/drop, open/reveal, and browser-unavailable behavior.
- Adapter implementations for currently available Rust IPC commands and explicit unavailable results for capabilities not implemented by the current backend/native boundary.
- Migration of Welcome/sign-in and the existing post-sign-in Files browser into the shared React shell without changing the established auth/session security contract.
- Incremental UI/state slices for Home, Files, Search, Stash It, transfer progress/recovery, duplicate-folder warning, Asset details/preview, Recent Stashes, Storage & cache usage, Devices, Settings, and Offline/pinned assets.
- Deterministic search presentation and filter state; search implementation remains behind a control-plane adapter and does not add an LLM.
- Automated unit, property-based, contract, accessibility-oriented, and integration tests for the shared UI and IPC boundary.
- Evidence-gated task execution and final combined integration review per `AGENT.md`.

### Explicit non-goals

- Do not add or infer new backend/API endpoints. Existing Rust commands (`sign_in`, `complete_new_password`, `restore_session`, `sign_out`, `list_children`, `get_usage`, `mount_status`, `mount_stash`, `unmount_stash`) are the only live contracts until a separate backend contract is approved and implemented.
- Do not move payload bytes through the webview, React state, API Gateway, or Lambda. Direct object transfer and short-lived lease handling remain outside the UI.
- Do not expose Cognito tokens, refresh material, object keys, presigned URLs, credentials, or raw payload bytes to TypeScript or logs.
- Do not reorganize, rename, flatten, categorize, merge, or move creator content. `original_relative_path` is display/provenance data, not a UI-owned hierarchy.
- Do not treat a checksum match as an identity match, merge duplicate assets, or silently choose an ambiguous same-name folder.
- Do not rewrite the current WinFsp implementation or claim that the present flat, read-only root mount is a complete hierarchical mounted-drive implementation.
- Do not implement account creation until product resolves whether it is in private-beta scope; retain the current placeholder state until then.
- Do not choose preview codecs, full Devices management, Transfers presentation mode, offline eviction semantics, cloud deletion semantics, or final font/icon licensing without the product decisions listed in §11.
- Do not add LLM/conversational search, semantic ranking, vendor-specific creative-app integrations, deployment work, production AWS mutations, or manual-only acceptance tasks to the implementation task list.
- Do not edit vendored tooling under `_bmad/`, `.agent/skills/`, `.agents/skills/`, `.claude/skills/bmad-*`, or `.github/agents/`.

## 3. Current-state baseline

### Existing desktop structure

- `desktop/Cargo.toml` is a Rust workspace containing `stash-core`, `stash-windows-fs`, `stash-s3-provider`, `mount-spike`, and `apps/stash-desktop/src-tauri`.
- `desktop/apps/stash-desktop/src-tauri/` is a Tauri 2 application with `tauri.conf.json`, `capabilities/default.json`, and Rust modules `auth.rs`, `api.rs`, and `mount.rs`.
- `tauri.conf.json` currently points `frontendDist` at `../ui`, uses one undecorated resizable window, and permits only the custom title-bar window actions in the capability file.
- `build.rs` links WinFsp delay-load support and runs `tauri_build`.

### Existing UI and live command surface

- `ui/index.html`, `ui/styles.css`, `ui/welcome.js`, and `ui/post-signin.js` form a static HTML/CSS/JS UI. There is no React component tree, TypeScript frontend package, frontend build config, or shared adapter layer today.
- Welcome/sign-in is Rust-owned through Cognito SRP IPC. Remembered sessions use Windows Credential Manager from Rust; the webview receives only outcome/user data.
- Post-sign-in Files currently lists metadata via `list_children`, displays breadcrumbs, sorting, selection details, usage, and a mount control. It identifies File and Folder separately.
- The current mount is read-only, uses `STASH (S:)`, and exposes committed root-level files only. It is not a complete nested hierarchy or write-through mounted drive.
- `api.rs` validates a safe folder ID before calling the existing control plane. It owns the authenticated request and redacts unstructured HTTP errors. `mount.rs` reads the process-local ID token and keeps lease/payload work in Rust/native code.
- The UI contract tests are Node tests: `desktop/apps/stash-desktop/tests/welcome-contract.test.mjs` and `post-signin-contract.test.mjs`. Rust tests cover the current workspace crates. The root `npm run typecheck` and `npm test` are AWS/TypeScript workspace gates, not current desktop UI gates.

### Baseline validation commands

Run before the first implementation task and preserve the result as the baseline report:

```powershell
node --test desktop/apps/stash-desktop/tests/welcome-contract.test.mjs
node --test desktop/apps/stash-desktop/tests/post-signin-contract.test.mjs
cargo test --manifest-path desktop/Cargo.toml
cargo check --manifest-path desktop/Cargo.toml -p stash-desktop
```

The frontend package must add its own pinned, isolated commands rather than silently depending on the root infrastructure package. Any dependency addition requires the project’s normal review and exact version pinning; no dependency is being added by this plan artifact.

## 4. Target architecture and interfaces

### 4.1 Package boundaries

```text
desktop/apps/stash-desktop/
├── ui/
│   ├── index.html                         # Vite entry document
│   ├── package.json / package-lock.json   # isolated UI dependencies and scripts
│   ├── tsconfig.json / vite.config.ts
│   ├── public/assets/                     # approved copied brand assets only
│   ├── src/
│   │   ├── app/                           # shell, routing, session bootstrap
│   │   ├── domain/                        # serializable UI/domain types
│   │   ├── state/                         # reducers/state machines/selectors
│   │   ├── components/                    # shared accessible primitives
│   │   ├── screens/                       # approved screen compositions
│   │   ├── platform/                      # capability and control-plane ports
│   │   │   ├── browser/
│   │   │   └── tauri/
│   │   ├── theme/                         # semantic tokens and theme behavior
│   │   └── test/                          # test fixtures and test adapters
│   └── tests/                              # Vitest + property/contract tests
└── src-tauri/
    ├── src/                               # existing Rust boundary; extend only by contract
    ├── capabilities/default.json
    └── tauri.conf.json
```

The exact file split may be adjusted by the implementation agent, but every task below names its owned files and must not spread Tauri imports into shared components. The compiled frontend output is generated and must not be hand-edited or committed unless the repository’s existing build convention requires it.

### 4.2 Shared domain contract

Define serializable, UI-safe types for:

- `EntityKind`: `File`, `Folder`, and `Stash` remain distinct.
- `AssetRecord`: display name, `originalRelativePath`, type, size, timestamps/status, `stashId`, and provenance; no object key or token fields.
- `FolderLocation`: stable folder ID, exact display name, parent location, and breadcrumb ancestors. A location is a view into the existing hierarchy, never a generated category.
- `SearchQuery` and structured filters supported by the product; keep lexical/deterministic semantics explicit.
- `TransferPhase`: `Queued`, `Preparing`, `Stashing`, `Verifying`, `Stashed`, `NeedsAttention`, `Paused`, `Canceled`, and `OfflinePaused`, with verified item/result counts.
- `CapabilityState`: `Available`, `Unavailable`, `Offline`, `Busy`, `Stale`, and `Error`, carrying safe user-facing recovery information.
- Theme and accessibility preferences: Light, Dark, System, reduced motion, and text/layout-safe behavior.

No domain type may carry raw payload bytes, credentials, ID/refresh tokens, presigned URLs, or opaque object keys.

### 4.3 Adapter interfaces

The shared UI depends on ports, not Tauri or browser globals:

```ts
interface ControlPlanePort {
  restoreSession(): Promise<SafeSessionOutcome>;
  signIn(input: SignInInput): Promise<SafeAuthOutcome>;
  completeNewPassword(input: NewPasswordInput): Promise<SafeAuthOutcome>;
  signOut(): Promise<void>;
  listChildren(location: FolderLocation): Promise<FolderListingResult>;
  getUsage(): Promise<UsageResult>;
  // Future operations stay explicit and unavailable until backend contracts exist.
  search(query: SearchQuery): Promise<CapabilityResult<SearchResultPage>>;
  getRecentStashes(): Promise<CapabilityResult<StashSummary[]>>;
  getTransfer(id: string): Promise<CapabilityResult<TransferRecord>>;
}

interface DesktopCapabilityPort {
  pickSources(): Promise<CapabilityResult<SourceSelection>>;
  getMountStatus(): Promise<MountStatus>;
  mount(): Promise<MountStatus>;
  unmount(): Promise<MountStatus>;
  getCacheUsage(): Promise<CapabilityResult<CacheUsage>>;
  listOfflineAssets(): Promise<CapabilityResult<OfflineAsset[]>>;
  pin(assetId: string): Promise<CapabilityResult<void>>;
  unpin(assetId: string): Promise<CapabilityResult<void>>;
  freeUpSpace(assetId: string): Promise<CapabilityResult<void>>;
  openOrReveal(asset: AssetRecord): Promise<CapabilityResult<void>>;
}
```

These are planning interfaces, not claims that all methods already exist. The initial Tauri implementation maps only to live commands. Unsupported methods return a typed `Unavailable` result with a concrete next step; they must not be simulated as successful. The future browser adapter uses the same port and returns browser-appropriate unavailable states for desktop-only features.

### 4.4 Tauri IPC gateway

Create one small Tauri implementation that owns all `window.__TAURI__`/`invoke` access. It must:

- allowlist command names and validate route/input shapes before invoking;
- map Rust errors to bounded, non-secret UI errors;
- serialize only approved DTOs;
- never expose a token, secret, object key, presigned URL, payload bytes, or raw backend response;
- contain no UI rendering or navigation logic;
- make it possible to test the shared UI with a fake port without Tauri.

Rust command expansion is a separate contract-driven task. Do not add commands merely because a screen exists. New commands require an approved backend/native interface, safe DTOs, Rust tests, capability review, and updated Tauri permissions only when needed.

### 4.5 State ownership and navigation

Use a single typed application state/reducer boundary for session, active screen, folder location, search, transfers, theme/accessibility, mount/cache capability state, and selected entity. Async effects dispatch request/success/failure events with request IDs so stale responses cannot overwrite a newer folder or search selection. Components render state and dispatch intent; they do not mutate hierarchy or call adapters directly.

Navigation state stores stable IDs and exact source paths. Breadcrumbs are derived only from known ancestors returned by the control-plane port. Sorting changes presentation order only. Search results retain `originalRelativePath` and Stash provenance. A Stash is shown as an ingestion event/history record, not as a Folder.

## 5. Phased implementation plan

Tasks are prompts for a code-generation agent. Each prompt must build on earlier work, integrate its output into the running app, and leave no orphaned component, state module, or adapter. Testing sub-tasks are optional and marked `*`; core implementation tasks are required. Before dispatch, the controller must create the task brief and then follow the evidence gate in §8.

### Phase 0 — Baseline and frontend foundation

#### 1.1 Create the isolated React + TypeScript frontend build

- **Depends on:** Baseline commands in §3; no application dependency beyond the current `ui/` static entry.
- **Task-owned files:** `desktop/apps/stash-desktop/ui/package.json`, `package-lock.json`, `tsconfig.json`, `vite.config.ts`, `index.html`, `src/main.tsx`, `src/app/App.tsx`, `src/domain/` initial type files; `desktop/apps/stash-desktop/src-tauri/tauri.conf.json` only to point `frontendDist` at the built UI output if required.
- **Prompt:** Establish a pinned, isolated React + TypeScript build that emits the Tauri frontend distribution. Preserve the existing Tauri window and CSP. Keep shared code browser-compatible and keep native access out of React components. Add a minimal typed app entry and a deterministic test/build script.
- **Acceptance:** `npm --prefix desktop/apps/stash-desktop/ui run typecheck` and `run build` work; the Tauri config consumes the generated output; no source files under `_bmad/` or vendored agent directories change.

#### 1.2 Reproduce the approved visual shell and Welcome/sign-in transition

- **Depends on:** 1.1.
- **Task-owned files:** `ui/src/app/` shell/session files, `ui/src/components/` shell primitives, `ui/src/screens/WelcomeScreen.tsx`, `ui/src/theme/`, `ui/src/styles/`, `ui/public/assets/` approved wordmarks, and the UI test files covering the slice.
- **Prompt:** Reproduce the existing custom title bar and approved `DESIGN.md` shell in React: STASH wordmark, accessible native window controls through the Tauri adapter, navigation labels, `+ Stash it`, `Search your STASH...`, usage indicator, mount status, and Welcome/sign-in states. Preserve the existing remember-device semantics and Rust-only auth. Keep `Create account` as an explicit placeholder until resolved.
- **Acceptance:** Existing welcome security/contract behavior remains covered; shell is usable with keyboard, focus rings, light/dark modes, compact window sizing, and reduced motion; no direct network/native calls occur in components.

#### 1.3* Add foundation unit/property/contract tests

- **Depends on:** 1.1 and 1.2.
- **Task-owned files:** `ui/tests/foundation/*.test.ts`, `ui/src/test/fixtures.ts`, and any frontend test configuration owned by the isolated package.
- **Prompt:** Add deterministic unit and property tests for shell state, safe auth outcomes, theme token selection, and IPC allowlisting. Preserve the existing Node contract tests until their coverage is intentionally migrated and verified.
- **Properties:** P1, P5, and P6 in §6.

#### Checkpoint A

Run the frontend typecheck/build and existing Node/Rust tests. Confirm the visual shell is a replacement of the current static entry, not a second parallel app. Stop for review if dependency choice, asset licensing, CSP, or sign-in behavior changes.

### Phase 1 — Adapter seams and Files/Home foundation

#### 2.1 Implement shared ports, safe DTOs, and Tauri/browser adapters

- **Depends on:** 1.1 and 1.2.
- **Task-owned files:** `ui/src/platform/contracts.ts`, `ui/src/platform/tauri/tauriIpc.ts`, `ui/src/platform/tauri/controlPlaneAdapter.ts`, `ui/src/platform/tauri/desktopCapabilityAdapter.ts`, `ui/src/platform/browser/browserAdapters.ts`, `ui/src/domain/` DTO/result files, and adapter unit tests.
- **Prompt:** Implement the typed ports in §4.3. Map only the existing Rust command surface to live behavior. Add typed `Unavailable` results for future search, Stash creation, transfers, cache, offline, and device operations where no live contract exists. Ensure all calls go through one IPC gateway and return bounded safe errors.
- **Acceptance:** Shared UI imports ports only; only the Tauri adapter imports Tauri; browser adapter can render explicit unavailable states; no fake success results are returned.
- **Property:** P4 and P6 in §6.

#### 2.2 Move hierarchy-preserving Files state and navigation into typed React state

- **Depends on:** 2.1.
- **Task-owned files:** `ui/src/state/libraryReducer.ts`, `ui/src/state/navigationSelectors.ts`, `ui/src/components/files/`, `ui/src/screens/FilesScreen.tsx`, and focused tests.
- **Prompt:** Replace the static `post-signin.js` browser logic with typed Files state: loading, empty, populated, selected, offline snapshot, stale, and error states; exact breadcrumbs; File/Folder labels; safe sorting; keyboard row behavior; selection details; and mount/usage surfaces through adapters. Preserve the current `list_children` and `get_usage` input/output boundaries.
- **Acceptance:** Nested navigation uses only returned ancestor IDs/names; sorting never changes parent/child relationships; duplicate content remains separate; unsupported details/actions are truthful.
- **Properties:** P1, P2, and P6 in §6.

#### 2.3 Implement Home from live and unavailable summaries

- **Depends on:** 2.1 and 2.2.
- **Task-owned files:** `ui/src/screens/HomeScreen.tsx`, `ui/src/components/home/`, Home state selectors, and tests.
- **Prompt:** Add Home with storage usage, mount state, recent Stashes/transfers/offline summaries when available, and a prominent `+ Stash it`. Missing optional data must produce a partial-data state rather than blanking the page. Recent Stashes and transfers must not be fabricated when the control-plane port is unavailable.
- **Acceptance:** First-use, populated, partial, offline, and service-failure states follow `EXPERIENCE.md`; links preserve context and do not convert Stashes into folders.

#### 2.4* Add Files/Home property and adapter contract tests

- **Depends on:** 2.1, 2.2, and 2.3.
- **Task-owned files:** `ui/tests/library/*.test.ts`, `ui/tests/home/*.test.ts`, and test adapters/fixtures.
- **Prompt:** Test the hierarchy and stale-response invariants with generated folder trees and interleaved async responses; test that browser adapters report unavailable capabilities and that live adapters issue only the approved command names.
- **Properties:** P1, P2, P4, and P6 in §6.

#### Checkpoint B

Run UI tests/typecheck/build plus `node --test` for the pre-existing contract tests and `cargo check -p stash-desktop`. Review the Files screen against the approved hierarchy rules before adding ingestion UI.

### Phase 2 — Stash It, duplicate warning, and truthful transfer state

#### 3.1 Add the Stash It picker/review state and desktop source-selection seam

- **Depends on:** 2.1 and 2.2.
- **Task-owned files:** `ui/src/screens/StashItScreen.tsx`, `ui/src/components/stash-it/`, `ui/src/state/stashReducer.ts`, `ui/src/domain/sourceSelection.ts`, and tests.
- **Prompt:** Add keyboard-accessible picker/drop-zone presentation through `DesktopCapabilityPort`. Show selected source names and exact original relative paths, scan/review states, item count/estimated size where actually known, cancel behavior, and a typed `ready to confirm` state. Do not claim a Stash has started or succeeded because a source was selected.
- **Acceptance:** `+ Stash it` opens from every authenticated screen; cancel is non-mutating; web/browser builds show an explicit unavailable picker state; no upload API is invented.
- **Property:** P2 and P4 in §6.

#### 3.2 Add duplicate-folder ambiguity warning and safe-choice state

- **Depends on:** 3.1 and 2.2.
- **Task-owned files:** `ui/src/components/stash-it/DuplicateFolderWarning.tsx`, related state/selectors, and tests.
- **Prompt:** Render source path, candidate folders, reason for ambiguity, `Review locations`, unambiguous `Choose this folder` only when valid, and `Cancel Stash`. Preserve names exactly. Never auto-create or merge a same-name folder. Keep the component usable when candidates are unavailable.
- **Acceptance:** An ambiguous result blocks confirmation for the affected item and leaves the library unchanged on cancellation.
- **Property:** P2 in §6.

#### 3.3 Add transfer progress, Recent Stashes, and recovery state models

- **Depends on:** 2.1 and 3.1; live transfer endpoints are not assumed.
- **Task-owned files:** `ui/src/domain/transfer.ts`, `ui/src/state/transferReducer.ts`, `ui/src/screens/TransfersScreen.tsx`, `ui/src/screens/RecentStashesScreen.tsx`, `ui/src/components/transfers/`, `ui/src/components/recovery/`, and tests.
- **Prompt:** Implement phase/status rendering for queued, preparing, stashing, verifying, verified `Stashed`, paused/offline-paused, partial failure, canceled, and needs-attention states. Until a real transfer/manifest contract exists, use typed unavailable/fixture-driven state only in tests and clearly label the production surface as unavailable. Do not expose byte-level fake progress or a completed state before verified commit.
- **Acceptance:** Recovery copy identifies what happened, what is safe, and the next action; leaving the screen does not lose canonical transfer state; partial failure does not claim whole-Stash success.
- **Property:** P3 in §6.

#### 3.4* Test Stash It and transfer properties

- **Depends on:** 3.1, 3.2, and 3.3.
- **Task-owned files:** `ui/tests/stash-it/*.test.ts`, `ui/tests/transfers/*.test.ts`.
- **Prompt:** Add generated transition tests for cancellation, ambiguous destinations, stale transfer events, verification gates, partial results, and retryability. Use a fake port; do not call a real backend.
- **Properties:** P2 and P3 in §6.

#### Checkpoint C

Run all UI tests and verify that production UI does not present a nonexistent Stash/create-transfer command. Require product/backend contract approval before wiring a real transfer invocation or changing Rust commands.

### Phase 3 — Search, details, and provenance-preserving results

#### 4.1 Add deterministic Search state and results presentation

- **Depends on:** 2.1 and 2.2.
- **Task-owned files:** `ui/src/domain/search.ts`, `ui/src/state/searchReducer.ts`, `ui/src/screens/SearchScreen.tsx`, `ui/src/components/search/`, and tests.
- **Prompt:** Implement ordinary keyword and approved structured-filter input, query preservation on errors, loading/results/no-results/offline/stale states, result count, filter removal, original path/Stash context, and actions to open details or reveal in Files. Keep ranking and search execution behind `ControlPlanePort`; do not implement an LLM or claim a live endpoint that does not exist.
- **Acceptance:** Search never changes the underlying hierarchy, and errors preserve the entered query and filters.
- **Properties:** P1 and P2 in §6.

#### 4.2 Add Asset details, safe preview, and Folder distinction

- **Depends on:** 2.2 and 4.1.
- **Task-owned files:** `ui/src/screens/AssetDetailsScreen.tsx`, `ui/src/components/details/`, `ui/src/components/preview/`, related domain types, and tests.
- **Prompt:** Render asset name/type/path/Stash provenance/size/timestamps/status and a safe preview only when the adapter says it is supported. Unsupported previews show metadata and a useful action. Folders navigate and show folder metadata; they do not masquerade as assets.
- **Acceptance:** Close restores prior context and selection; desktop-only actions are unavailable in browser mode; no raw content or secret material enters UI state.

#### 4.3* Add Search/details property and accessibility tests

- **Depends on:** 4.1 and 4.2.
- **Task-owned files:** `ui/tests/search/*.test.ts`, `ui/tests/details/*.test.ts`, and shared accessibility test helpers.
- **Prompt:** Test generated paths/results for provenance retention and non-reorganization, query preservation, unavailable previews, focus restoration, accessible names, and non-color status labels.
- **Properties:** P1, P2, P4, and P5 in §6.

### Phase 4 — Offline/cache, Settings, Devices, and remaining shell states

#### 5.1 Add Offline/pinned assets and Storage & cache usage surfaces

- **Depends on:** 2.1 and 2.2; native/cache contract may remain unavailable.
- **Task-owned files:** `ui/src/screens/OfflineScreen.tsx`, `ui/src/screens/StorageUsageScreen.tsx`, `ui/src/components/offline/`, `ui/src/components/storage/`, and tests.
- **Prompt:** Show original path, local availability, last sync/verification, cache usage, and local-space impact. Pin/unpin and `Free up space` must state that they affect local availability, not cloud identity or folder structure. Render explicit unavailable/stale/offline states until a real cache port exists.
- **Acceptance:** The UI never calls cloud deletion when freeing local cache; actions requiring network are disabled with an explanation.
- **Properties:** P2 and P4 in §6.

#### 5.2 Add Settings and Devices with approved scope boundaries

- **Depends on:** 1.2, 2.1, and the product decisions in §11.
- **Task-owned files:** `ui/src/screens/SettingsScreen.tsx`, `ui/src/screens/DevicesScreen.tsx`, `ui/src/components/settings/`, `ui/src/components/devices/`, and tests.
- **Prompt:** Implement theme, accessibility, transfer, mount, account/session, and read-only device presentation using explicit availability flags. Keep unsupported management actions unavailable. Make local-versus-cloud impact clear and preserve reversible preference semantics.
- **Acceptance:** Light/Dark/System capability remains equivalent; no settings path suggests that changing appearance affects data; device labels expose no secrets.
- **Property:** P5 and P6 in §6.

#### 5.3 Complete shared recovery, loading, offline, and responsive state coverage

- **Depends on:** 3.3, 4.2, 5.1, and 5.2.
- **Task-owned files:** shared `ui/src/components/feedback/`, `ui/src/components/layout/`, `ui/src/theme/`, all screen state fixtures, and tests.
- **Prompt:** Standardize banners/toasts/live regions, loading skeletons, empty states, errors, stale states, focus restoration, 200% text scaling tolerance, compact-window navigation behavior, reduced-motion behavior, and light/dark semantic tokens across all screens.
- **Acceptance:** Every applicable screen has the states required by `EXPERIENCE.md`; no essential status depends on color, hover, animation, or sound.
- **Properties:** P5 in §6.

#### 5.4* Add cross-screen accessibility and theme property tests

- **Depends on:** 5.3.
- **Task-owned files:** `ui/tests/accessibility/*.test.ts`, `ui/tests/theme/*.test.ts`, and test fixtures.
- **Prompt:** Test semantic token completeness, focusable action names, keyboard-reachable controls, reduced-motion output, no-color-only status encoding, and preservation of safe navigation/form state across resize-like rerenders.
- **Property:** P5 in §6.

#### Checkpoint D

Review all fourteen `EXPERIENCE.md` screen contracts and explicitly label each live, fixture-only, or unavailable capability. Do not call the beta complete while unresolved product decisions or missing backend contracts are being silently represented as implemented behavior.

### Phase 5 — Tauri integration hardening and final wiring

#### 6.1 Wire the complete shell/router and migrate/remediate legacy static entry points

- **Depends on:** 1.2 through 5.3.
- **Task-owned files:** `ui/src/app/`, `ui/src/main.tsx`, `ui/index.html`, `src-tauri/tauri.conf.json` if needed, legacy static files only when the migration is complete, and migration tests.
- **Prompt:** Wire all approved routes/screens into one authenticated React shell. Remove or isolate obsolete static event handlers only after equivalent React coverage exists. Preserve the existing native title-bar behavior, CSP, auth flow, and safe sign-out. Keep navigation labels exactly aligned with the PRD/UX contract.
- **Acceptance:** No screen is orphaned; no duplicate shell exists; all route changes preserve current folder/search context according to the UX contract.

#### 6.2 Harden Rust IPC DTOs/permissions only for approved new commands

- **Depends on:** 2.1 and the specific approved backend/native contracts; may be a no-op for unavailable screens.
- **Task-owned files:** `src-tauri/src/api.rs`, `auth.rs`, `mount.rs`, new narrowly scoped Rust command modules if required, `src-tauri/capabilities/default.json`, Rust tests, and UI adapter contract tests.
- **Prompt:** Only where an approved contract exists, add Rust-owned DTO validation, bounded errors, command tests, and minimum Tauri permissions. Keep user identity derived from verified session state, never request inputs; keep payload/lease operations native/Rust-side; never widen permissions without review.
- **Acceptance:** Rust command serialization contains no credential/payload fields; no `Resource: "*"` or unrelated capability is introduced; unavailable UI remains unavailable where this task has no approved contract.
- **Property:** P6 in §6.

#### 6.3* Add desktop smoke/contract coverage and final build checks

- **Depends on:** 6.1 and 6.2.
- **Task-owned files:** `desktop/apps/stash-desktop/tests/`, UI integration test configuration, and README command documentation only if the implementation changes commands.
- **Prompt:** Add automated shell-to-adapter integration coverage using fake ports and Rust command/DTO tests. Retain the existing no-network/no-secret assertions, update them for the React source tree, and verify generated frontend output is what Tauri consumes.
- **Acceptance:** Targeted tests, UI build/typecheck, Rust tests/check, and full integration commands in §7 pass.

#### Checkpoint E / final wiring

Ensure all tests pass, review the combined diff, verify task interfaces match, confirm no generated or vendored files were accidentally changed, and ask the user if questions arise before any high-impact or AWS-mutating action.

## 6. Correctness properties and property-based test mapping

These properties are implementation invariants. Each implementation task that touches the concern must either add or reuse its property test. Property numbering is stable for task traceability.

### P1 — Shared UI state is deterministic and stale-safe

For any valid sequence of typed UI events, the reducer returns a valid state whose invariants hold (one active screen, valid request phase, no impossible `Stashed` transfer without verification, and selected entity compatible with the current location). For any two async responses with request IDs, only the response matching the latest active request may update the relevant slice; a stale response cannot replace newer folder/search/transfer state.

**Mapped tasks:** 1.3, 2.2, 2.4, 3.3, 4.1, 4.3.

### P2 — Navigation and provenance preserve the creator hierarchy

For any generated folder tree and sequence of navigation/sort/search/reveal actions: every breadcrumb is an existing ancestor; opening a folder changes only the view location; sorting changes order but not parent IDs or original paths; File, Folder, and Stash remain distinct; identical checksums or names do not cause merge, rename, move, or reparent behavior; canceling Stash review leaves the library unchanged.

**Mapped tasks:** 2.2, 2.4, 3.1, 3.2, 3.4, 4.1, 4.3, 5.1.

### P3 — Transfer status is truthful and verification-gated

For every generated transfer event sequence, `Stashed` is reachable only after an explicit verified committed result. Before verification, the UI can show `Preparing`, `Stashing`, or `Verifying` but not final success. Partial, canceled, offline, or failed sequences remain non-successful and expose only actions supported by their state. Replaying or reordering stale events cannot regress a verified result or falsely complete an unverified one.

**Mapped tasks:** 3.3 and 3.4.

### P4 — Platform capability separation is explicit

For every desktop-only operation, the shared UI invokes a platform port rather than a native/browser API. The browser adapter returns `Unavailable` (or another explicit non-success state) when the capability is desktop-only. Pinning/unpinning/freeing space changes local availability state only; it cannot alter cloud identity, folder hierarchy, or imply deletion. A capability failure cannot be rendered as success.

**Mapped tasks:** 2.1, 2.4, 3.1, 4.3, 5.1, 5.4.

### P5 — Theme and accessibility behavior is equivalent and legible

For every supported theme and accessibility preference combination, semantic tokens provide the same capability hierarchy; status meaning is available as text/role in addition to color; every actionable control has an accessible name and keyboard path; focus restoration returns to the trigger after transient UI closes; reduced motion removes nonessential animation; layout state does not hide primary actions under compact sizing or 200% text scaling.

Automated tests cover token/DOM/keyboard contracts; contrast, screen-reader, and 200% scaling checks remain required integration evidence where automation cannot prove the result alone.

**Mapped tasks:** 1.3, 1.2, 4.3, 5.2, 5.3, 5.4, 6.3.

### P6 — IPC and secret/payload safety are preserved

For any UI action and generated safe input, the only native calls are allowlisted IPC commands with validated DTOs. UI source contains no browser network API, Cognito/AWS client, object key, presigned URL, token persistence, or payload transfer. Rust command outputs contain only approved safe DTOs; invalid route inputs fail before request construction; errors are bounded and do not echo secrets. User identity comes from the Rust session, never from a UI-supplied user ID.

**Mapped tasks:** 1.3, 2.1, 2.2, 2.4, 5.2, 6.2, 6.3.

## 7. Targeted validation and build commands

Commands are grouped by layer. Use one-shot commands; do not use watch mode or start a development server as part of automated validation.

### Frontend package (after Phase 0)

```powershell
npm --prefix desktop/apps/stash-desktop/ui ci
npm --prefix desktop/apps/stash-desktop/ui run typecheck
npm --prefix desktop/apps/stash-desktop/ui run test -- --run
npm --prefix desktop/apps/stash-desktop/ui run build
```

The exact script names must be created by task 1.1 and documented in the package. The package must use a lockfile and exact/pinned direct dependencies. If a dependency or tool behaves differently from its documented expectation, resolve that discrepancy in the task brief before dispatch rather than asserting an unverified exit code.

### Existing desktop contract tests

```powershell
node --test desktop/apps/stash-desktop/tests/welcome-contract.test.mjs
node --test desktop/apps/stash-desktop/tests/post-signin-contract.test.mjs
```

Keep these tests until migration is proven. Update only as part of a task-owned migration, not as a shortcut to remove baseline coverage.

### Rust desktop workspace

```powershell
cargo fmt --manifest-path desktop/Cargo.toml --all -- --check
cargo test --manifest-path desktop/Cargo.toml
cargo check --manifest-path desktop/Cargo.toml -p stash-desktop
```

### Tauri packaging/build smoke check

```powershell
npm --prefix desktop/apps/stash-desktop/ui run build
cargo build --manifest-path desktop/Cargo.toml -p stash-desktop
```

A local interactive `cargo tauri dev` session is manual-only and must be run by the user in their terminal, not as a long-running agent command. The plan does not require WinFsp installation or a deployed backend for UI-state tests.

### Repo-wide gate

```powershell
npm run typecheck
npm test -- --run
```

The repo-wide gate must include workspace code structurally (glob/workspace membership), not by enumerating packages. Because the desktop UI is an isolated package, verify that its own typecheck/test/build commands are included in the integration record; do not claim the root TypeScript gate covers it unless the configuration proves that.

## 8. Execution dependencies, ownership, and evidence gate

### Dependency waves

Tasks in a wave may run in parallel only when they do not write the same files and all previous waves are complete. Optional test tasks remain in the dependency graph and may be skipped only under the project’s implementation-task rules.

| Wave | Tasks | Reason |
|---:|---|---|
| 0 | 1.1 | Establish isolated frontend/build output and entry point. |
| 1 | 1.2 | Reproduce shell against the new foundation. |
| 2 | 1.3, 2.1 | Tests and adapter seams can be developed against the shell; avoid shared-file conflicts by ownership. |
| 3 | 2.2, 2.3, 3.1, 4.1 | Files/Home/Stash It/Search compositions use the stable ports; agents must keep distinct files. |
| 4 | 2.4, 3.2, 3.3, 4.2, 5.1, 5.2 | Add stateful secondary screens after the core compositions. |
| 5 | 3.4, 4.3, 5.3 | Add property/accessibility coverage after corresponding state/components exist. |
| 6 | 5.4, 6.1 | Complete cross-screen behavior and wire the single app shell. |
| 7 | 6.2 | Harden Rust IPC only for approved contracts after UI interfaces are stable. |
| 8 | 6.3 | Run final automated integration coverage after all code is wired. |

If a task needs to touch a file owned by an earlier task, split the change or make it a dependent follow-up; do not parallel-edit the same file.

### Explicit task-owned file rule

Each task brief must repeat its task-owned files and forbid edits outside them except for a named integration file. The controller must verify the diff against the ownership list before accepting the task. Shared files such as `ui/src/app/App.tsx`, `tauri.conf.json`, package manifests, and test configuration require serial ownership and cannot be modified in parallel.

### SIA/BMAD execution evidence required for every task

Per `AGENT.md §7`, every implementation task—including optional test tasks when executed—must produce all five artifacts under `_bmad-output/implementation-artifacts/sdd/`:

1. **Task brief:** exact prompt, scope, owned files, dependencies, acceptance criteria, validation commands, and risk/approval notes.
2. **Host-dispatch record:** the controller’s dispatch, task ID, subagent identity, timestamp, and branch/worktree/context information.
3. **Subagent report:** files changed, commands run, test results, deviations, and any unresolved contract question.
4. **Reviewer verdict:** behavioral review of the task against requirements, properties, security boundary, ownership, and actual diff.
5. **Progress-log entry:** task status and evidence links in the SIA/BMAD progress log.

The controller must brief and dispatch scoped subagents; this project’s contract does not permit the controller to implement task-owned application files directly. Every deviation must be recorded, including a task that cannot proceed because a backend/native/product decision is missing. After all tasks, run one integration phase: full test/build suite, cross-task interface verification, whole-plan combined diff review, and evidence-manifest check. A missing artifact or missing manifest is a process deviation, not documentation debt.

Use BMAD planning/execution artifacts in `_bmad-output/` as the process spine and SIA for approval, security, subagent-evidence, and feedback-loop gates. Do not modify vendored BMAD tooling.

## 9. Rollback, approval, and high-impact gates

### Reversible implementation checkpoints

- Keep the current static UI and contract tests intact through the React foundation and initial migration. A failed frontend slice can be reverted by restoring the Tauri frontend distribution/config and static entry without touching Rust auth/mount code.
- Land each phase as a separately reviewable change. Do not combine a UI migration, new native permissions, and backend/API changes in one unreviewed task.
- Use feature/state flags or explicit unavailable adapters for incomplete screens; do not create fake production data to make a route look complete.
- Preserve existing Rust command DTOs and tests unless a named approved contract requires a change. Any Rust change must have a narrow rollback path and its own tests.

### Approval gates

1. **Frontend dependency/design gate:** approve the isolated React/build dependency versions, asset copies, CSS/token interpretation, and output path before task 1.1 modifies manifests or Tauri config.
2. **Auth/security gate:** review task 1.2 and all IPC changes for no token/password/payload exposure, safe error handling, CSP preservation, and Credential Manager behavior.
3. **Capability/backend gate:** before task 3.3 or 6.2 wires a real transfer/search/cache/device command, approve the exact backend/native contract, DTOs, auth scope, error semantics, and tests. Until then, use unavailable states.
4. **WinFsp/mount gate:** any change to mount lifecycle, filesystem writes, WinFsp permissions, or installed runtime behavior is separately approved. UI work must not silently broaden the current read-only mount.
5. **AWS mutation gate:** no `cdk deploy` or mutating AWS CLI operation is part of this plan’s automated commands. Any future invocation requires explicit approval immediately before the command, as required by `AGENT.md`.
6. **Final beta gate:** require product/design review of all fourteen UX contracts, unresolved decisions, accessibility evidence, full integration results, and the combined behavioral reviewer verdict before calling the plan implemented.

### Rollback triggers

Stop and return to the relevant phase if any of the following occurs: an unavailable backend operation is represented as success; a hierarchy test detects reparenting/merging; `Stashed` appears before verification; a browser/native boundary is bypassed; a secret/payload appears in UI state/logs; theme/accessibility coverage regresses; a task edits files outside ownership; or a required approval/evidence artifact is missing.

## 10. Observability and integration evidence

The UI may expose user-safe status and timing hooks for future product metrics, but must not log secrets, paths beyond the user-visible safe context, object keys, tokens, presigned URLs, or payload bytes. Product metrics from the PRD—successful Stash rate, resume success, first-open/cached-open latency, search response, duplicate-folder detections, cache hits, storage, active devices—require an approved telemetry contract and are not claimed by this plan.

The final integration report must include:

- the exact frontend, legacy Node, Rust, and repo-wide commands run and their exit status;
- proof that the desktop package is typechecked/tested/buildable and is not accidentally omitted from a green root gate;
- a command allowlist/source scan showing no direct browser networking/native API usage in shared UI;
- a state/property coverage matrix for P1–P6;
- a screen matrix marking each of the fourteen screens live, fixture-only, unavailable, or blocked by an unresolved decision;
- a Tauri capability/CSP diff review;
- task ownership/evidence manifest and reviewer verdict;
- a list of unresolved product/backend/native decisions and explicit follow-up owners.

## 11. Unresolved product, design, and technical decisions

These are dependencies, not assumptions. The implementation may render safe unavailable states while they remain open.

1. Whether account creation is in private-beta scope; current `Create account` remains a placeholder.
2. First-beta preview formats and whether unsupported files may be opened through the host OS.
3. Whether Transfers is a full page, persistent panel, or both, while retaining the `Transfers` navigation label.
4. Whether Devices is read-only in beta and which management actions are allowed.
5. Exact offline/pinning semantics, local-cache eviction policy, and any cloud deletion affordances.
6. Final approved logo/icon/empty-state assets and font loading/licensing constraints.
7. Exact Windows/macOS compact-navigation behavior and breakpoints after platform review.
8. Backend contracts for search, Stash creation/manifest submission, transfer queue/progress/retry, recent Stashes/history, devices, cache/offline operations, and asset preview metadata.
9. Whether/when the mounted-drive boundary expands beyond the current flat, read-only committed root listing and how nested hierarchy is synchronized safely.
10. Approved telemetry/event schema and privacy constraints for the PRD beta metrics.
11. Browser build packaging/deployment target and which desktop-only capabilities should be unavailable versus browser-native alternatives.

## 12. Completion definition

This implementation plan is complete when the requested plan artifact exists, contains the phased coding tasks and dependencies above, and has been reviewed for consistency with `AGENT.md`, the PRD, and the approved UX contracts. Implementation is not complete merely because all routes render: the final integration phase must pass the named gates, every task must have the five SIA/BMAD evidence artifacts, the reviewer must verify the combined behavioral contract, and unresolved decisions must be explicit.

The next operator can begin by opening this file, creating the first task brief for 1.1, dispatching a scoped implementation subagent, and following the evidence/approval gates before modifying application source.
