import { describe, expect, it } from "vitest";
import { getFile } from "../src/get-file.js";
import { MemoryRepository } from "../src/memory-repository.js";
import type { FileRecord } from "../src/types.js";

const event = (sub = "a", id = "f1") => ({ requestContext: { authorizer: { jwt: { claims: { sub } } } }, pathParameters: { id } });
const file = (user = "a"): FileRecord => ({ pk: `USER#${user}`, sk: "FILE#f1", entity: "FILE", fileId: "f1", stashId: "s1", name: "kick.wav", parentFolderId: "root", originalRelativePath: "P/K/kick.wav", sizeBytes: 12, checksum: "sum", objectKey: `users/${user}/f1`, state: "committed", searchTokens: [], extractedMetadata: {}, gsi1pk: "x", gsi1sk: "kick.wav", gsi2pk: "y", gsi2sk: "FILE#f1", gsi3pk: "z", gsi3sk: "f1" });

describe("getFile", () => {
  it("returns only the storage-neutral asset detail for its owner", async () => {
    const repo = new MemoryRepository(); await repo.putEntities([file()]);
    const response = await getFile({ repo })(event());
    expect(response.statusCode).toBe(200);
    expect(response.body).not.toContain("objectKey");
    expect(JSON.parse(response.body)).toMatchObject({ id: "f1", name: "kick.wav", state: "committed" });
  });
  it("makes a foreign or missing file indistinguishable", async () => {
    const repo = new MemoryRepository(); await repo.putEntities([file("b")]);
    expect((await getFile({ repo })(event("a"))).statusCode).toBe(404);
    expect((await getFile({ repo })(event("a", "absent"))).statusCode).toBe(404);
  });
  it("requires a verified subject and matching route parameter", async () => {
    const repo = new MemoryRepository();
    expect((await getFile({ repo })({ pathParameters: { id: "f1" }, requestContext: { authorizer: { jwt: { claims: {} } } } })).statusCode).toBe(401);
    expect((await getFile({ repo })({ requestContext: { authorizer: { jwt: { claims: { sub: "a" } } } }, pathParameters: {} })).statusCode).toBe(400);
  });
});
