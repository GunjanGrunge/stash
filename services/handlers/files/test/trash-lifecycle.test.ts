import { describe, expect, it } from "vitest";
import { getFile } from "../src/get-file.js";
import { listChildren } from "../src/list-children.js";
import { listTrash } from "../src/list-trash.js";
import { MemoryRepository } from "../src/memory-repository.js";
import { restoreFile } from "../src/restore-file.js";
import { trashFile } from "../src/trash-file.js";
import type { FileRecord } from "../src/types.js";

const event = (sub = "a", id = "f1") => ({ requestContext: { authorizer: { jwt: { claims: { sub } } } }, pathParameters: { id } });
const rootEvent = (sub = "a") => ({ requestContext: { authorizer: { jwt: { claims: { sub } } } }, pathParameters: { folderId: "ROOT" } });
const file = (user = "a", overrides: Partial<FileRecord> = {}): FileRecord => ({
  pk: `USER#${user}`, sk: "FILE#f1", entity: "FILE", fileId: "f1", stashId: "s1", name: "kick.wav", parentFolderId: "ROOT",
  originalRelativePath: "Kick/kick.wav", sizeBytes: 12, checksum: "sum", objectKey: `users/${user}/f1`, state: "committed",
  searchTokens: [], extractedMetadata: {}, gsi1pk: `USER#${user}#PARENT#ROOT`, gsi1sk: "kick.wav", gsi2pk: "x", gsi2sk: "x", gsi3pk: "x", gsi3sk: "x", ...overrides,
});

describe("Trash lifecycle", () => {
  it("moves a committed file to Trash, hides it from normal reads, and restores its same identity", async () => {
    const repo = new MemoryRepository(); await repo.putEntities([file()]);
    const now = () => new Date("2026-01-01T00:00:00.000Z");
    const deleted = await trashFile({ repo, now })(event());
    expect(deleted.statusCode).toBe(200);
    expect(JSON.parse(deleted.body)).toEqual({ id: "f1", state: "trashed", purgeAfter: "2026-01-31T00:00:00.000Z" });
    expect((await getFile({ repo })(event())).statusCode).toBe(404);
    expect(JSON.parse((await listChildren({ repo })(rootEvent())).body).items).toEqual([]);
    expect(JSON.parse((await listTrash({ repo })(event())).body).items).toEqual([JSON.parse(deleted.body)]);

    const restored = await restoreFile({ repo })(event());
    expect(restored.statusCode).toBe(200);
    expect(JSON.parse(restored.body)).toEqual({ id: "f1", state: "committed" });
    expect(JSON.parse((await getFile({ repo })(event())).body)).toMatchObject({ id: "f1", state: "committed", parentFolderId: "ROOT" });
    expect(JSON.parse((await listChildren({ repo })(rootEvent())).body).items).toHaveLength(1);
    expect(JSON.parse((await listTrash({ repo })(event())).body).items).toEqual([]);
  });

  it("makes repeated delete idempotent without extending its recovery deadline", async () => {
    const repo = new MemoryRepository(); await repo.putEntities([file()]);
    const first = await trashFile({ repo, now: () => new Date("2026-01-01T00:00:00.000Z") })(event());
    const retry = await trashFile({ repo, now: () => new Date("2026-01-02T00:00:00.000Z") })(event());
    expect(retry).toEqual(first);
  });

  it("does not disclose foreign or missing files through delete, restore, or Trash", async () => {
    const repo = new MemoryRepository(); await repo.putEntities([file("b")]);
    expect((await trashFile({ repo })(event("a"))).statusCode).toBe(404);
    expect((await restoreFile({ repo })(event("a"))).statusCode).toBe(404);
    expect(JSON.parse((await listTrash({ repo })(event("a"))).body).items).toEqual([]);
  });

  it("rejects a non-committed file and never exposes a purging file for restoration", async () => {
    const repo = new MemoryRepository();
    await repo.putEntities([file("a", { state: "pending" })]);
    expect((await trashFile({ repo })(event())).statusCode).toBe(409);

    const purging = new MemoryRepository();
    await purging.putEntities([file("a", { state: "purging", gsi1pk: undefined, gsi1sk: undefined, gsi4pk: "USER#a#TRASH", gsi4sk: "PURGE#x", gsi5pk: "PURGE", gsi5sk: "AT#x" })]);
    expect((await restoreFile({ repo: purging })(event())).statusCode).toBe(404);
  });
});
