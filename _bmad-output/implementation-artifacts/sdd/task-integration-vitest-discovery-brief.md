# Task brief - root Vitest discovery boundary

## Goal

Prevent root Vitest from discovering tests inside nested agent worktrees while retaining glob-based discovery for all present and future application packages.

## Scope

- `vitest.config.ts`
- A focused regression assertion in an existing root test file
- Required execution evidence only

## Constraints

- Exclude the `.claude` worktree container structurally; do not enumerate application package directories.
- Do not modify handler, infrastructure, dependency, or deployment logic.
- Prove the root suite discovers the intended 34 files once and excludes the 34 test files in `.claude/worktrees/dynamo-repository`.

## Acceptance criteria

1. Root discovery is limited to the 34 root test files, not the doubled nested-worktree set.
2. The configuration regression assertion protects the exclusion without constraining future `services/` or `infra/` packages.
3. `npm run typecheck` remains green.
