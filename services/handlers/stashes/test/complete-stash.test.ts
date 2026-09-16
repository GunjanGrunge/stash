import { describe, it, expect } from "vitest";
import { MemoryStashRepository } from "../src/memory-repository.js";
import { completeStash } from "../src/complete-stash.js";

const USER = "user-abc123";
const OTHER = "user-zzz999";

function event(
  stashId: string,
  opts: { sub?: string | null; idempotencyKey?: string } = {},
): any {
  const sub = opts.sub === undefined ? USER : opts.sub;
  return {
    requestContext: {
      authorizer: sub === null ? {} : { jwt: { claims: { sub } } },
    },
    pathParameters: { id: stashId },
    headers:
      opts.idempotencyKey === undefined
        ? {}
        : { "Idempotency-Key": opts.idempotencyKey },
  };
}

describe("completeStash", () => {
  it("reconciles DOWNWARD when less was committed than reserved", async () => {
    const repo = new MemoryStashRepository();
    repo.seedProfile(USER, { quotaBytes: 10_000, usedBytes: 1_000 });
    const stashId = repo.seedStash(USER, {
      state: "open",
      fileCount: 3,
      reservedBytes: 1_000,
    });
    repo.seedFile(USER, stashId, { fileId: "a", state: "committed", sizeBytes: 250 });
    repo.seedFile(USER, stashId, { fileId: "b", state: "committed", sizeBytes: 350 });

    const res = await completeStash({ repo })(event(stashId));

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toMatchObject({
      stashId,
      state: "completed",
      committedCount: 2,
      committedBytes: 600,
    });

    const stash = await repo.getStash(USER, stashId);
    expect(stash!.state).toBe("completed");
    expect(stash!.committedCount).toBe(2);
    expect(stash!.committedBytes).toBe(600);
    // 1000 reserved -> 600 actual: 400 handed back.
    expect((await repo.getProfile(USER))!.usedBytes).toBe(600);
  });

  it("reconciles UPWARD when more was committed than reserved", async () => {
    const repo = new MemoryStashRepository();
    repo.seedProfile(USER, { quotaBytes: 10_000, usedBytes: 600 });
    const stashId = repo.seedStash(USER, { state: "open", reservedBytes: 600 });
    repo.seedFile(USER, stashId, { fileId: "a", state: "committed", sizeBytes: 1_000 });

    const res = await completeStash({ repo })(event(stashId));

    expect(res.statusCode).toBe(200);
    expect((await repo.getProfile(USER))!.usedBytes).toBe(1_000);
  });

  it("is exact when reserved equals committed", async () => {
    const repo = new MemoryStashRepository();
    repo.seedProfile(USER, { quotaBytes: 10_000, usedBytes: 500 });
    const stashId = repo.seedStash(USER, { state: "open", reservedBytes: 500 });
    repo.seedFile(USER, stashId, { fileId: "a", state: "committed", sizeBytes: 500 });

    await completeStash({ repo })(event(stashId));
    expect((await repo.getProfile(USER))!.usedBytes).toBe(500);
  });

  it("counts ONLY files already verified committed (Rule 4)", async () => {
    const repo = new MemoryStashRepository();
    repo.seedProfile(USER, { quotaBytes: 10_000, usedBytes: 1_000 });
    const stashId = repo.seedStash(USER, { state: "open", reservedBytes: 1_000 });
    repo.seedFile(USER, stashId, { fileId: "a", state: "committed", sizeBytes: 100 });
    repo.seedFile(USER, stashId, { fileId: "b", state: "pending", sizeBytes: 200 });
    repo.seedFile(USER, stashId, { fileId: "c", state: "uploading", sizeBytes: 400 });
    repo.seedFile(USER, stashId, { fileId: "d", state: "failed", sizeBytes: 800 });

    const res = await completeStash({ repo })(event(stashId));

    expect(JSON.parse(res.body)).toMatchObject({ committedCount: 1, committedBytes: 100 });
    expect((await repo.getProfile(USER))!.usedBytes).toBe(100);
  });

  it("ignores files belonging to a different Stash of the same creator", async () => {
    const repo = new MemoryStashRepository();
    repo.seedProfile(USER, { quotaBytes: 10_000, usedBytes: 1_000 });
    const mine = repo.seedStash(USER, { state: "open", reservedBytes: 400 });
    const other = repo.seedStash(USER, { state: "open", reservedBytes: 600 });
    repo.seedFile(USER, mine, { fileId: "a", state: "committed", sizeBytes: 400 });
    repo.seedFile(USER, other, { fileId: "b", state: "committed", sizeBytes: 600 });

    const res = await completeStash({ repo })(event(mine));
    expect(JSON.parse(res.body)).toMatchObject({ committedCount: 1, committedBytes: 400 });
    expect((await repo.getProfile(USER))!.usedBytes).toBe(1_000);
  });

  it("rejects a request with no verified subject claim (401)", async () => {
    const repo = new MemoryStashRepository();
    repo.seedProfile(USER, { quotaBytes: 10_000, usedBytes: 500 });
    const stashId = repo.seedStash(USER, { state: "open", reservedBytes: 500 });

    const res = await completeStash({ repo })(event(stashId, { sub: null }));
    expect(res.statusCode).toBe(401);
    expect((await repo.getStash(USER, stashId))!.state).toBe("open");
    expect((await repo.getProfile(USER))!.usedBytes).toBe(500);
  });

  it("returns 404 — not 403 — for another creator's Stash and changes nothing", async () => {
    const repo = new MemoryStashRepository();
    repo.seedProfile(USER, { quotaBytes: 10_000, usedBytes: 500 });
    repo.seedProfile(OTHER, { quotaBytes: 10_000, usedBytes: 0 });
    const stashId = repo.seedStash(USER, { state: "open", reservedBytes: 500 });
    repo.seedFile(USER, stashId, { fileId: "a", state: "committed", sizeBytes: 500 });

    const res = await completeStash({ repo })(event(stashId, { sub: OTHER }));

    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body).code).toBe("not_found");
    expect((await repo.getStash(USER, stashId))!.state).toBe("open");
    expect((await repo.getProfile(USER))!.usedBytes).toBe(500);
    expect((await repo.getProfile(OTHER))!.usedBytes).toBe(0);
  });

  it("returns 404 for a Stash id that does not exist", async () => {
    const repo = new MemoryStashRepository();
    repo.seedProfile(USER, { quotaBytes: 10_000, usedBytes: 0 });
    const res = await completeStash({ repo })(event("nope"));
    expect(res.statusCode).toBe(404);
  });

  it("refuses to complete a cancelled Stash (409) and does not re-reserve", async () => {
    const repo = new MemoryStashRepository();
    repo.seedProfile(USER, { quotaBytes: 10_000, usedBytes: 0 });
    const stashId = repo.seedStash(USER, { state: "cancelled", reservedBytes: 500 });
    repo.seedFile(USER, stashId, { fileId: "a", state: "committed", sizeBytes: 500 });

    const res = await completeStash({ repo })(event(stashId));
    expect(res.statusCode).toBe(409);
    expect((await repo.getProfile(USER))!.usedBytes).toBe(0);
  });

  it("is safe to call twice: the second call is 409 and never reconciles twice", async () => {
    const repo = new MemoryStashRepository();
    repo.seedProfile(USER, { quotaBytes: 10_000, usedBytes: 1_000 });
    const stashId = repo.seedStash(USER, { state: "open", reservedBytes: 1_000 });
    repo.seedFile(USER, stashId, { fileId: "a", state: "committed", sizeBytes: 600 });

    const handler = completeStash({ repo });
    expect((await handler(event(stashId))).statusCode).toBe(200);
    expect((await repo.getProfile(USER))!.usedBytes).toBe(600);

    const second = await handler(event(stashId));
    expect(second.statusCode).toBe(409);
    expect((await repo.getProfile(USER))!.usedBytes).toBe(600);
  });

  it("replays an Idempotency-Key with the original result and reconciles once", async () => {
    const repo = new MemoryStashRepository();
    repo.seedProfile(USER, { quotaBytes: 10_000, usedBytes: 1_000 });
    const stashId = repo.seedStash(USER, { state: "open", reservedBytes: 1_000 });
    repo.seedFile(USER, stashId, { fileId: "a", state: "committed", sizeBytes: 600 });

    const handler = completeStash({ repo });
    const first = await handler(event(stashId, { idempotencyKey: "done-1" }));
    const second = await handler(event(stashId, { idempotencyKey: "done-1" }));

    expect(first.statusCode).toBe(200);
    expect(second.body).toBe(first.body);
    expect((await repo.getProfile(USER))!.usedBytes).toBe(600);
  });
});
