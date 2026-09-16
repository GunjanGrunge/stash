import { describe, it, expect, vi } from "vitest";
import { TRANSACT_ITEM_LIMIT } from "../src/dynamo-repository.js";
import { MemoryRepository } from "../src/memory-repository.js";
import { registerFiles } from "../src/register-files.js";
import type { EntityRecord, FileRecord, FolderRecord } from "../src/types.js";

const USER = "user-chunk-1";

function event(body: unknown, idempotencyKey?: string): any {
  return {
    requestContext: { authorizer: { jwt: { claims: { sub: USER } } } },
    headers: idempotencyKey === undefined ? {} : { "Idempotency-Key": idempotencyKey },
    body: JSON.stringify(body),
  };
}

/**
 * The cost DynamoDB actually charges a transaction: a FOLDER costs two
 * actions (the FOLDER record plus its FOLDERID identity guard), a FILE one.
 * Counting ITEMS instead of ACTIONS is the bug this suite exists to catch.
 */
function actionCost(items: EntityRecord[]): number {
  return items.reduce((n, i) => n + (i.entity === "FOLDER" ? 2 : 1), 0);
}

/** Wraps a MemoryRepository so every putEntities batch is observable. */
function spyRepo(): { repo: MemoryRepository; calls: EntityRecord[][] } {
  const repo = new MemoryRepository();
  const calls: EntityRecord[][] = [];
  const original = repo.putEntities.bind(repo);
  vi.spyOn(repo, "putEntities").mockImplementation(async (items: EntityRecord[]) => {
    calls.push([...items]);
    await original(items);
  });
  return { repo, calls };
}

