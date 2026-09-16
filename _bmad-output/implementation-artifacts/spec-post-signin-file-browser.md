---
title: 'Build the STASH post-sign-in file browser screen'
type: 'feature'
created: '2026-09-16'
status: 'in-progress'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: 'c46a5af'
context:
  - 'AGENT.md'
  - 'STASH_PRD_v0.1.md'
  - '_bmad-output/planning-artifacts/architecture/architecture-stash-2026-09-16/ARCHITECTURE-SPINE.md'
  - '_bmad-output/implementation-artifacts/spec-complete-api-surface-and-frontend-contract.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** After sign-in, STASH currently has no working destination where
 a creator can see their library, browse folders, or control the mounted
virtual drive.

**Approach:** Add one post-sign-in desktop screen that behaves like a calm
Windows file browser: left navigation, breadcrumb path, sortable file/folder
list, selection details, storage usage, and a clear mount control. Start with
real authenticated metadata calls where available, while keeping payload
bytes and filesystem writes in the Rust service. Mount uses the first
available drive letter and volume label `STASH`.

## Boundaries & Constraints

**Always:** preserve original hierarchy and File/Folder/Stash distinctions;
derive identity from the signed-in Cognito session; show loading/empty/error
states; never expose object keys, tokens, or presigned URLs; keep the UI a
client of the Rust core/API boundary; make the mounted drive independently
survive window close and eventual Windows restart through the background
service.

**Never:** put file payloads through the UI/API Gateway; add vendor-specific
creative-app integrations; fake successful uploads; silently overwrite or
delete cloud files; change the existing welcome/sign-in screen or mount
adapter contract in this screen-only slice.

## Tasks & Acceptance

**Execution:**
- [ ] `desktop/apps/stash-desktop/ui/index.html`, `styles.css`, and
  `post-signin.js` -- add the authenticated browser view, navigation states,
  mount status/action, and accessible interactions.
- [ ] `desktop/apps/stash-desktop/tests/` -- add contract tests for loading,
  empty/error states, hierarchy labels, mount-letter presentation, and the
  no-secret/no-payload boundary.
- [ ] `desktop/apps/stash-desktop/README.md` -- document the screen and its
  current metadata-only/test-fixture boundary.

**Acceptance Criteria:**
- Given a signed-in creator, when the screen opens, then their folders/files
  appear with a breadcrumb and no other user’s records.
- Given loading, empty, or API failure, when the state changes, then the
  screen communicates it without exposing secrets or crashing.
- Given the creator chooses Mount, when an available letter is selected, then
  the UI shows `STASH (X:)` and a persistent mounted status; the payload path
  remains outside the webview.

## Implementation Notes

## Review Triage Log

## Design Notes

Keep the browser information-dense like Explorer while preserving STASH’s
quiet visual system: one primary content surface, restrained cyan/violet
accent, clear folder rows, and no decorative splash art behind data.

## Verification

**Commands:**
- `node --test desktop/apps/stash-desktop/tests/post-signin-contract.test.mjs`
- `cargo check --manifest-path desktop/Cargo.toml -p stash-desktop`
