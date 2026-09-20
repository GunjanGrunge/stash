# Task 1.2 Brief — React shell and Welcome/Files migration

**Date:** 2026-09-17
**Scope:** Approved Task 1.2 only from `2026-09-17-tauri2-desktop-app-plan.md`.
**Authority:** `AGENT.md`, UX `DESIGN.md`/`EXPERIENCE.md`, existing Rust IPC and legacy static runtime.

## Objective
Replace the live static frontend with a generated React/TypeScript distribution that reproduces the calm STASH utility shell and migrates the working Welcome/sign-in and post-sign-in Files transition without adding backend endpoints or a second native boundary.

## Guardrails
- Preserve Rust-owned Cognito SRP, Credential Manager, process-local ID-token, restore, sign-out, metadata, and mount contracts.
- React components use one typed gateway; no browser network calls, payloads, passwords/tokens in persistence, AWS calls, WinFsp calls, or direct Tauri globals.
- Keep File, Folder, and Stash distinct; preserve returned hierarchy IDs and safe folder arguments.
- Do not implement Home, Search, Stash It ingestion, Recent Stashes, Offline, Transfers, Settings, Devices, or full backend integrations.
- Preserve unrelated pre-existing worktree changes and legacy static files.

## Planned evidence
Isolated UI tests/typecheck/build, existing desktop Welcome/post-sign-in contracts against the generated entry, desktop Cargo check, diff check, and the required brief/dispatch/report/reviewer/progress artifacts.
