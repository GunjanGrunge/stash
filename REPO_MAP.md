# STASH — Repository Map

What lives where, and why. This is a map of the current layout, not a
target to migrate to — nothing was moved to produce this file. See
`AGENT.md` for the project's governance rules; this file is purely
descriptive.

Generated 2026-09-16. Update it whenever a top-level directory's purpose
changes — it will drift otherwise.

## Product source of truth

| Path | What it is |
|---|---|
| `STASH_PRD_v0.1.md` | The Product Requirements Document. The source of truth for what STASH is and what the private beta must do. |
| `AGENT.md` | This project's own contract for any coding assistant working here: rules, authority order, spec/plan locations, attribution policy, the SIA/BMAD boundary. Read this first, always. |

## Backend — AWS control plane

| Path | What it is |
|---|---|
| `infra/` | AWS CDK app (TypeScript). One stack per concern: `data-stack.ts` (DynamoDB + S3), `identity-stack.ts` (Cognito), `api-stack.ts` (API Gateway + Lambda routes), `app-role-stack.ts` (shared least-privilege IAM role), `observability-stack.ts` (CloudWatch/budgets), `retention-stack.ts` (trash purge worker). `infra/bin/stash.ts` wires them together. `infra/test/` asserts against the synthesized CloudFormation template, not just unit behavior. |
| `services/shared/` | Cross-handler library: claims parsing, error helpers, idempotency, S3 key/path helpers, logging. |
| `services/handlers/*/` | One package per domain — `files`, `stashes`, `uploads`, `read`, `manifest`, `devices`, `retention`. Each handler is a dependency-injected function; it doesn't know about Lambda or AWS SDK clients directly. |
| `services/entrypoints/` | The missing link between handlers and AWS Lambda: wires production DynamoDB/S3 clients at module scope and calls the handler. This is what actually deploys as a Lambda function body. |
| `cdk.json`, `cdk.out/` (gitignored) | CDK config and synthesized template output. Nothing here has been deployed to a real AWS account yet — see `AGENT.md` Rule 11. |

**Nothing is live in AWS.** Every `cdk deploy` is a separate, explicit
High-severity approval — this repo currently only proves things via
`cdk synth` and local tests.

## Desktop client

| Path | What it is |
|---|---|
| `desktop/` | Independent Cargo workspace (Rust) — deliberately **not** part of the root npm workspace. `desktop/crates/stash-core/` is the platform-agnostic domain logic (range-read cache, lease handling). `desktop/crates/stash-windows-fs/` is the WinFsp adapter that maps filesystem calls to the core. `desktop/tests/mount-spike/` documents the manual, separately-approved live-mount verification procedure. |

**Status:** first feasibility spike in progress — proving one cloud-only
file opens and scrubs correctly through a `STASH (S:)` mount before any
Tauri UI, macOS support, or sync engine is built. See
`_bmad-output/implementation-artifacts/spec-cloud-asset-mount-feasibility-spike.md`.
No Tauri/UI code exists yet.

## Documentation

