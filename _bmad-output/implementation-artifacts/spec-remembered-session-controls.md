---
title: 'Add explicit remembered-session controls to STASH desktop sign-in'
type: 'feature'
created: '2026-09-17'
status: 'in-review'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: 'e75aa8246d2b37cc383299df1f4073b372e32ee2'
context:
  - 'AGENT.md'
  - '_bmad-output/implementation-artifacts/spec-desktop-welcome-custom-chrome.md'
  - '_bmad-output/implementation-artifacts/spec-post-signin-file-browser.md'
---

<frozen-after-approval reason="human-owned intent â€” do not modify unless human renegotiates">

## Intent

**Problem:** STASH signs a creator in but does not make the session-persistence choice visible. The user cannot tell whether a session will be remembered, and the existing behavior attempts to save a Cognito refresh credential for every successful sign-in. The user also reported difficulty finding Sign out, even though a control exists in the current library sidebar.

**Approach:** Add an explicit, accessible “Remember me on this device” choice to both normal sign-in and the required-new-password completion path. Persist and restore Cognito session material only when the choice is enabled, and make the library’s Sign out action permanently discoverable and unambiguous. The checkbox controls the current Windows user only; it never stores the password or displays token material.

**Decision:** “Remember me on this device” is unchecked by default. A creator must actively enable it; when it is left disabled, STASH removes any previous remembered session after a successful sign-in.

## Boundaries & Constraints

**Always:** retain Cognito SRP and the deployed User Pool client; keep the webview incapable of reaching Cognito or AWS directly; keep passwords, refresh tokens, ID tokens, S3 paths, object keys, and payload bytes out of HTML, JavaScript state, UI strings, logs, and tests; store an opted-in refresh token only in Windows Credential Manager as opaque bytes; clear it when the user opts out or signs out; retain the short-lived ID token only in Rust process memory; preserve the current sign-in and NEW_PASSWORD_REQUIRED behavior; ensure the checkbox has a real label, keyboard operation, and usable focus treatment; keep Sign out visible beside the mounted-drive controls and explain its consequence before it is used.

**Never:** add AWS credentials to the desktop client; silently enable remembered sign-in contrary to the selected preference; persist a password; broaden Tauri permissions, the CSP, filesystem access, or shell access; change mount behavior, install a Windows service, or make the drive survive closing the app in this slice; alter files, folders, Stashes, quota, or cloud payloads.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Opted-in normal sign-in | Valid username/password; checkbox enabled | Rust retains the ID token and writes the returned refresh token to Credential Manager; a next app launch restores the session | If secure storage cannot write, report the failure and do not present signed-in state |
| Opted-out normal sign-in | Valid username/password; checkbox disabled | Rust retains only the in-process ID token, deletes any older saved session, and opens the library | Next launch shows sign-in; no password or token appears in the UI |
| New-password completion | Cognito returns NEW_PASSWORD_REQUIRED; same checkbox choice | Completion applies the original selected preference before opening the library | Preference remains stable across the two-step challenge |
| Session restore | App starts with a valid stored refresh token | Rust exchanges it for fresh tokens and opens the library without showing credentials | Invalid, empty, or unreadable stored material is removed/ignored and the normal sign-in screen remains available |
| Sign out | Signed-in creator activates Sign out | Rust clears in-memory ID material and the saved Credential Manager entry, then returns to Welcome | A local failure leaves a clear non-secret error and does not claim success |

</frozen-after-approval>

## Code Map

