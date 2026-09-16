import { describe, it, expect } from "vitest";
import { MemoryStashRepository } from "../src/memory-repository.js";
import { cancelStash } from "../src/cancel-stash.js";

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

/** A 4.2 GB dedupe check, as in spec §5. */
const GB = 1_024 * 1_024 * 1_024;
const RESERVED = Math.round(4.2 * GB);

function seeded(): { repo: MemoryStashRepository; stashId: string } {
  const repo = new MemoryStashRepository();
  repo.seedProfile(USER, { quotaBytes: 100 * GB, usedBytes: RESERVED });
  repo.seedProfile(OTHER, { quotaBytes: 100 * GB, usedBytes: 0 });
  const stashId = repo.seedStash(USER, {
    state: "open",
    fileCount: 1_850,
    reservedBytes: RESERVED,
  });
  return { repo, stashId };
}

describe("cancelStash", () => {
  it("releases the whole reservation, closes the Stash, and deletes pending files", async () => {
    const { repo, stashId } = seeded();
    repo.seedFile(USER, stashId, { fileId: "f1", state: "pending", sizeBytes: 10 });
    repo.seedFile(USER, stashId, { fileId: "f2", state: "pending", sizeBytes: 20 });
    // Another Stash's file must not be touched.
    const otherStash = repo.seedStash(USER, { state: "open", reservedBytes: 0 });
    repo.seedFile(USER, otherStash, { fileId: "f3", state: "pending", sizeBytes: 30 });

    const res = await cancelStash({ repo })(event(stashId));

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toMatchObject({ stashId, state: "cancelled" });

    const stash = await repo.getStash(USER, stashId);
    expect(stash!.state).toBe("cancelled");
    // 4.2 GB released, not stranded.
    expect((await repo.getProfile(USER))!.usedBytes).toBe(0);

    expect(await repo.listStashFiles(USER, stashId)).toHaveLength(0);
    expect(await repo.listStashFiles(USER, otherStash)).toHaveLength(1);
  });

  it("never deletes files that are already committed — only pending records go (Rule 1/4)", async () => {
    const { repo, stashId } = seeded();
    repo.seedFile(USER, stashId, { fileId: "p1", state: "pending", sizeBytes: 10 });
    repo.seedFile(USER, stashId, { fileId: "c1", state: "committed", sizeBytes: 500 });
    repo.seedFile(USER, stashId, { fileId: "u1", state: "uploading", sizeBytes: 50 });

    await cancelStash({ repo })(event(stashId));

    const left = (await repo.listStashFiles(USER, stashId)).map((f) => f.fileId).sort();
    expect(left).toEqual(["c1", "u1"]);
  });

  it("releases only the OUTSTANDING reservation when part of the Stash already committed", async () => {
    const repo = new MemoryStashRepository();
    repo.seedProfile(USER, { quotaBytes: 10_000, usedBytes: 1_000 });
    const stashId = repo.seedStash(USER, {
      state: "open",
      reservedBytes: 1_000,
      committedBytes: 400,
      committedCount: 2,
    });

    const res = await cancelStash({ repo })(event(stashId));

    expect(res.statusCode).toBe(200);
    // The 400 committed bytes are real stored objects and stay counted.
    expect((await repo.getProfile(USER))!.usedBytes).toBe(400);
  });

  it("rejects a request with no verified subject claim (401)", async () => {
    const { repo, stashId } = seeded();
    const res = await cancelStash({ repo })(event(stashId, { sub: null }));
    expect(res.statusCode).toBe(401);
    expect((await repo.getStash(USER, stashId))!.state).toBe("open");
    expect((await repo.getProfile(USER))!.usedBytes).toBe(RESERVED);
  });

  it("returns 404 — not 403 — for another creator's Stash, and releases nothing", async () => {
    const { repo, stashId } = seeded();
    const res = await cancelStash({ repo })(event(stashId, { sub: OTHER }));

    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body).code).toBe("not_found");
    expect((await repo.getStash(USER, stashId))!.state).toBe("open");
    expect((await repo.getProfile(USER))!.usedBytes).toBe(RESERVED);
    expect((await repo.getProfile(OTHER))!.usedBytes).toBe(0);
  });

  it("returns 404 for a Stash id that does not exist", async () => {
    const { repo } = seeded();
    const res = await cancelStash({ repo })(event("no-such-stash"));
    expect(res.statusCode).toBe(404);
  });

  it("DOUBLE CANCEL: the second call is a 409 and does NOT release the quota twice", async () => {
    const { repo, stashId } = seeded();

    const first = await cancelStash({ repo })(event(stashId));
    expect(first.statusCode).toBe(200);
    const afterFirst = (await repo.getProfile(USER))!.usedBytes;
    expect(afterFirst).toBe(0);

    const second = await cancelStash({ repo })(event(stashId));

    expect(second.statusCode).toBe(409);
    expect(JSON.parse(second.body).code).toBe("conflict");
    // The load-bearing assertion: a second release would drive usedBytes to
    // -4.2 GB and hand the creator free storage forever.
    expect((await repo.getProfile(USER))!.usedBytes).toBe(afterFirst);
    expect((await repo.getStash(USER, stashId))!.state).toBe("cancelled");
  });

  it("refuses to cancel a completed Stash (409) and does not double-release", async () => {
    const repo = new MemoryStashRepository();
    repo.seedProfile(USER, { quotaBytes: 10_000, usedBytes: 600 });
    const stashId = repo.seedStash(USER, {
      state: "completed",
      reservedBytes: 600,
      committedBytes: 600,
    });

    const res = await cancelStash({ repo })(event(stashId));
    expect(res.statusCode).toBe(409);
    expect((await repo.getProfile(USER))!.usedBytes).toBe(600);
  });

  it("replays an Idempotency-Key with the original result and one release only", async () => {
    const { repo, stashId } = seeded();
    const handler = cancelStash({ repo });

    const first = await handler(event(stashId, { idempotencyKey: "cancel-1" }));
    const second = await handler(event(stashId, { idempotencyKey: "cancel-1" }));

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(second.body).toBe(first.body);
    expect((await repo.getProfile(USER))!.usedBytes).toBe(0);
  });
});
