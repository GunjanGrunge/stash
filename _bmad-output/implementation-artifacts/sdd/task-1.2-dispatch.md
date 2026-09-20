# Task 1.2 Dispatch

**Task:** Reproduce the approved STASH visual shell and migrate Welcome/sign-in plus post-sign-in Files into the isolated React UI package.
**Implementer:** Scoped desktop implementation agent.
**Workspace:** `desktop/apps/stash-desktop/ui` with Tauri at `desktop/apps/stash-desktop/src-tauri`.
**Excluded:** vendored tooling, backend/Rust command implementations, AWS infrastructure, `.kiro/specs`, `uisamples/`, and unrelated existing changes.

## Implementation route
1. Read `AGENT.md`, approved plan/design contracts, existing static runtime, Rust command registration, capability/CSP/window configuration, and pre-existing worktree state.
2. Add typed domain DTOs, auth reducer, one Tauri/browser-unavailable gateway, React title bar/rail/auth/Files/shell components, and semantic styles.
3. Preserve the exact command names and argument keys: `sign_in(username,password,remember)`, `complete_new_password(username,newPassword,session,remember)`, `restore_session`, `sign_out`, `list_children(folderId)`, `get_usage`, `mount_status`, `mount_stash`, `unmount_stash`.
4. Add source-focused Node tests and generated-entry parity checks; update existing desktop contract tests to verify `frontendDist` and generated `dist/index.html` while retaining legacy contract coverage.
5. Switch Tauri to `../ui/dist`; document clean-checkout `npm ci` + `npm run build` before Tauri; leave legacy files intact.
6. Run the prescribed isolated UI, desktop Node, Cargo, and diff validations. Do not run `cargo tauri dev` or AWS mutations.
