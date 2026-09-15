/**
 * The same hierarchy round-trip against a REAL DynamoDB Local instance.
 *
 * DynamoDB Local needs either a running Docker daemon or a local Java
 * runtime. When neither is available this suite is SKIPPED with an explicit
 * reason naming the missing prerequisite — it must never silently pass and
 * must never be mistaken for evidence that the round trip was proven against
 * real DynamoDB.
 */
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";

const req = createRequire(import.meta.url);

function canRun(cmd: string, args: string[]): boolean {
  try {
    execFileSync(cmd, args, { stdio: "ignore", timeout: 15_000 });
    return true;
  } catch {
    return false;
  }
}

function detectMissingPrerequisites(): string[] {
  const missing: string[] = [];
  if (!canRun("docker", ["info"])) {
    missing.push("a running Docker daemon (`docker info` failed)");
  }
  if (!canRun("java", ["-version"])) {
    missing.push("a Java runtime (`java -version` failed)");
  }
  try {
    req.resolve("@aws-sdk/client-dynamodb");
  } catch {
    missing.push("the @aws-sdk/client-dynamodb package");
  }
  return missing;
}

const missing = detectMissingPrerequisites();
const available = missing.length === 0;
const reason = available
  ? ""
  : `SKIPPED — DynamoDB Local cannot run here: missing ${missing.join("; ")}. ` +
    `The hierarchy round trip is proven against MemoryRepository in ` +
    `test/hierarchy-property.test.ts; it is NOT proven against real DynamoDB in this environment.`;

describe("DynamoDB Local prerequisites", () => {
  it("reports explicitly whether the real-DynamoDB round trip ran", () => {
    if (!available) {
      console.log(`[dynamodb-local] ${reason}`);
      expect(reason).toContain("SKIPPED");
      expect(missing.length).toBeGreaterThan(0);
    } else {
      expect(missing).toEqual([]);
    }
  });
});

const suite = available ? describe : describe.skip;

suite(`hierarchy round-trip against DynamoDB Local ${reason}`, () => {
  it("round-trips a folder tree byte-identically through real DynamoDB", async () => {
    // Indirect specifier: the package is absent here, and this suite only
    // ever runs where the prerequisites above are satisfied.
    const spec = "@aws-sdk/client-dynamodb";
    const mod = (await import(/* @vite-ignore */ spec)) as Record<string, unknown>;
    expect(typeof mod["DynamoDBClient"]).toBe("function");
    throw new Error(
      "not implemented: DynamoDB Local round trip requires a prerequisite-bearing environment",
    );
  });
});
