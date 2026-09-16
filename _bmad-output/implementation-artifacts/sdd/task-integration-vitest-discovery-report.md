# Subagent report - root Vitest discovery boundary

## Change

Added the structural `**/.claude/**` exclusion to root Vitest discovery. This excludes nested agent worktrees regardless of their repository/package layout, while retaining `**/*.test.ts` for normal source trees. Added a focused assertion to the existing workspace-manifest test file, deliberately preserving the intended 34 test-file count.

## Initial evidence

Before the change, root discovery traversed `.claude/worktrees/dynamo-repository`; that nested worktree contains 34 `*.test.ts` files, matching the 34 test files in the root application trees.

## Verification

- `npx vitest run infra/test/workspace-manifest.test.ts --reporter=default`: pass, 1 file / 4 tests.
- `npm run typecheck`: exit 0.
- Full `npm test -- --silent --reporter=default`: pass, 35 files / 415 passed / 1 skipped. Output contains zero `.claude/` paths.
- File inventory before concurrent manifest-writer work: 34 root `*.test.ts` files and 34 nested-worktree `*.test.ts` files. One new root manifest repository test was added concurrently, accounting for the final 35-file total; it is normal application discovery, not duplicate worktree discovery.
