import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["**/*.test.ts"],
    // Agent worktrees are complete nested repositories. Without this boundary,
    // a root run discovers and executes their test suites as if they belonged
    // to this checkout. Keep application discovery glob-based; exclude the
    // worktree container rather than enumerating application packages.
    exclude: ["**/node_modules/**", "**/.claude/**"],
    environment: "node",
  },
});
