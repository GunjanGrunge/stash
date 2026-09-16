import { describe, expect, it } from "vitest";
import { MemoryReadRepository } from "../src/memory-repository.js";
import { getUsage } from "../src/get-usage.js";

const USER = "user-abc123";
const OTHER = "user-zzz999";

const ONE_TB = 1_099_511_627_776;

/** `null` means the authorizer produced no `sub` claim at all. */
function usageEvent(sub: string | null = USER): any {
  return {
    requestContext:
      sub === null
        ? { authorizer: { jwt: { claims: {} } } }
        : { authorizer: { jwt: { claims: { sub } } } },
    headers: {},
  };
}

function body(res: { body: string }): any {
  return JSON.parse(res.body);
}

describe("getUsage — storage indicator", () => {
  it("returns raw byte counts for the calling creator", async () => {
    const repo = new MemoryReadRepository();
    repo.seedProfile(USER, { usedBytes: 669_832_478_720, quotaBytes: ONE_TB });

    const res = await getUsage({ repo })(usageEvent());

    expect(res.statusCode).toBe(200);
    expect(body(res)).toEqual({
      usedBytes: 669_832_478_720,
      quotaBytes: ONE_TB,
      provisioned: true,
    });
  });

  it("returns numbers, never a pre-formatted string", async () => {
    const repo = new MemoryReadRepository();
    repo.seedProfile(USER, { usedBytes: 669_832_478_720, quotaBytes: ONE_TB });

    const payload = body(await getUsage({ repo })(usageEvent()));

    expect(typeof payload.usedBytes).toBe("number");
    expect(typeof payload.quotaBytes).toBe("number");
    // Formatting ("624 GB of 1 TB") is the client's job.
    expect(res_text(payload)).not.toMatch(/GB|TB|of /);
  });

  it("returns a zeroed, unprovisioned reading when no PROFILE exists yet", async () => {
    const repo = new MemoryReadRepository();

    const res = await getUsage({ repo })(usageEvent());

    expect(res.statusCode).toBe(200);
    expect(body(res)).toEqual({
      usedBytes: 0,
      quotaBytes: null,
      provisioned: false,
    });
  });

  it("rejects a request with no verified subject claim", async () => {
    const repo = new MemoryReadRepository();
    repo.seedProfile(USER, { usedBytes: 1, quotaBytes: ONE_TB });
    const res = await getUsage({ repo })(usageEvent(null));
    expect(res.statusCode).toBe(401);
    expect(body(res).code).toBe("unauthorized");
  });

  it("rejects an empty subject claim", async () => {
    const repo = new MemoryReadRepository();
    const res = await getUsage({ repo })(usageEvent(""));
    expect(res.statusCode).toBe(401);
  });

  it("never reports another creator's usage", async () => {
    const repo = new MemoryReadRepository();
    repo.seedProfile(OTHER, { usedBytes: 999_999_999, quotaBytes: ONE_TB });

    const res = await getUsage({ repo })(usageEvent(USER));

    expect(body(res)).toEqual({
      usedBytes: 0,
      quotaBytes: null,
      provisioned: false,
    });
    expect(res.body).not.toContain("999999999");
  });

  it("treats a PROFILE with malformed counters as unprovisioned rather than crashing", async () => {
    const repo = new MemoryReadRepository();
    repo.seedRawProfile(USER, { usedBytes: "lots", quotaBytes: null });

    const res = await getUsage({ repo })(usageEvent());

    expect(res.statusCode).toBe(200);
    expect(body(res)).toEqual({
      usedBytes: 0,
      quotaBytes: null,
      provisioned: false,
    });
  });

  it("maps an unexpected repository failure to 500 without leaking detail", async () => {
    const repo = {
      listStashes: async () => [],
      getUsage: async () => {
        throw new Error("dynamodb endpoint https://secret.internal failed");
      },
    };
    const res = await getUsage({ repo })(usageEvent());
    expect(res.statusCode).toBe(500);
    expect(res.body).not.toContain("secret.internal");
  });
});

function res_text(payload: unknown): string {
  return JSON.stringify(payload);
}
