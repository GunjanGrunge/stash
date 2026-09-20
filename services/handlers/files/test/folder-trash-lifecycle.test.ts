import { describe, expect, it } from "vitest";
import { MemoryRepository } from "../src/memory-repository.js";
import { listTrash } from "../src/list-trash.js";
import { restoreFolder } from "../src/restore-folder.js";
import { trashFolder } from "../src/trash-folder.js";
import type { FolderRecord } from "../src/types.js";

const userId = "creator";
const now = () => new Date("2026-01-01T00:00:00.000Z");
const event = (id: string) => ({ requestContext: { authorizer: { jwt: { claims: { sub: userId } } } }, pathParameters: { id } });

function folder(id: string, name: string, parentFolderId: string | null): FolderRecord {
  return {
    pk: `USER#${userId}`, sk: `FOLDER#${id}`, entity: "FOLDER", folderId: id, name, parentFolderId,
    relativePath: parentFolderId === null ? name : `Parent/${name}`,
    gsi1pk: `USER#${userId}#PARENT#${parentFolderId ?? "ROOT"}`, gsi1sk: name,
  };
}

describe("recoverable folder deletion", () => {
  it("hides only the root, preserves its subtree, and restores the original path", async () => {
    const repo = new MemoryRepository();
    await repo.putEntities([folder("parent", "Parent", null), folder("child", "Child", "parent")]);
    const deleted = await trashFolder({ repo, now })(event("parent"));
    expect(deleted.statusCode).toBe(200);
    expect(JSON.parse(deleted.body)).toEqual({ id: "parent", entity: "FOLDER", state: "trashed", purgeAfter: "2026-01-31T00:00:00.000Z" });
    expect(await repo.listChildren(userId, null)).toEqual([]);
    expect((await repo.listChildren(userId, "parent")).map((item) => (item as FolderRecord).folderId)).toEqual(["child"]);
    const trash = await listTrash({ repo })({ requestContext: { authorizer: { jwt: { claims: { sub: userId } } } } });
    expect(JSON.parse(trash.body).items).toEqual([{ id: "parent", entity: "FOLDER", state: "trashed", purgeAfter: "2026-01-31T00:00:00.000Z" }]);
    expect((await restoreFolder({ repo })(event("parent"))).statusCode).toBe(200);
    expect((await repo.listChildren(userId, null)).map((item) => (item as FolderRecord).name)).toEqual(["Parent"]);
  });

  it("is retry-stable and refuses restoration once retention has claimed the root", async () => {
    const repo = new MemoryRepository();
    await repo.putEntities([folder("parent", "Parent", null)]);
    expect((await trashFolder({ repo, now })(event("parent"))).statusCode).toBe(200);
    expect((await trashFolder({ repo, now: () => new Date("2026-01-02T00:00:00.000Z") })(event("parent"))).statusCode).toBe(200);
    const record = await repo.findFolderById(userId, "parent");
    expect(record?.purgeAfter).toBe("2026-01-31T00:00:00.000Z");
    if (record) record.state = "purging";
    expect((await restoreFolder({ repo })(event("parent"))).statusCode).toBe(404);
  });
});
