# Task 2 Dispatch

**Task ID:** STASH-TAURI-2-STASH-IT
**Workspace:** `C:\Users\Bot\Desktop\stash`
**Route:** Existing `desktop/apps/stash-desktop` Tauri 2 app and isolated React UI.

## Prior context
The worktree contains pre-existing Task 1.1–1.3 desktop migration/auth/mount changes. Those changes remain in place. Existing Rust `api.rs`/`auth.rs` owns the authenticated API boundary; existing React gateway sanitizes DTOs and keeps the temporary Cognito challenge private.

## Dispatch constraints
- Preserve File/Folder/Stash distinctions and exact creator hierarchy.
- Keep all payload bytes and transfer bearer material native-only.
- Use API contracts already present in `services/handlers` and do not call AWS/deploy.
- Do not alter vendored tooling, AWS infrastructure/deployments, `.kiro/specs`, or unrelated pre-existing changes.
- Report unknown/failed outcomes as `Needs attention` or `Canceled`, never `Stashed`.

## Execution route
1. Add Rust upload controller and direct transfer workflow with safe DTOs and tests.
2. Add typed gateway commands and Home/Stash It UI with unavailable states for unverified capabilities.
3. Restyle Files without changing hierarchy or sort semantics.
4. Update README and required evidence, append progress history.
5. Run the requested Rust/UI/desktop contract/type/build/diff validations.
