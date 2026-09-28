# Task Brief: remembered-session-controls

Goal: Implement the approved explicit remembered-session controls exactly as specified.

Files: `desktop/apps/stash-desktop/ui/index.html`; `desktop/apps/stash-desktop/ui/styles.css`; `desktop/apps/stash-desktop/ui/welcome.js`; `desktop/apps/stash-desktop/ui/post-signin.js`; `desktop/apps/stash-desktop/src-tauri/src/auth.rs`; `desktop/apps/stash-desktop/src-tauri/src/lib.rs` only if needed; `desktop/apps/stash-desktop/tests/welcome-contract.test.mjs`; `desktop/apps/stash-desktop/tests/post-signin-contract.test.mjs`; `desktop/apps/stash-desktop/README.md`; Rust tests inside `auth.rs`; implementation notes/task checkboxes in `spec-remembered-session-controls.md`.

Interfaces: Tauri `sign_in(username, password, remember)` and `complete_new_password(username, new_password, session, remember)` commands; UI IPC invocations carry only the boolean preference and existing user input; `restore_session` and `sign_out` remain Rust-only credential operations.

Steps: Read `_bmad-output/implementation-artifacts/spec-remembered-session-controls.md` fully and implement it. Load every file listed in its frontmatter context before starting.

Acceptance Criteria: Every task and acceptance criterion in the approved spec is completed; the matrix is covered by tests that run and pass; no password or credential material reaches the webview or repository.

Effort Budget: 30 tool calls. Stop and report if incomplete at the ceiling.

Relevant Standing Rules:

1. **No LLM in the product runtime.** v1 uses deterministic tokenization, aliases, structured filters and lexical ranking. Do not introduce a model call into a product code path. (PRD Â§4.5, Â§14)
2. **`user_id` comes only from verified JWT claims.** Never from a request body, query string or path parameter. (Spec Â§6.1)
3. **A quality gate must cover new code structurally, never by enumeration.** Any gate that asserts repo-wide quality must include code by glob or workspace membership, never an enumerated package list. When adding a new package, verify the gate actually sees it.
4. **BMAD drives planning and execution artifacts; SIA supplies the gates.** Implementation is executed by scoped subagents under the evidence gate, never by the controller.

Host Evidence: Codex collaboration subagent `/root/remembered_session_controls`; dispatched 2026-09-17T09:20:53+05:30.

Escalate, don't improvise, when: an unexpected dependency the brief didn't mention; a file the brief didn't list needing changes; a conflicting or already-modified file; a requirement in the brief that's ambiguous enough to support two different implementations; a missing tool, credential, or piece of environment the task needs; a test that fails for a reason unrelated to this task's own change; or the Effort Budget being exceeded with the task still incomplete. In every one of these cases, report status `blocked` with exactly what was found.
