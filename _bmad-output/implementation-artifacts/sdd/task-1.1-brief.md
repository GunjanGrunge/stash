# Task Brief: Tauri 2 desktop frontend foundation

## Goal
Establish the isolated React + TypeScript frontend package for the existing STASH Tauri 2 app. Emit the frontend distribution consumed by Tauri, keep shared code browser-compatible, and keep native access outside React components.

## Authority
Approved plan: `_bmad-output/planning-artifacts/plans/2026-09-17-tauri2-desktop-app-plan.md`, Phase 0 Task 1.1. UX authorities: `DESIGN.md` and `EXPERIENCE.md` under `_bmad-output/planning-artifacts/ux-designs/ux-stash-2026-09-16/`. Project contract: `AGENT.md`.

## Scope
- Add an isolated package under `desktop/apps/stash-desktop/ui/` with exact dependency pins, lockfile, TypeScript configuration, Vite configuration, typed React entry, and minimal `App` component.
- Emit production files under `ui/dist/` and point Tauri `frontendDist` at that generated directory.
- Preserve the existing root static entry and auth/browser scripts for the Task 1.2 migration; do not modify Rust, backend code, or vendored tooling.
- Keep the temporary React entry honest about the migration handoff; do not implement the visual shell or auth migration in Task 1.1.

## Acceptance
- `npm --prefix desktop/apps/stash-desktop/ui run typecheck` succeeds.
- `npm --prefix desktop/apps/stash-desktop/ui run build` succeeds and emits `ui/dist/index.html` plus a bundled asset.
- Tauri `build.frontendDist` consumes `../ui/dist` while existing CSP/window settings remain unchanged.
- Existing desktop contract tests remain green after excluding generated/dependency directories from their source scan.

## Evidence required
Task brief, host-dispatch record, implementation report, reviewer-ready validation summary, and progress-log entry under `_bmad-output/implementation-artifacts/sdd/`.
