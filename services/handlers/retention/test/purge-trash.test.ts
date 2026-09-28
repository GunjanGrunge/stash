import { describe, expect, it } from "vitest";
import { purgeTrash } from "../src/purge-trash.js";
import type { RetentionRepository } from "../src/repository.js";
import type { DueFile, DueFolder, DueItem, FolderDescendant } from "../src/types.js";

const due: DueFile = { entity: "FILE", pk: "USER#a", sk: "FILE#f", fileId: "f", objectKey: "users/a/f", sizeBytes: 7, state: "trashed" };
const folder: DueFolder = { entity: "FOLDER", pk: "USER#a", sk: "FOLDER#d", folderId: "d", parentFolderId: null, name: "Designs", state: "trashed" };
class FakeRepo implements RetentionRepository {
  claimed: DueItem[] = []; finalized: DueFile[] = []; batches: Array<{ files: DueFile[]; folders: DueFolder[] }> = []; roots: DueFolder[] = [];
  constructor(readonly items: DueItem[], private readonly claimResult = true, private readonly children = new Map<string, FolderDescendant[]>()) {}
  async listDue(): Promise<DueItem[]> { return this.items; }
  async claim(file: DueItem): Promise<boolean> { this.claimed.push(file); return this.claimResult; }
  async finalize(file: DueFile): Promise<void> { this.finalized.push(file); }
  async listFolderChildren(item: DueFolder): Promise<FolderDescendant[]> { return this.children.get(item.folderId) ?? []; }
  async finalizeFolderBatch(root: DueFolder, files: DueFile[], folders: DueFolder[]): Promise<void> { this.batches.push({ files, folders }); for (const file of files) this.children.forEach((items, key) => this.children.set(key, items.filter((item) => item !== file))); for (const child of folders) this.children.forEach((items, key) => this.children.set(key, items.filter((item) => item !== child))); }
  async finalizeFolderRoot(root: DueFolder): Promise<void> { this.roots.push(root); }
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
  it("permanently removes a folder tree leaves-first after its 30 day deadline", async () => {
    const child: DueFile = { ...due, fileId: "inside", sk: "FILE#inside", objectKey: "users/a/inside", state: "purging" };
    const repo = new FakeRepo([folder], true, new Map([["d", [child]]]));
    const deleted: string[] = [];
    await expect(purgeTrash({ repo, objects: { deleteObject: async (key) => { deleted.push(key); } } })).resolves.toEqual({ scanned: 1, purged: 1, skipped: 0 });
    expect(deleted).toEqual(["users/a/inside"]);
    expect(repo.batches).toEqual([{ files: [child], folders: [] }]);
    expect(repo.roots).toEqual([folder]);
  });
});
