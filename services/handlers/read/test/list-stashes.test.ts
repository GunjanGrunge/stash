import { describe, expect, it } from "vitest";
import { MemoryReadRepository } from "../src/memory-repository.js";
import { listStashes } from "../src/list-stashes.js";
import type { StashRecord } from "../src/types.js";

const USER = "user-abc123";
const OTHER = "user-zzz999";

/** `null` means the authorizer produced no `sub` claim at all. */
function listEvent(
  query?: Record<string, string>,
  sub: string | null = USER,
): any {
  return {
    requestContext:
      sub === null
        ? { authorizer: { jwt: { claims: {} } } }
        : { authorizer: { jwt: { claims: { sub } } } },
    headers: {},
    queryStringParameters: query,
  };
}

/** A Stash exactly as the write-side agent persists it (pinned shape). */
function stash(
  userId: string,
  stashId: string,
  startedAt: string,
  overrides: Partial<StashRecord> = {},
): StashRecord {
  return {
    pk: `USER#${userId}`,
    sk: `STASH#${stashId}`,
    entity: "STASH",
    stashId,
    state: "completed",
    fileCount: 3,
    committedCount: 3,
    reservedBytes: 300,
    committedBytes: 300,
    startedAt,
    updatedAt: startedAt,
    ...overrides,
  };
}

function body(res: { body: string }): any {
  return JSON.parse(res.body);
}

