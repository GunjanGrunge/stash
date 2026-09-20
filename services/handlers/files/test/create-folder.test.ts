import { describe, expect, it } from "vitest";
import { createFolder } from "../src/create-folder.js";
import { listChildren } from "../src/list-children.js";
import { MemoryRepository } from "../src/memory-repository.js";

const event = (body: unknown, sub = "creator") => ({
  requestContext: { authorizer: { jwt: { claims: { sub } } } },
  body: JSON.stringify(body),
});

describe("createFolder", () => {
  it("creates an empty root folder that is immediately browsable", async () => {
    const repo = new MemoryRepository();
    const created = await createFolder({ repo })(event({ name: "Beats" }));
    expect(created.statusCode).toBe(201);
    const folder = JSON.parse(created.body);
    const children = await listChildren({ repo })({ requestContext: { authorizer: { jwt: { claims: { sub: "creator" } } } }, pathParameters: { folderId: "ROOT" } });
    expect(JSON.parse(children.body).items).toMatchObject([{ entity: "FOLDER", folderId: folder.folderId, name: "Beats" }]);
  });

  it("requires an owned parent and refuses duplicate siblings", async () => {
    const repo = new MemoryRepository();
    expect((await createFolder({ repo })(event({ name: "Child", parentFolderId: "missing" }))).statusCode).toBe(404);
    expect((await createFolder({ repo })(event({ name: "Beats" }))).statusCode).toBe(201);
    expect((await createFolder({ repo })(event({ name: "Beats" }))).statusCode).toBe(409);
  });

  it("preserves valid unicode names and rejects a path rather than renaming it", async () => {
    const repo = new MemoryRepository();
    expect((await createFolder({ repo })(event({ name: "Étage" }))).statusCode).toBe(201);
    expect((await createFolder({ repo })(event({ name: "Beats/Demos" }))).statusCode).toBe(400);
  });
});
