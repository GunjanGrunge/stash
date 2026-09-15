/**
 * Regression proof for the four confirmed F1 defects.
 *
 * AFR-004: any test proving a hierarchy invariant exercises at least TWO
 * separate calls against the SAME repository — a single-call test is
 * structurally blind to per-request identity minting.
 */
import { describe, it, expect } from "vitest";
import { MemoryRepository } from "../src/memory-repository.js";
import { registerFiles } from "../src/register-files.js";
import { listChildren } from "../src/list-children.js";
import type { EntityRecord, FileRecord, FolderRecord } from "../src/types.js";

function evt(
  userId: string,
  extra: Record<string, unknown> = {},
  headers: Record<string, string> = {},
): any {
  return {
    requestContext: { authorizer: { jwt: { claims: { sub: userId } } } },
    headers,
    ...extra,
  };
}

async function register(
  repo: MemoryRepository,
  userId: string,
  paths: string[],
  stashId = "stash-x",
  headers: Record<string, string> = {},
) {
  return registerFiles({ repo })(
    evt(
      userId,
      {
        body: JSON.stringify({
          stashId,
          files: paths.map((p, i) => ({
            relativePath: p,
            sizeBytes: i,
            checksum: `sum-${i}`,
          })),
        }),
      },
      headers,
    ),
  );
}

const folders = (repo: MemoryRepository): FolderRecord[] =>
  repo.all().filter((i): i is FolderRecord => i.entity === "FOLDER");
const fileRecords = (repo: MemoryRepository): FileRecord[] =>
  repo.all().filter((i): i is FileRecord => i.entity === "FILE");

// ---------------------------------------------------------------------------
// DEFECT 1 — folder identity must be stable across invocations.
// ---------------------------------------------------------------------------

describe("D1: folder identity is stable across separate calls", () => {
  it("reuses the same folderId when a later call touches the same folder", async () => {
    const repo = new MemoryRepository();
    expect((await register(repo, "u1", ["Beats/a.wav"], "s1")).statusCode).toBe(201);
    expect((await register(repo, "u1", ["Beats/b.wav"], "s2")).statusCode).toBe(201);

    const beats = folders(repo).filter((f) => f.name === "Beats");
    expect(beats.length, "ONE Beats folder, not one per request").toBe(1);
    for (const f of fileRecords(repo)) {
      expect(f.parentFolderId).toBe(beats[0]!.folderId);
    }
  });

  it("keeps two creators' identically-named folders separate", async () => {
    const repo = new MemoryRepository();
    await register(repo, "u-a", ["Beats/a.wav"]);
    await register(repo, "u-b", ["Beats/b.wav"]);
    const beats = folders(repo).filter((f) => f.name === "Beats");
    expect(beats.length).toBe(2);
    expect(new Set(beats.map((f) => f.pk)).size).toBe(2);
  });

  it("does not fork a deep chain when a sibling branch arrives in a later call", async () => {
    const repo = new MemoryRepository();
    await register(repo, "u2", ["A/B/C/one.wav"], "s1");
    await register(repo, "u2", ["A/B/D/two.wav"], "s2");
    await register(repo, "u2", ["A/B/C/three.wav"], "s3");

    const byPath = folders(repo).reduce((m, f) => {
      m.set(f.relativePath, (m.get(f.relativePath) ?? 0) + 1);
      return m;
    }, new Map<string, number>());
    expect([...byPath.entries()].sort()).toEqual([
      ["A", 1],
      ["A/B", 1],
      ["A/B/C", 1],
      ["A/B/D", 1],
    ]);

    // C and D must hang under the SAME B.
    const b = folders(repo).find((f) => f.relativePath === "A/B")!;
    for (const path of ["A/B/C", "A/B/D"]) {
      expect(folders(repo).find((f) => f.relativePath === path)!.parentFolderId).toBe(
        b.folderId,
      );
    }
  });

  it("enforces the invariant in the port itself: a blind second write is refused", async () => {
    const repo = new MemoryRepository();
    await register(repo, "u3", ["Beats/a.wav"]);
    const existing = folders(repo)[0]!;
    await expect(
      repo.putEntities([{ ...existing, folderId: "other", sk: "FOLDER#other" }]),
    ).rejects.toMatchObject({ status: 409 });
    expect(folders(repo).length).toBe(1);
  });

  it("does not derive folderId from the path (identity comes from lookup)", async () => {
    const a = new MemoryRepository();
    const b = new MemoryRepository();
    await register(a, "u4", ["A/B/x.wav"]);
    await register(b, "u4", ["A/B/x.wav"]);
    const idA = folders(a).find((f) => f.relativePath === "A/B")!.folderId;
    const idB = folders(b).find((f) => f.relativePath === "A/B")!.folderId;
    expect(idA).not.toBe(idB);
  });
});