- `desktop/apps/stash-desktop/ui/index.html` -- contains the normal sign-in and new-password forms plus the existing sidebar `#signout-action`; add semantic preference controls and more discoverable sign-out copy without changing browser structure.
- `desktop/apps/stash-desktop/ui/welcome.js` -- owns forms, stores only the pending NEW_PASSWORD_REQUIRED challenge state in webview memory, invokes Rust commands, and currently invokes restore on startup; pass a boolean preference through both authentication commands.
- `desktop/apps/stash-desktop/ui/post-signin.js` -- binds `#signout-action`; retain IPC-only sign out and make its consequence clear without moving data or secrets into the webview.
- `desktop/apps/stash-desktop/ui/styles.css` -- existing focus/color system and sidebar mount-card layout; add responsive checkbox and sign-out presentation using existing tokens.
- `desktop/apps/stash-desktop/src-tauri/src/auth.rs` -- owns SRP, in-memory ID token, Credential Manager entry, restore, and sign out; make persistence conditional on a `remember` input and ensure opting out removes stale credentials.
- `desktop/apps/stash-desktop/src-tauri/src/lib.rs` -- registers existing commands; only change if command signature registration requires it.
- `desktop/apps/stash-desktop/tests/welcome-contract.test.mjs` and `desktop/apps/stash-desktop/tests/post-signin-contract.test.mjs` -- static/runtime UI contracts; extend for accessible preference and IPC contract without real credentials.
- `desktop/apps/stash-desktop/README.md` -- update session behavior and manual test procedure.

## Tasks & Acceptance

**Execution:**
- [x] `ui/index.html`, `ui/styles.css`, and `ui/welcome.js` -- add a clearly labelled preference to the sign-in journey, preserve its value across NEW_PASSWORD_REQUIRED, and pass only the boolean over Tauri IPC.
- [x] `src-tauri/src/auth.rs` and, only if required, `src-tauri/src/lib.rs` -- accept the preference, conditionally write/delete opaque refresh bytes, and preserve secure restore and sign-out behavior.
- [x] `ui/post-signin.js` and `ui/index.html` -- make Sign out plainly visible with a concise “removes remembered sign-in from this device” description; retain no-secret IPC behavior.
- [x] `tests/welcome-contract.test.mjs`, `tests/post-signin-contract.test.mjs`, and Rust unit tests in `auth.rs` -- cover opt-in/opt-out command shape, challenge preference continuity, visible sign-out semantics, and serialization boundaries.
- [x] `README.md` -- document the chosen default, storage boundary, restore behavior, and manual checks.

**Acceptance Criteria:**
- Given a creator sees Sign in, when they choose their remembered-session preference and authenticate, then their choice controls whether a next launch restores the session without a password.
- Given a creator must replace a temporary password, when they complete the challenge, then the preference selected on the prior screen still governs persistence.
- Given a creator signs out, when STASH returns to Welcome, then the remembered session cannot restore on the next launch and the UI never claimed the password was stored.
- Given a keyboard or screen-reader user reaches the sign-in form, when they navigate the preference and Sign out controls, then both have meaningful labels, visible focus, and no secret-bearing text.

## Implementation Notes

## Spec Change Log

## Review Triage Log

## Design Notes

The preference belongs directly below Password, before the primary action: it is a decision about the sign-in that follows, not a setting buried elsewhere. The library sidebar should present Sign out as a deliberate device/session action, visually secondary to Mount STASH but never pushed below the visible area at the standard 1280×720 window.

## Verification

**Commands:**
- `cargo test --manifest-path desktop/Cargo.toml -p stash-desktop` -- expected: Rust authentication, mount, and API unit tests pass without using a real credential or network account.
- `node --test desktop/apps/stash-desktop/tests/welcome-contract.test.mjs desktop/apps/stash-desktop/tests/post-signin-contract.test.mjs` -- expected: preference, sign-out, IPC-only, and existing custom-window contracts pass.
- `cargo build --manifest-path desktop/Cargo.toml -p stash-desktop` -- expected: a launchable Windows executable is produced.

**Manual checks:**
- Launch STASH; verify the checkbox label and keyboard focus; sign in once with it enabled, close without unmounting, relaunch, and confirm that the library opens without a password.
- Sign out, relaunch, and verify that STASH returns to Sign in. Repeat with the checkbox disabled and verify no automatic restore occurs.