| Path | What it is |
|---|---|
| `docs/api-reference.md` | The frontend/client contract for the deployed API surface — routes, request/response shapes, error codes. Kept in sync with `infra/lib/api-stack.ts` by convention, not by generation. |
| `docs/aws-cost-model-beta.md` | Cost telemetry/economics notes tied to PRD §18 (the beta's most important commercial output: real AWS cost per active user). |
| `docs/manifest.json` | A generated file-integrity manifest (path/bytes/sha256) — currently covers the `brand/` asset pack; not hand-maintained. |
| `REPO_MAP.md` | This file. |

## Design / brand

| Path | What it is |
|---|---|
| `brand/` | The canonical, approved STASH brand kit — logos, icons (Windows/Apple/PWA/installer), splash screens, empty-state illustrations, typography spec, social preview images. `brand/BRAND-KIT.md` has usage rules. |
| `uisamples/` | Early UI mockup images. **Non-binding** — no requirement or implementation decision may be derived from these alone (standing rule AFR-003 in `AGENT.md`); they're reference/mood only. |
| `README.md` (root) | Currently documents the **brand asset pack** (`brand/`), not the project as a whole — worth knowing so you don't expect a project overview here. Noted as-is, not silently changed. |

## Planning, spec, and execution-evidence artifacts

| Path | What it is |
|---|---|
| `_bmad-output/planning-artifacts/specs/` | Approved design specs (SIA's `writing-spec` stage output) — e.g. the AWS control-plane design, the AWS repo/CI/CD/environments design. |
| `_bmad-output/planning-artifacts/plans/` | Implementation plans broken down from an approved spec. |
| `_bmad-output/planning-artifacts/architecture/` | BMAD-authored architecture artifacts (e.g. `architecture-stash-2026-09-16/ARCHITECTURE-SPINE.md`). |
| `_bmad-output/planning-artifacts/ux-designs/` | BMAD-authored UX artifacts (`DESIGN.md`, `EXPERIENCE.md`). |
| `_bmad-output/planning-artifacts/sia/logs/` | SIA session logs. |
| `_bmad-output/planning-artifacts/sprint-change-proposal-*.md` | Scope-change proposals (impact analysis + recommended approach) for renegotiated requirements, e.g. the Trash/restore/purge addition. |
| `_bmad-output/implementation-artifacts/sdd/` | Execution evidence per task: brief, host-dispatch record, subagent report, reviewer verdict, per SIA's evidence gate (`AGENT.md` §7). |
| `_bmad-output/implementation-artifacts/stories/`, `spec-*.md` | Feature-level stories and standalone feature specs (e.g. the desktop mount feasibility spike), authored via BMAD's own spec format. |
| `_bmad-output/test-artifacts/` | Test-run evidence. |

**Why here and not `docs/`:** by explicit user decision at project intake,
SIA and BMAD share this one artifact location instead of splitting spec/plan
storage across two conventions. See `AGENT.md` §1.

## Generated, host-discoverable skills

| Path | What it is |
|---|---|
| `skills/stash-sia/` | SIA's generated project skill — derived from the PRD, spec, and `AGENT.md`; defers to `AGENT.md` on conflict. |
| `skills/stash-architecture/`, `skills/stash-aws/`, `skills/stash-backend/`, `skills/stash-ui/` | Additional project-specific skills generated for this project (architecture, AWS, backend, and UI domains). |

## Vendored tooling — read-only, off-limits to restructure

Two coexisting agent frameworks power different parts of this project's
workflow. Neither is SIA's (or this map's) to reorganize — listed here so
their purpose is clear, not as an invitation to move them:

| Path | What it is |
|---|---|
| `sia/` (gitignored) | Vendored SIA (Self-Improving Agents) instruction package — the governance layer this session and prior sessions have operated under. |
| `_bmad/` | Vendored BMAD tooling config and modules (`bmm`, `bmb`, `cis`, `gds`, `tea`, `bmad-loop`, `core`, `custom`, `render`, `scripts`). |
| `.claude/skills/bmad-*`, `.claude/skills/gds-*` | BMAD's host-discovery skill mirrors for Claude Code. |
| `.agent/skills/`, `.agents/skills/` | BMAD's skill mirrors for other hosts. |
| `.github/agents/*.agent.md` | BMAD's agent definitions (analyst, architect, dev, PM, UX designer, game-dev variants, etc.). |

## Loose / not yet accounted for

| Path | What it is |
|---|---|
| `.venv/` (gitignored) | A Python virtual environment. Recorded at intake as **unexplained** — not claimed as understood, not removed. If you know what it's for, worth a one-line note here. |

## Build/tooling config (root)

| Path | What it is |
|---|---|
| `package.json` | npm workspaces: `infra`, `services/shared`, `services/handlers/*`, `services/entrypoints`. Deliberately does **not** include `desktop/` (separate Cargo workspace). |
| `package-lock.json` | Locked dependency graph for the npm workspaces above. |
| `tsconfig.json`, `tsconfig.base.json` | Root TypeScript config; `include` is structural (`infra/**/*.ts`, `services/**/*.ts`) so a new package is typechecked automatically without a config edit (AFR-005). |
| `vitest.config.ts` | Test runner config — explicitly excludes `.claude/` so nested worktree checkouts under it are never double-discovered. |
| `.env` (gitignored), `.env.example` | AWS credentials and config. Never committed, never `cat`'d, never pasted into an artifact — see `AGENT.md` Rule 12. |
| `.nvmrc` | Node version pin (20). |
| `.gitignore` | Excludes vendored tooling, secrets, `node_modules/`, `cdk.out/`, `.venv/`. |
