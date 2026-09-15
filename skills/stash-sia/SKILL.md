---
name: stash-sia
description: Use when working on STASH — the creator-first cloud drive (mounted Windows/macOS drive, AWS-first, ap-south-1). Loads the project contract, the approved AWS control-plane spec, and the delegation/evidence gate before any STASH implementation work.
---

# STASH — Project Operating Skill

## Purpose and Trigger

Load this skill at the start of any session that touches STASH: the AWS
control plane, the desktop client, the search engine, or the product's
specs and plans. It re-establishes the project contract so a fresh session
does not re-derive it — or quietly contradict it.

STASH is a creator-first cloud drive that preserves a creator's exact folder
hierarchy, keeps payloads in the cloud, makes assets searchable through
deterministic (non-LLM) metadata, and follows the user across devices.
*"Stash it. Find it. Use it anywhere."*

## Provenance

| Artifact | Path |
|---|---|
| Project contract (authority) | `AGENT.md` |
| Product source of truth | `STASH_PRD_v0.1.md` |
| Approved spec | `_bmad-output/planning-artifacts/specs/2026-09-15-aws-control-plane-design.md` |
| Intake record | `_bmad-output/planning-artifacts/2026-09-15-sia-intake-record.md` |
| Implementation plan | `_bmad-output/planning-artifacts/plans/` |
| Execution evidence | `_bmad-output/implementation-artifacts/sdd/` |

Generated 2026-09-15 by SIA, after intake and spec approval, because this
project needs a durable re-entry point that carries the PRD's invariants
into every later session.

## Authority and Scope

This skill defers to direct user instructions first, then to `AGENT.md`.
Where this skill and `AGENT.md` disagree, **`AGENT.md` is correct**. This
skill does not broaden the project goal: the current approved scope is the
AWS control-plane foundation. The desktop client, the mounted-drive layer,
the search engine, metadata extraction and local caching are **not** in
scope until a new spec is approved.

## Project-Derived Operating Rules

Stack (decided 2026-09-15, not assumed): **AWS CDK** for IaC,
**TypeScript/Node.js** Lambdas, **DynamoDB single-table**, **S3 with SSE-S3,
versioning off, Standard storage class**, **Cognito with MFA optional**,
region **ap-south-1**.

Invariants that must survive every change:

1. Never reorganize a user's library; `original_relative_path` is verbatim.
2. File, Folder and Stash are three distinct concepts — never collapsed.
3. A checksum match is never an identity match; nothing is deleted or
   repointed on a hash match.
4. Nothing is "Stashed" until verified committed against S3.
5. No LLM call in any product runtime path.
6. S3 keys are `users/<user_id>/<file_id>` — opaque IDs, never creator paths.
7. `user_id` comes only from verified JWT claims.
8. Versioning is off — never overwrite a key; every Stash writes a new `file_id`.
9. Payload bytes never transit Lambda or API Gateway.
10. STASH vocabulary in user-facing text (Stash it / Stashing / Stashed /
    Recent Stashes / Free up space).
11. Never write AWS credentials into the repo, a skill file, or a log.

Acceptance checks: `cdk synth` succeeds; unit tests per handler; CDK
assertion tests fail the build on any `Resource: "*"` or any route missing
its JWT authorizer; DynamoDB Local integration tests; and a property test
proving random unicode folder trees round-trip byte-identically.

## Execution Gate

Claude Code supports subagents, so **the controller must not implement a
task-owned file itself.** Every implementation task produces five artifacts
under `_bmad-output/implementation-artifacts/sdd/`: task brief, host-dispatch
record, subagent report, reviewer verdict, progress-log entry. A missing
artifact is a DEVIATION (`framework-default-override`), not a shortcut.

After all tasks pass individual review, run one Integration phase: full
suite, cross-task interface verification in combined code, and a review of
the whole plan's combined diff as one unit.

## Human Gates and Reporting

- Severity threshold: standard. **Anything that creates, mutates or destroys
  an AWS resource is High and blocks on explicit approval immediately before
  it runs** — never bundled into a larger approval.
- Approvals, status, usage and integration evidence are recorded in the
  session log at
  `_bmad-output/planning-artifacts/sia/logs/sessions/YYYY-MM-DD-session-NN.md`,
  appended as work happens, with `tool=<harness>` on every session-start
  entry and a usage figure (tokens, or a labelled proxy) on every entry.
- DEVIATIONs are captured per `sia/capture-interface.md` and folded into
  `AGENT.md` §4 as standing rules with full provenance.

## Attribution Policy

Mode: **both** (SIA public-distribution default). README badge at `README.md`
(pending creation). Trailers on SIA-mediated commits only:

```text
Assisted-by: SIA — Self-Improving Agents
SIA-Run: <project-relative path to the sdd/ report or session log>
```

Preserve the human Git author and committer exactly. Never use
`Co-authored-by` for SIA, never fabricate a GitHub identity, never alter
`user.name`/`user.email`, never amend prior commits.