describe("listStashes — Recent Stashes", () => {
  it("returns the caller's Stashes most-recent-first", async () => {
    const repo = new MemoryReadRepository();
    repo.seedStash(stash(USER, "s-old", "2026-09-01T10:00:00.000Z"));
    repo.seedStash(stash(USER, "s-new", "2026-09-14T10:00:00.000Z"));
    repo.seedStash(stash(USER, "s-mid", "2026-09-07T10:00:00.000Z"));

    const res = await listStashes({ repo })(listEvent());

    expect(res.statusCode).toBe(200);
    expect(body(res).stashes.map((s: any) => s.stashId)).toEqual([
      "s-new",
      "s-mid",
      "s-old",
    ]);
    expect(body(res).nextCursor).toBeNull();
  });

  it("returns the pinned Stash attributes and never key material", async () => {
    const repo = new MemoryReadRepository();
    repo.seedStash(
      stash(USER, "s-1", "2026-09-14T10:00:00.000Z", {
        state: "open",
        fileCount: 12,
        committedCount: 4,
        reservedBytes: 4096,
        committedBytes: 1024,
        updatedAt: "2026-09-14T11:00:00.000Z",
      }),
    );

    const [item] = body(await listStashes({ repo })(listEvent())).stashes;

    expect(item).toEqual({
      stashId: "s-1",
      state: "open",
      fileCount: 12,
      committedCount: 4,
      reservedBytes: 4096,
      committedBytes: 1024,
      startedAt: "2026-09-14T10:00:00.000Z",
      updatedAt: "2026-09-14T11:00:00.000Z",
    });
    // pk/sk are key material: they must never cross the wire.
    expect(res_keys(item)).not.toContain("pk");
    expect(res_keys(item)).not.toContain("sk");
  });

  it("returns an empty list for a creator with no Stashes yet", async () => {
    const repo = new MemoryReadRepository();
    const res = await listStashes({ repo })(listEvent());
    expect(res.statusCode).toBe(200);
    expect(body(res).stashes).toEqual([]);
    expect(body(res).nextCursor).toBeNull();
  });

  it("rejects a request with no verified subject claim", async () => {
    const repo = new MemoryReadRepository();
    repo.seedStash(stash(USER, "s-1", "2026-09-14T10:00:00.000Z"));
    const res = await listStashes({ repo })(listEvent(undefined, null));
    expect(res.statusCode).toBe(401);
    expect(body(res).code).toBe("unauthorized");
  });

  it("rejects an empty subject claim", async () => {
    const repo = new MemoryReadRepository();
    const res = await listStashes({ repo })(listEvent(undefined, ""));
    expect(res.statusCode).toBe(401);
  });

  it("never returns another creator's Stashes", async () => {
    const repo = new MemoryReadRepository();
    repo.seedStash(stash(OTHER, "other-1", "2026-09-14T10:00:00.000Z"));
    repo.seedStash(stash(USER, "mine-1", "2026-09-10T10:00:00.000Z"));

    const res = await listStashes({ repo })(listEvent());

    expect(body(res).stashes.map((s: any) => s.stashId)).toEqual(["mine-1"]);
  });

  it("ignores a user_id supplied in the query string (Rule 7)", async () => {
    const repo = new MemoryReadRepository();
    repo.seedStash(stash(OTHER, "other-1", "2026-09-14T10:00:00.000Z"));

    const res = await listStashes({ repo })(
      listEvent({ user_id: OTHER, userId: OTHER }),
    );

    expect(res.statusCode).toBe(200);
    expect(body(res).stashes).toEqual([]);
  });

  it("pages through every Stash without dropping or repeating one", async () => {
    const repo = new MemoryReadRepository();
    const total = 250;
    for (let i = 0; i < total; i += 1) {
      const n = String(i).padStart(4, "0");
      repo.seedStash(
        stash(USER, `s-${n}`, `2026-09-01T00:00:${n.slice(0, 2)}.000Z`),
      );
    }

    const seen: string[] = [];
    let cursor: string | null = null;
    let requests = 0;
    do {
      const query: Record<string, string> = { limit: "40" };
      if (cursor !== null) query["cursor"] = cursor;
      const res = await listStashes({ repo })(listEvent(query));
      expect(res.statusCode).toBe(200);
      const page = body(res);
      seen.push(...page.stashes.map((s: any) => s.stashId));
      cursor = page.nextCursor;
      requests += 1;
      expect(requests).toBeLessThan(20);
    } while (cursor !== null);

    expect(seen).toHaveLength(total);
    expect(new Set(seen).size).toBe(total);
    // Recency groups here coincide with lexical id order, so the whole
    // paged sequence must equal the full set in descending order.
    const expected = [...repo.allStashIds(USER)].sort().reverse();
    expect(seen).toEqual(expected);
  });

  it("orders deterministically when two Stashes share a startedAt", async () => {
    const repo = new MemoryReadRepository();
    repo.seedStash(stash(USER, "s-a", "2026-09-14T10:00:00.000Z"));
    repo.seedStash(stash(USER, "s-b", "2026-09-14T10:00:00.000Z"));
    repo.seedStash(stash(USER, "s-c", "2026-09-14T10:00:00.000Z"));

    const first = body(await listStashes({ repo })(listEvent({ limit: "2" })));
    const second = body(
      await listStashes({ repo })(
        listEvent({ limit: "2", cursor: first.nextCursor }),
      ),
    );

    expect([
      ...first.stashes.map((s: any) => s.stashId),
      ...second.stashes.map((s: any) => s.stashId),
    ]).toEqual(["s-c", "s-b", "s-a"]);
  });

  it("does not let a cursor reach another creator's Stash", async () => {
    const repo = new MemoryReadRepository();
    repo.seedStash(stash(OTHER, "other-1", "2026-09-14T10:00:00.000Z"));
    repo.seedStash(stash(OTHER, "other-2", "2026-09-13T10:00:00.000Z"));
    repo.seedStash(stash(USER, "mine-1", "2026-09-12T10:00:00.000Z"));

    // The victim's own cursor, replayed by a different creator.
    const victimPage = body(
      await listStashes({ repo })(listEvent({ limit: "1" }, OTHER)),
    );
    expect(victimPage.nextCursor).not.toBeNull();

    const res = await listStashes({ repo })(
      listEvent({ cursor: victimPage.nextCursor }, USER),
    );

    // 404, never 403: existence must not be disclosed.
    expect(res.statusCode).toBe(404);
    expect(body(res).code).toBe("not_found");
    expect(res.body).not.toContain("other-1");
  });

  it("does not expose DynamoDB key material in the cursor", async () => {
    const repo = new MemoryReadRepository();
    repo.seedStash(stash(USER, "s-1", "2026-09-14T10:00:00.000Z"));
    repo.seedStash(stash(USER, "s-2", "2026-09-13T10:00:00.000Z"));

    const page = body(await listStashes({ repo })(listEvent({ limit: "1" })));
    const decoded = Buffer.from(page.nextCursor, "base64url").toString("utf8");

    expect(decoded).not.toContain("USER#");
    expect(decoded).not.toContain("pk");
    expect(decoded).not.toContain(USER);
  });

  it("rejects a malformed limit rather than silently truncating", async () => {
    const repo = new MemoryReadRepository();
    for (const limit of ["0", "-1", "abc", "1000", "1.5", ""]) {
      const res = await listStashes({ repo })(listEvent({ limit }));
      expect(res.statusCode, `limit=${limit}`).toBe(400);
      expect(body(res).code).toBe("bad_request");
    }
  });

  it("maps an unexpected repository failure to 500 without leaking detail", async () => {
    const repo = {
      listStashes: async () => {
        throw new Error("dynamodb endpoint https://secret.internal failed");
      },
      getUsage: async () => undefined,
    };
    const res = await listStashes({ repo })(listEvent());
    expect(res.statusCode).toBe(500);
    expect(res.body).not.toContain("secret.internal");
  });
});

function res_keys(item: Record<string, unknown>): string[] {
  return Object.keys(item);
}
