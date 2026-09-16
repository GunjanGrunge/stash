import { describe, it, expect } from "vitest";
import { MemoryStashRepository } from "../src/memory-repository.js";
import { createStash } from "../src/create-stash.js";

const USER = "user-abc123";
const OTHER = "user-zzz999";

function event(
  body: unknown,
  opts: { sub?: string | null; idempotencyKey?: string } = {},
): any {
  const sub = opts.sub === undefined ? USER : opts.sub;
  return {
    requestContext: {
      authorizer: sub === null ? {} : { jwt: { claims: { sub } } },
    },
    headers:
      opts.idempotencyKey === undefined
        ? {}
        : { "Idempotency-Key": opts.idempotencyKey },
    body: JSON.stringify(
      body !== null && typeof body === "object" && !Array.isArray(body)
        ? { manifestFolderName: "Sample Pack", ...(body as Record<string, unknown>) }
        : body,
    ),
  };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function repoWithQuota(quotaBytes: number, usedBytes = 0): MemoryStashRepository {
  const repo = new MemoryStashRepository();
  repo.seedProfile(USER, { quotaBytes, usedBytes });
  repo.seedProfile(OTHER, { quotaBytes, usedBytes });
  return repo;
}

describe("createStash", () => {
  it("opens a Stash and reserves the manifest total against the profile", async () => {
    const repo = repoWithQuota(1_000, 100);
    const res = await createStash({ repo })(
      event({ manifestTotalBytes: 400, manifestFileCount: 3 }),
    );

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.stashId).toMatch(UUID_RE);
    expect(body.state).toBe("open");

    const stash = await repo.getStash(USER, body.stashId);
    expect(stash).toBeDefined();
    expect(stash!.state).toBe("open");
    expect(stash!.reservedBytes).toBe(400);
    expect(stash!.committedBytes).toBe(0);
    expect(stash!.committedCount).toBe(0);
    expect(stash!.fileCount).toBe(3);
    expect(stash!.pk).toBe(`USER#${USER}`);
    expect(stash!.sk).toBe(`STASH#${body.stashId}`);
    expect(stash!.startedAt).toEqual(expect.any(String));

    // The reservation is server-side and immediate.
    expect((await repo.getProfile(USER))!.usedBytes).toBe(500);
  });

  it("rejects a request with no verified subject claim (401)", async () => {
    const repo = repoWithQuota(1_000);
    const res = await createStash({ repo })(
      event({ manifestTotalBytes: 1 }, { sub: null }),
    );
    expect(res.statusCode).toBe(401);
    expect(repo.allStashes()).toHaveLength(0);
    expect((await repo.getProfile(USER))!.usedBytes).toBe(0);
  });

  it("rejects an empty subject claim (401)", async () => {
    const repo = repoWithQuota(1_000);
    const res = await createStash({ repo })(
      event({ manifestTotalBytes: 1 }, { sub: "" }),
    );
    expect(res.statusCode).toBe(401);
    expect(repo.allStashes()).toHaveLength(0);
  });

  it("ignores a user_id in the body — the reservation lands on the JWT subject only (Rule 7)", async () => {
    const repo = repoWithQuota(1_000);
    const res = await createStash({ repo })(
      event({ manifestTotalBytes: 200, user_id: OTHER, userId: OTHER }),
    );
    expect(res.statusCode).toBe(201);

    expect((await repo.getProfile(USER))!.usedBytes).toBe(200);
    expect((await repo.getProfile(OTHER))!.usedBytes).toBe(0);
    expect(repo.allStashes().every((s) => s.pk === `USER#${USER}`)).toBe(true);
  });

  it("returns 507 and creates NO Stash when the reservation would exceed quota", async () => {
    const repo = repoWithQuota(1_000, 900);
    const res = await createStash({ repo })(
      event({ manifestTotalBytes: 101, manifestFileCount: 2 }),
    );

    expect(res.statusCode).toBe(507);
    expect(JSON.parse(res.body).code).toBe("quota_exceeded");
    expect(repo.allStashes()).toHaveLength(0);
    expect((await repo.getProfile(USER))!.usedBytes).toBe(900);
  });

  it("allows a reservation that lands exactly on the quota boundary", async () => {
    const repo = repoWithQuota(1_000, 900);
    const res = await createStash({ repo })(event({ manifestTotalBytes: 100 }));
    expect(res.statusCode).toBe(201);
    expect((await repo.getProfile(USER))!.usedBytes).toBe(1_000);
  });

  it("fails closed with 507 when the caller has no profile — quota is never assumed", async () => {
    const repo = new MemoryStashRepository();
    const res = await createStash({ repo })(event({ manifestTotalBytes: 1 }));
    expect(res.statusCode).toBe(507);
    expect(repo.allStashes()).toHaveLength(0);
  });

  it("replays an Idempotency-Key without opening a second Stash or reserving twice", async () => {
    const repo = repoWithQuota(1_000);
    const handler = createStash({ repo });
    const first = await handler(
      event({ manifestTotalBytes: 300 }, { idempotencyKey: "key-1" }),
    );
    const second = await handler(
      event({ manifestTotalBytes: 300 }, { idempotencyKey: "key-1" }),
    );

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(first.statusCode);
    expect(second.body).toBe(first.body);
    expect(repo.allStashes()).toHaveLength(1);
    expect((await repo.getProfile(USER))!.usedBytes).toBe(300);
  });

  it("scopes the Idempotency-Key per caller — another creator's key is not replayed", async () => {
    const repo = repoWithQuota(1_000);
    const handler = createStash({ repo });
    const mine = await handler(
      event({ manifestTotalBytes: 300 }, { idempotencyKey: "key-1" }),
    );
    const theirs = await handler(
      event({ manifestTotalBytes: 300 }, { sub: OTHER, idempotencyKey: "key-1" }),
    );
    expect(JSON.parse(theirs.body).stashId).not.toBe(JSON.parse(mine.body).stashId);
    expect(repo.allStashes()).toHaveLength(2);
  });

  it("rejects a malformed manifest total (400) and writes nothing", async () => {
    const repo = repoWithQuota(1_000);
    for (const bad of [undefined, -1, "400", Number.NaN, 1.5, Number.MAX_SAFE_INTEGER + 2]) {
      const res = await createStash({ repo })(
        event({ manifestTotalBytes: bad as never }),
      );
      expect(res.statusCode, `manifestTotalBytes=${String(bad)}`).toBe(400);
    }
    expect(repo.allStashes()).toHaveLength(0);
    expect((await repo.getProfile(USER))!.usedBytes).toBe(0);
  });
});
