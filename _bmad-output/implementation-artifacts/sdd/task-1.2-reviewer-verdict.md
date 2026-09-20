# Task 1.2 Reviewer Verdict

**Review basis:** Behavioral review of the local Task 1.2 diff after implementation, followed by fixes and the final validation rerun.

## Initial findings and disposition
The independent review initially identified a blocking generated-entry stylesheet omission, account-enumerating Rust error text, gateway trust of raw DTOs, Files accessibility/retry gaps, generic mount failure state, overbroad mount presentation, legacy-heavy contract coverage, and no automatic Tauri build command.

- **Fixed:** React entry now imports `styles.css`; build output includes a CSS asset and migration tests assert it.
- **Fixed:** gateway owns command allowlisting, folder-ID validation, safe response shape checks, bounded error normalization; Files adds `aria-sort`, `aria-selected`, Space selection, retry, cleared loading rows, and distinct mount-unavailable state/action labels.
- **Fixed/documented:** clean-checkout `npm ci` + isolated `npm run build` before Tauri is documented in the owning desktop README; `frontendDist` points to `ui/dist` only after the migrated behavior exists.
- **Consciously deferred:** the account-enumeration/raw-debug branch is in pre-existing Rust backend code. The user prohibited backend changes for this task, so the issue is recorded as an explicit deviation and the React presentation normalizes common cases.
- **Consciously bounded:** current mount limitations are existing Rust behavior and are not expanded or falsely represented as full product integration.

## Verdict
**PASS WITH EXPLICIT DEVIATIONS.** The Task 1.2 UI-owned migration is complete and validated. The generated app is styled, uses the single gateway, preserves the existing IPC command contract, provides the working Files/auth transition, and presents unsupported capabilities honestly. The remaining auth-backend error-policy issue, full React runtime integration coverage, and all future product/backend capabilities remain outside this task’s allowed implementation boundary.

## Standing-rule check
- Exact creator hierarchy preserved; no reorganization or checksum identity behavior.
- File and Folder labels remain distinct; Stash is not represented as a Folder.
- No LLM, direct network, payload, token persistence, AWS mutation, or vendored-tooling change.
- Existing legacy static files remain available as clearly retained migration reference.
- Home/Search/Stash It/Transfers/Offline/Settings/Devices are not claimed implemented.

## Repair verdict — 2026-09-17

**PASS WITH EXPLICIT DEVIATIONS — reviewed issues repaired.**

The React/native boundary now keeps NEW_PASSWORD_REQUIRED sessions private to the gateway, while preserving the Rust command argument shape. The gateway constructs fresh allowlisted child DTOs and drops malformed or secret-bearing fields. Usage and mount failures are truthful and retryable in inline live-region UI, capability availability is explicitly typed, and visual-order sign-in focus is covered. The added Vite-built gateway test exercises fake invoke responses through the live gateway module and verifies that challenge sessions and secret child fields are not exposed to the UI result.

Validation is recorded in the repair section of `task-1.2-report.md`: UI tests 9/9, typecheck, production build, desktop Node contracts 22/22, isolated Cargo check pass, and `git diff --check` pass.

Remaining deviations are deliberate: no Rust/backend repair was made; the existing Rust account-enumeration/raw-debug mapper remains for a backend-owned follow-up. Offline/stale states are typed but no snapshot or endpoint is fabricated. Full product capabilities, full React DOM integration, and Task 1.3 property-based coverage remain out of scope. Existing unrelated worktree changes were preserved.

## Follow-up review — repeated challenge response — 2026-09-17

**PASS.** The remaining React boundary defect is repaired. The gateway now maps its internal auth result through an explicit public mapper on every sign-in and new-password completion return, so a repeated `NewPasswordRequired` response cannot expose `privateSession` or `session` to React. The opaque replacement session remains closure-private and is forwarded only as the existing `complete_new_password` IPC argument on the next completion invocation.

The built boundary test exercises sign-in, repeated challenge completion, and final completion. It verifies the public DTO shape, absence of both session field names, and forwarding of `opaque-next-challenge` in the next native call. Validation passed: UI tests **9/9**, UI typecheck, UI build, desktop Node contracts **22/22**, Cargo check, and `git diff --check` (exit 0 with existing line-ending warnings only).

No Rust/backend, vendored tooling, AWS, `.kiro/specs`, or unrelated worktree files were changed. This verdict does not expand Task 1.2 into full product capabilities or Task 1.3 coverage; the previously recorded deviations remain explicit.