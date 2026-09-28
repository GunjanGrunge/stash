# Task 2 Brief — Stash It vertical slice

**Task:** Implement the smallest safe end-to-end Stash It/upload slice supported by the repository’s existing API contracts, plus the approved Home/Stash It/Files visual slice.
**Authority:** `AGENT.md`, the approved STASH UX contract under `_bmad-output/planning-artifacts/ux-designs/ux-stash-2026-09-16/`, and the user’s authoritative upload contracts.

## Scope
- Rust-native source selection, recursive manifest, streaming SHA-256 checksums, process-local transfer state, API control-plane calls, direct multipart PUT, and safe Tauri DTOs.
- Tauri commands: `select_stash_source`, `confirm_stash`, `get_transfer_status`, and `cancel_stash`.
- React Home default, real `+ Stash it` flow, source/review/progress/recovery states, honest empty/unavailable panels, and denser Files treatment.
- Focused Rust and frontend contract tests plus setup/manual/API-deployment documentation.

## Non-goals and safety
No React payload transfer, browser network API, AWS call, deployment, `.kiro/specs`, vendored-tooling, infrastructure, cache/offline/search/history/device/settings behavior, or Rust/native boundary bypass. The browser never receives absolute paths, checksums, credentials, object keys, upload IDs, presigned URLs, ETags, or bytes. `Stashed` is reachable only after the API’s verified file completion and Stash completion responses.

## Known limitation
The deployed API is not confirmed. The implementation is validated with local Rust tests and fake frontend invoke contracts; live desktop/AWS verification remains explicitly pending deployment availability.
