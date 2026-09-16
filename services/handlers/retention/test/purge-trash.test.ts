import { describe, expect, it } from "vitest";
import { purgeTrash } from "../src/purge-trash.js";
import type { RetentionRepository } from "../src/repository.js";
import type { DueFile } from "../src/types.js";

const due: DueFile = { pk: "USER#a", sk: "FILE#f", fileId: "f", objectKey: "users/a/f", sizeBytes: 7, state: "trashed" };
class FakeRepo implements RetentionRepository {
  claimed: DueFile[] = []; finalized: DueFile[] = [];
  constructor(readonly items: DueFile[], private readonly claimResult = true) {}
  async listDue(): Promise<DueFile[]> { return this.items; }
  async claim(file: DueFile): Promise<boolean> { this.claimed.push(file); return this.claimResult; }
  async finalize(file: DueFile): Promise<void> { this.finalized.push(file); }
}

describe("purgeTrash", () => {
  it("claims then deletes only an opaque stored key, then finalizes quota/metadata", async () => {
    const repo = new FakeRepo([due]); const deleted: string[] = [];
    await expect(purgeTrash({ repo, objects: { deleteObject: async (key) => { deleted.push(key); } }, now: () => new Date("2026-02-01T00:00:00.000Z") })).resolves.toEqual({ scanned: 1, purged: 1, skipped: 0 });
    expect(repo.claimed).toEqual([due]); expect(deleted).toEqual(["users/a/f"]); expect(repo.finalized).toEqual([due]);
  });
  it("does not delete a restored/raced file when its conditional claim fails", async () => {
    const repo = new FakeRepo([due], false); const deleted: string[] = [];
    await expect(purgeTrash({ repo, objects: { deleteObject: async (key) => { deleted.push(key); } } })).resolves.toEqual({ scanned: 1, purged: 0, skipped: 1 });
    expect(deleted).toEqual([]); expect(repo.finalized).toEqual([]);
  });
  it("treats S3 NoSuchKey as an idempotent successful deletion", async () => {
    const repo = new FakeRepo([{ ...due, state: "purging" }]);
    await expect(purgeTrash({ repo, objects: { deleteObject: async () => { throw { name: "NoSuchKey" }; } } })).resolves.toEqual({ scanned: 1, purged: 1, skipped: 0 });
    expect(repo.finalized).toHaveLength(1);
  });
});
