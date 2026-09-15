# SIA Intake Record — STASH

**Date:** 2026-09-15
**Host:** Claude Code (Opus 5)
**SIA version:** v0.1.0-alpha (vendored at `sia/`)
**Project root:** `/mnt/c/Users/Bot/Desktop/stash`

## Intake Mode

**Mode 1 — Repository-informed exploration** (user-selected).

## Evidence Actually Read

| File | Extent |
|---|---|
| `sia/AGENT.md` | full (146 lines) |
| `sia/guides/questioning-and-approval.md` | full |
| `sia/guides/writing-spec.md` | full |
| `sia/guides/security-gate.md` | full |
| `sia/guides/attribution.md` | full |
| `sia/INSTALL.md` | full |
| `STASH_PRD_v0.1.md` | full (715 lines) |
| `_bmad/config.toml` | first 60 lines |
| `_bmad/config.user.toml` | full |

Nine files, inside the 15-file / ~40k-token soft budget. Directory listings
elsewhere (`.claude/`, `.agent/`, `.agents/`, `.github/`) are shape evidence
only — **their contents have not been read and are not claimed as known.**

## Project Type

**Greenfield software project** (user-confirmed). No application code exists
in the repository: `docs/` and `_bmad-output/` were empty, there is no source
tree, manifest, or test suite. `prd.md` at the root is 0 bytes. A `.venv/`
exists but is unexplained.

Security gate (`sia/guides/security-gate.md`): **armed** — software project.

## User Goal

Build **STASH**, a creator-first cloud drive (mounted drive on Windows and
macOS) that preserves the user's exact folder hierarchy, makes creator assets
searchable with deterministic non-LLM metadata search, and keeps them
available across devices without storing the whole library on every SSD.
AWS-first, ap-south-1, private beta of 2 users at 1 TB each.

**First SIA scope (user-selected):** the **AWS control-plane foundation** —
IaC, Cognito, API Gateway, Lambda, DynamoDB schema, least-privilege IAM,
budgets. Backend only; no desktop client in this scope.

## Knowns

- Product vision, principles, vocabulary, beta scope and the 10-point
  Definition of Private Beta Done — all stated explicitly in the PRD.
- Recommended AWS stack and logical data flow (PRD §11).
- DynamoDB metadata attribute list (PRD §11) and security requirements (§12).
- Explicit non-goals (PRD §14): chatbot, generative AI, auto-reorganization,
  teams/workspaces, mobile client, multi-region replication.

## Unknowns (open at end of Intake)

- **Desktop client technology is unspecified by the PRD.** User asked SIA to
  present 2–3 options with trade-offs as a later decision. Deferred — out of
  the first scope.
- **Filesystem mount approach** (WinFsp/ProjFS, macOS File Provider vs FUSE)
  — the product's highest technical risk, unaddressed by the PRD. Deferred.
- IaC tool, Lambda runtime, and deploy-vs-code-only posture — raised as a
  High-severity confirmation round before spec drafting.
- Whether an AWS account, region access and budget already exist.
- Purpose of the root `.venv/`.

## Competing Agent Framework Boundary

**BMAD is installed and is not SIA's to modify.**

- `_bmad/` — config.toml (project_name `stash`, output_folder
  `_bmad-output`), plus modules `bmm`, `bmb`, `cis`, `gds`, `tea`,
  `bmad-loop`, `core`, `custom`, `render`, `scripts`.
- Host-discovery skill mirrors: `.claude/skills/`, `.agent/skills/`,
  `.agents/skills/` — 1,354 files each.
- `.github/agents/` — 18 `*.agent.md` files.

**Coexistence decision (user-selected):** SIA runs its own pipeline, but
writes its artifacts into **BMAD's `_bmad-output/planning-artifacts/`** so
both frameworks share one artifact location. BMAD files are read and
coexisted with, never replaced. BMAD remains directly invocable by the user.

## Version Control

Project root was **not** a git repository at intake. User approved
`git init`; done on 2026-09-15. Git identity left untouched
(`ZmaRk Hacker <stdevilgunjan@gmail.com>`). A `.gitignore` was added
covering `sia/`, `_bmad/`, `.claude/`, `.agent/`, `.agents/`, `.venv/`.
**No commit has been made yet** — the first commit returns to the user for
approval.

## SIA Attribution

Mode: both (public-distribution default)
Applied: 2026-09-15
README status: pending — no README exists; to be created with the badge
during the first SIA-mediated work package.
Commit-trailer rule: `Assisted-by: SIA — Self-Improving Agents`;
`SIA-Run: <evidence path>`

## Open Items Flagged To User (not acted on)

1. `prd.md` at root is 0 bytes — delete, or fill?
2. `.github/agents/` (BMAD-generated) is untracked but not ignored; it would
   enter the first commit. Ignore it, or commit it as project history?
3. Unexplained `.venv/` at root (currently gitignored).
