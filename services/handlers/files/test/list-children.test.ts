import { describe, it, expect } from "vitest";
import { MemoryRepository } from "../src/memory-repository.js";
import { registerFiles } from "../src/register-files.js";
import { listChildren } from "../src/list-children.js";
import type { FileRecord, FolderRecord } from "../src/types.js";

const USER = "user-abc123";

function registerEvent(body: unknown, sub = USER): any {
  return {
    requestContext: { authorizer: { jwt: { claims: { sub } } } },
    headers: {},
    body: JSON.stringify(body),
  };
}

function listEvent(folderId?: string, sub = USER): any {
  return {
    requestContext: { authorizer: { jwt: { claims: { sub } } } },
    headers: {},
    pathParameters: folderId === undefined ? undefined : { folderId },
  };
}

async function seed(repo: MemoryRepository, paths: string[], sub = USER) {
  const res = await registerFiles({ repo })(
    registerEvent(
      {
        stashId: "s",
        files: paths.map((p) => ({ relativePath: p, sizeBytes: 1, checksum: "c" })),
      },
      sub,
    ),
  );
  expect(res.statusCode).toBe(201);
}

describe("listChildren", () => {
  it("returns ROOT children sorted by name ascending", async () => {
    const repo = new MemoryRepository();
    await seed(repo, ["zebra/x.wav", "alpha/y.wav", "beta.wav"]);
    const res = await listChildren({ repo })(listEvent());
    expect(res.statusCode).toBe(200);
    const items = JSON.parse(res.body).items as Array<FolderRecord | FileRecord>;
    expect(items.map((i) => i.name)).toEqual(["alpha", "beta.wav", "zebra"]);
  });

  it("treats an explicit ROOT path parameter as top level", async () => {
    const repo = new MemoryRepository();
    await seed(repo, ["alpha/y.wav"]);
    const res = await listChildren({ repo })(listEvent("ROOT"));
    const items = JSON.parse(res.body).items as Array<FolderRecord | FileRecord>;
    expect(items.map((i) => i.name)).toEqual(["alpha"]);
  });

  it("reaches a nested folder's children by its folderId", async () => {
    const repo = new MemoryRepository();
    await seed(repo, ["Samples/Drums/Kicks/kick.wav", "Samples/Drums/snare.wav"]);
    const root = JSON.parse((await listChildren({ repo })(listEvent())).body)
      .items as Array<FolderRecord>;
    const samples = root[0]!;
    const drumsList = JSON.parse(
      (await listChildren({ repo })(listEvent(samples.folderId))).body,
    ).items as Array<FolderRecord>;
    expect(drumsList.map((i) => i.name)).toEqual(["Drums"]);
    const drums = drumsList[0]!;
    const inDrums = JSON.parse(
      (await listChildren({ repo })(listEvent(drums.folderId))).body,
    ).items as Array<FolderRecord | FileRecord>;
    expect(inDrums.map((i) => i.name)).toEqual(["Kicks", "snare.wav"]);
    expect(inDrums.map((i) => i.entity)).toEqual(["FOLDER", "FILE"]);
  });

  it("never returns another user's items", async () => {
    const repo = new MemoryRepository();
    await seed(repo, ["Mine/a.wav"], USER);
    await seed(repo, ["Theirs/b.wav"], "user-other");
    const items = JSON.parse((await listChildren({ repo })(listEvent())).body)
      .items as Array<FolderRecord | FileRecord>;
    expect(items.map((i) => i.name)).toEqual(["Mine"]);
    for (const item of items) expect(item.pk).toBe(`USER#${USER}`);
  });

  it("returns 401 when the sub claim is missing", async () => {
    const repo = new MemoryRepository();
    const res = await listChildren({ repo })({
      requestContext: { authorizer: {} },
      headers: {},
    } as any);
    expect(res.statusCode).toBe(401);
  });
});