// ---------------------------------------------------------------------------
// DEFECT 2 — GSI key completeness.
// ---------------------------------------------------------------------------

describe("D2: every GSI partition key has its matching sort key", () => {
  it("writes gsi3sk on every FileRecord so the checksum index is not empty", async () => {
    const repo = new MemoryRepository();
    await register(repo, "u5", ["Beats/a.wav", "Beats/deep/b.wav"], "s1");
    await register(repo, "u5", ["Beats/c.wav"], "s2");
    const files = fileRecords(repo);
    expect(files.length).toBe(3);
    for (const f of files) {
      expect(f.gsi3pk).toBe(`USER#u5#SUM#${f.checksum}`);
      expect(f.gsi3sk).toBe(`FILE#${f.fileId}`);
    }
    // Rule 3: gsi3 is DETECTION only — two files sharing a checksum both
    // survive, distinguished by the sort key.
    const repo2 = new MemoryRepository();
    await registerFiles({ repo: repo2 })(
      evt("u5b", {
        body: JSON.stringify({
          stashId: "s",
          files: [
            { relativePath: "one.wav", sizeBytes: 1, checksum: "same" },
            { relativePath: "two.wav", sizeBytes: 1, checksum: "same" },
          ],
        }),
      }),
    );
    const dupes = fileRecords(repo2);
    expect(dupes.length).toBe(2);
    expect(new Set(dupes.map((f) => f.gsi3pk)).size).toBe(1);
    expect(new Set(dupes.map((f) => f.gsi3sk)).size).toBe(2);
  });

  it("any record carrying a gsiNpk also carries the matching gsiNsk", async () => {
    const repo = new MemoryRepository();
    await register(repo, "u6", ["A/B/one.wav", "A/two.wav"], "s1");
    await register(repo, "u6", ["A/B/three.wav"], "s2");
    expect(repo.all().length).toBeGreaterThan(0);
    for (const item of repo.all() as unknown as Array<Record<string, unknown>>) {
      for (const key of Object.keys(item)) {
        const m = /^gsi(\d+)pk$/.exec(key);
        if (m === null) continue;
        const sk = `gsi${m[1]}sk`;
        expect(
          typeof item[sk] === "string" && (item[sk] as string).length > 0,
          `record ${String(item["sk"])} has ${key} but no usable ${sk}; ` +
            `DynamoDB would never project it into gsi${m[1]}`,
        ).toBe(true);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// DEFECT 3 — idempotent replay.
// ---------------------------------------------------------------------------

describe("D3: registerFiles is idempotent on Idempotency-Key", () => {
  it("replays the original response and writes nothing the second time", async () => {
    const repo = new MemoryRepository();
    const headers = { "Idempotency-Key": "batch-42" };
    const first = await register(repo, "u7", ["Beats/a.wav", "Beats/b.wav"], "s1", headers);
    const afterFirst = repo.all().length;
    const second = await register(repo, "u7", ["Beats/a.wav", "Beats/b.wav"], "s1", headers);

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    expect(second.body, "a retry must return the ORIGINAL fileIds").toBe(first.body);
    expect(repo.all().length, "a retry must not double-write").toBe(afterFirst);
    expect(fileRecords(repo).length).toBe(2);
    expect(folders(repo).length).toBe(1);
  });

  it("scopes the key per (userId, stashId, key)", async () => {
    const repo = new MemoryRepository();
    const headers = { "idempotency-key": "k" };
    const a = await register(repo, "u8", ["x.wav"], "s1", headers);
    const otherStash = await register(repo, "u8", ["y.wav"], "s2", headers);
    const otherUser = await register(repo, "u9", ["z.wav"], "s1", headers);
    expect(otherStash.body).not.toBe(a.body);
    expect(otherUser.body).not.toBe(a.body);
    expect(fileRecords(repo).length).toBe(3);
  });

  it("without a key, a second identical call still writes new files into the SAME folder", async () => {
    const repo = new MemoryRepository();
    await register(repo, "u10", ["Beats/a.wav"], "s1");
    await register(repo, "u10", ["Beats/a.wav"], "s1");
    expect(folders(repo).length).toBe(1);
    expect(fileRecords(repo).length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// DEFECT 4 — cross-tenant read is 404, own empty folder is 200.
// ---------------------------------------------------------------------------

describe("D4: cross-tenant folder reads do not disclose existence", () => {
  it("returns 404 for another creator's folderId", async () => {
    const repo = new MemoryRepository();
    await register(repo, "owner", ["Private/secret.wav"]);
    const theirFolder = folders(repo).find((f) => f.name === "Private")!;

    const res = await listChildren({ repo })(
      evt("intruder", { pathParameters: { folderId: theirFolder.folderId } }),
    );
    expect(res.statusCode).toBe(404);
    const body = JSON.parse(res.body);
    expect(body.code).toBe("not_found");
    expect(JSON.stringify(body)).not.toContain("Private");
    expect(JSON.stringify(body)).not.toContain("secret");
  });

  it("returns 404 for a folderId that exists for nobody", async () => {
    const repo = new MemoryRepository();
    await register(repo, "owner2", ["A/x.wav"]);
    const res = await listChildren({ repo })(
      evt("owner2", { pathParameters: { folderId: "00000000-0000-4000-8000-000000000000" } }),
    );
    expect(res.statusCode, "an unknown id is indistinguishable from another user's").toBe(404);
  });

  it("still returns 200 and an empty list for the caller's OWN empty folder", async () => {
    const repo = new MemoryRepository();
    // "Empty" exists as a folder, and a later call leaves it childless.
    await register(repo, "owner3", ["Empty/Inner/x.wav"]);
    await register(repo, "owner3", ["Other/y.wav"]);
    const inner = folders(repo).find((f) => f.relativePath === "Empty/Inner")!;
    const fileId = fileRecords(repo).find((f) => f.name === "x.wav")!.fileId;
    expect(fileId).toBeTruthy();

    const deepest = await listChildren({ repo })(
      evt("owner3", { pathParameters: { folderId: inner.folderId } }),
    );
    expect(deepest.statusCode).toBe(200);
    expect((JSON.parse(deepest.body).items as EntityRecord[]).map((i) => i.name)).toEqual([
      "x.wav",
    ]);

    // A genuinely empty folder: created by one call, never filled.
    const repo2 = new MemoryRepository();
    await register(repo2, "owner4", ["Solo/only.wav"]);
    const solo = folders(repo2).find((f) => f.name === "Solo")!;
    await registerFiles({ repo: repo2 })(
      evt("owner4", {
        body: JSON.stringify({
          stashId: "s2",
          files: [{ relativePath: "Elsewhere/z.wav", sizeBytes: 1, checksum: "c" }],
        }),
      }),
    );
    const elsewhere = folders(repo2).find((f) => f.name === "Elsewhere")!;
    expect(elsewhere.folderId).not.toBe(solo.folderId);
    const own = await listChildren({ repo: repo2 })(
      evt("owner4", { pathParameters: { folderId: elsewhere.folderId } }),
    );
    expect(own.statusCode).toBe(200);
    expect(JSON.parse(own.body).items.map((i: EntityRecord) => i.name)).toEqual(["z.wav"]);
  });

  it("ROOT is always 200, even for a creator with nothing stashed", async () => {
    const repo = new MemoryRepository();
    const res = await listChildren({ repo })(evt("newcomer"));
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).items).toEqual([]);
  });
});