describe("registerFiles — transaction-sized chunking (Addendum A3)", () => {
  it("persists every file of a batch far larger than one transaction", async () => {
    const { repo, calls } = spyRepo();
    const files = Array.from({ length: 500 }, (_, i) => ({
      relativePath: `Samples/Drums/take-${i}.wav`,
      sizeBytes: i,
      checksum: `sum-${i}`,
    }));

    const res = await registerFiles({ repo })(event({ stashId: "stash-big", files }));

    expect(res.statusCode).toBe(201);
    expect(JSON.parse(res.body).fileIds).toHaveLength(500);
    const written = repo.all().filter((i): i is FileRecord => i.entity === "FILE");
    expect(written).toHaveLength(500);
    expect(new Set(written.map((f) => f.originalRelativePath)).size).toBe(500);
    // Rule 1: paths are stored verbatim.
    expect(written.map((f) => f.originalRelativePath).sort()).toEqual(
      files.map((f) => f.relativePath).sort(),
    );
    expect(calls.length).toBeGreaterThan(1);
  });

  it("never sends a single putEntities call over the transaction action limit", async () => {
    const { repo, calls } = spyRepo();
    const files = Array.from({ length: 300 }, (_, i) => ({
      // Each file lives in its own folder, so folders (2 actions) dominate.
      relativePath: `Lib/Pack-${i}/Sub-${i}/asset-${i}.wav`,
      sizeBytes: 1,
      checksum: `c${i}`,
    }));

    const res = await registerFiles({ repo })(event({ stashId: "stash-wide", files }));
    expect(res.statusCode).toBe(201);

    expect(calls.length).toBeGreaterThan(1);
    for (const items of calls) {
      expect(actionCost(items)).toBeLessThanOrEqual(TRANSACT_ITEM_LIMIT);
    }
    // 1 + 300*2 folders = 601 folders (1202 actions) + 300 files.
    expect(repo.all().filter((i) => i.entity === "FOLDER")).toHaveLength(601);
    expect(repo.all().filter((i) => i.entity === "FILE")).toHaveLength(300);
  });

  it("handles a deep path whose folders alone exceed the action limit", async () => {
    const { repo, calls } = spyRepo();
    const depth = 80; // 160 actions in folders alone
    const dirs = Array.from({ length: depth }, (_, i) => `d${i}`);
    const relativePath = `${dirs.join("/")}/deep.wav`;

    const res = await registerFiles({ repo })(
      event({ stashId: "s-deep", files: [{ relativePath, sizeBytes: 1, checksum: "c" }] }),
    );

    expect(res.statusCode).toBe(201);
    for (const items of calls) {
      expect(actionCost(items)).toBeLessThanOrEqual(TRANSACT_ITEM_LIMIT);
    }
    const folders = repo.all().filter((i): i is FolderRecord => i.entity === "FOLDER");
    expect(folders).toHaveLength(depth);
    const file = repo.all().find((i): i is FileRecord => i.entity === "FILE")!;
    expect(file.originalRelativePath).toBe(relativePath);
    // The chain is intact: walking parents from the file reaches the root.
    const byId = new Map(folders.map((f) => [f.folderId, f]));
    let hops = 0;
    let cursor: string | null = file.parentFolderId;
    while (cursor !== null && cursor !== "ROOT") {
      const folder: FolderRecord | undefined = byId.get(cursor);
      expect(folder).toBeDefined();
      cursor = folder!.parentFolderId;
      hops += 1;
    }
    expect(hops).toBe(depth);
  });

  it("writes a file's parent folder in the same chunk or an earlier one, never later", async () => {
    const { repo, calls } = spyRepo();
    const files = Array.from({ length: 120 }, (_, i) => ({
      relativePath: `Root/Group-${i % 7}/Deep-${i}/track-${i}.wav`,
      sizeBytes: 1,
      checksum: `c${i}`,
    }));

    const res = await registerFiles({ repo })(event({ stashId: "s-order", files }));
    expect(res.statusCode).toBe(201);

    const folderChunk = new Map<string, number>();
    calls.forEach((items, index) => {
      for (const item of items) {
        if (item.entity === "FOLDER") folderChunk.set(item.folderId, index);
      }
    });

    calls.forEach((items, index) => {
      for (const item of items) {
        if (item.entity === "FOLDER") {
          if (item.parentFolderId === null) continue;
          expect(folderChunk.get(item.parentFolderId)).toBeLessThanOrEqual(index);
          continue;
        }
        if (item.entity !== "FILE") continue;
        if (item.parentFolderId === "ROOT") continue;
        expect(folderChunk.get(item.parentFolderId)).toBeLessThanOrEqual(index);
      }
    });
  });

  it("replays a chunked registration from the Idempotency-Key without writing again", async () => {
    const { repo, calls } = spyRepo();
    const files = Array.from({ length: 220 }, (_, i) => ({
      relativePath: `Stash/Set-${i % 5}/clip-${i}.wav`,
      sizeBytes: 1,
      checksum: `c${i}`,
    }));
    const body = { stashId: "s-replay", files };

    const first = await registerFiles({ repo })(event(body, "key-1"));
    expect(first.statusCode).toBe(201);
    const writesAfterFirst = calls.length;
    const itemsAfterFirst = repo.all().length;

    const second = await registerFiles({ repo })(event(body, "key-1"));
    expect(second.statusCode).toBe(201);
    expect(second.body).toBe(first.body);
    expect(calls.length).toBe(writesAfterFirst);
    expect(repo.all().length).toBe(itemsAfterFirst);
  });

  it("resolves folders written by an earlier chunked call instead of forking them", async () => {
    const { repo, calls } = spyRepo();
    const handler = registerFiles({ repo });

    await handler(
      event({
        stashId: "s-1",
        files: Array.from({ length: 150 }, (_, i) => ({
          relativePath: `Shared/Bucket/a-${i}.wav`,
          sizeBytes: 1,
          checksum: `a${i}`,
        })),
      }),
    );
    const res = await handler(
      event({
        stashId: "s-2",
        files: Array.from({ length: 150 }, (_, i) => ({
          relativePath: `Shared/Bucket/b-${i}.wav`,
          sizeBytes: 1,
          checksum: `b${i}`,
        })),
      }),
    );

    expect(res.statusCode).toBe(201);
    const folders = repo.all().filter((i): i is FolderRecord => i.entity === "FOLDER");
    expect(folders.map((f) => f.relativePath).sort()).toEqual(["Shared", "Shared/Bucket"]);
    expect(repo.all().filter((i) => i.entity === "FILE")).toHaveLength(300);
    for (const items of calls) {
      expect(actionCost(items)).toBeLessThanOrEqual(TRANSACT_ITEM_LIMIT);
    }
  });

  it("still rejects a duplicate relativePath in a chunk-sized batch, writing nothing", async () => {
    const { repo, calls } = spyRepo();
    const files = Array.from({ length: 300 }, (_, i) => ({
      relativePath: `Dup/Folder/file-${i}.wav`,
      sizeBytes: 1,
      checksum: `c${i}`,
    }));
    files.push({ relativePath: "Dup/Folder/file-7.wav", sizeBytes: 1, checksum: "x" });

    const res = await registerFiles({ repo })(event({ stashId: "s-dup", files }));

    expect(res.statusCode).toBe(400);
    expect(calls).toHaveLength(0);
    expect(repo.all()).toHaveLength(0);
  });
});
