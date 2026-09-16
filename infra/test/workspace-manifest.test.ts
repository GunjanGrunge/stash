import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import vitestConfig from "../../vitest.config";

/**
 * Guards the reproducibility of a clean checkout.
 *
 * A package that declares dependencies but is not matched by a root
 * `workspaces` pattern is never installed by `npm ci`. Locally this is
 * invisible — an earlier `npm install` left its modules on disk — so the
 * suite passes for the person who wrote it and fails for everyone else and in
 * CI. `services/entrypoints` shipped exactly that way: it declared the AWS SDK
 * packages the Lambda entry modules import, and nothing installed them.
 *
 * This test compares the declared workspace patterns against what is actually
 * on disk, so the failure surfaces as a named package rather than as a
 * missing-module error in an unrelated test file.
 */
function repoRoot(): string {
  let dir = process.cwd();
  for (;;) {
    if (existsSync(path.join(dir, "package.json"))) {
      const pkg = JSON.parse(
        readFileSync(path.join(dir, "package.json"), "utf8"),
      ) as { workspaces?: string[] };
      if (pkg.workspaces !== undefined) return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) throw new Error("repository root not found");
    dir = parent;
  }
}

const ROOT = repoRoot();

function rootWorkspaces(): string[] {
  const pkg = JSON.parse(
    readFileSync(path.join(ROOT, "package.json"), "utf8"),
  ) as { workspaces?: string[] };
  return pkg.workspaces ?? [];
}

/** Every directory containing a package.json, excluding the root and node_modules. */
function packageDirs(relative: string, depth = 3): string[] {
  const absolute = path.join(ROOT, relative);
  if (depth < 0 || !existsSync(absolute)) return [];
  const found: string[] = [];
  for (const entry of readdirSync(absolute, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === "node_modules") continue;
    const child = path.posix.join(relative, entry.name);
    if (existsSync(path.join(ROOT, child, "package.json"))) found.push(child);
    found.push(...packageDirs(child, depth - 1));
  }
  return found;
}

/** Matches npm's workspace globbing for the only forms this repo uses. */
function matches(pattern: string, dir: string): boolean {
  if (pattern === dir) return true;
  if (!pattern.endsWith("/*")) return false;
  const prefix = pattern.slice(0, -2);
  return path.posix.dirname(dir) === prefix;
}

describe("workspace manifest", () => {
  it("keeps nested agent worktrees out of root test discovery", () => {
    const testConfig = vitestConfig.test;
    expect(testConfig?.include).toEqual(["**/*.test.ts"]);
    expect(testConfig?.exclude).toContain("**/.claude/**");
  });

  it("covers every package on disk, so npm ci installs all of them", () => {
    const patterns = rootWorkspaces();
    const onDisk = [...packageDirs("services"), ...packageDirs("infra", 0)];
    expect(onDisk.length).toBeGreaterThan(0);

    const uncovered = onDisk.filter(
      (dir) => !patterns.some((pattern) => matches(pattern, dir)),
    );
    // Named explicitly: a bare "expected 1 to be 0" would not say which.
    expect(uncovered).toEqual([]);
  });

  it("lists no workspace pattern that matches nothing", () => {
    const onDisk = [...packageDirs("services"), ...packageDirs("infra", 0), "infra"];
    const empty = rootWorkspaces().filter(
      (pattern) => !onDisk.some((dir) => matches(pattern, dir)),
    );
    expect(empty).toEqual([]);
  });

  it("keeps the lockfile aware of every workspace", () => {
    const lock = JSON.parse(
      readFileSync(path.join(ROOT, "package-lock.json"), "utf8"),
    ) as { packages?: Record<string, unknown> };
    const packages = lock.packages ?? {};

    const onDisk = [...packageDirs("services"), ...packageDirs("infra", 0)];
    // npm records each workspace under its path. A package missing here is one
    // `npm ci` will not install, which is the defect this file exists to catch.
    const missing = onDisk.filter((dir) => packages[dir] === undefined);
    expect(missing).toEqual([]);
  });
});
