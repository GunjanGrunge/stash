import { describe, it, expect } from "vitest";
import { MemoryRepository } from "../src/memory-repository.js";
import { registerFiles } from "../src/register-files.js";
import type { FileRecord, FolderRecord } from "../src/types.js";

const USER = "user-abc123";

function event(body: unknown, sub: string | null = USER): any {
  return {
    requestContext: {
      authorizer: sub === null ? {} : { jwt: { claims: { sub } } },
    },
    headers: {},
    body: JSON.stringify(body),
  };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe("registerFiles", () => {
  it("creates the folder chain for a 3-level tree with correct parent links", async () => {
    const repo = new MemoryRepository();
    const res = await registerFiles({ repo })(
      event({
        stashId: "stash-1",
        files: [
          { relativePath: "Samples/Drums/Kicks/kick.wav", sizeBytes: 10, checksum: "aa" },
          { relativePath: "Samples/Drums/snare.wav", sizeBytes: 20, checksum: "bb" },
        ],
      }),
    );
    expect(res.statusCode).toBe(201);

    const folders = repo.all().filter((i): i is FolderRecord => i.entity === "FOLDER");
    const byPath = new Map(folders.map((f) => [f.relativePath, f]));
    expect([...byPath.keys()].sort()).toEqual([
      "Samples",
      "Samples/Drums",
      "Samples/Drums/Kicks",
    ]);

    const samples = byPath.get("Samples")!;
    const drums = byPath.get("Samples/Drums")!;
    const kicks = byPath.get("Samples/Drums/Kicks")!;
    expect(samples.parentFolderId).toBeNull();
    expect(drums.parentFolderId).toBe(samples.folderId);
    expect(kicks.parentFolderId).toBe(drums.folderId);
    expect(samples.name).toBe("Samples");
    expect(kicks.name).toBe("Kicks");
    expect(samples.gsi1pk).toBe(`USER#${USER}#PARENT#ROOT`);
    expect(drums.gsi1pk).toBe(`USER#${USER}#PARENT#${samples.folderId}`);
    expect(samples.pk).toBe(`USER#${USER}`);
    expect(samples.sk).toBe(`FOLDER#${samples.folderId}`);

    const files = repo.all().filter((i): i is FileRecord => i.entity === "FILE");
    expect(files).toHaveLength(2);
    const kick = files.find((f) => f.name === "kick.wav")!;
    expect(kick.parentFolderId).toBe(kicks.folderId);
    expect(kick.stashId).toBe("stash-1");
    expect(kick.state).toBe("pending");
    expect(kick.searchTokens).toEqual([]);
    expect(kick.extractedMetadata).toEqual({});
    expect(kick.gsi2pk).toBe(`USER#${USER}#STASH#stash-1`);
    expect(kick.gsi2sk).toBe(`FILE#${kick.fileId}`);
    expect(kick.gsi3pk).toBe(`USER#${USER}#SUM#aa`);
  });

  it("stores originalRelativePath byte-identically, including NFD", async () => {
    const repo = new MemoryRepository();
    const nfd = "Café/naïve \u{1F3B9}/tést 你好.wav";
    await registerFiles({ repo })(
      event({ stashId: "s", files: [{ relativePath: nfd, sizeBytes: 1, checksum: "c" }] }),
    );
    const file = repo.all().find((i): i is FileRecord => i.entity === "FILE")!;
    expect(file.originalRelativePath).toBe(nfd);
    expect(Buffer.from(file.originalRelativePath, "utf8")).toEqual(
      Buffer.from(nfd, "utf8"),
    );
    expect(file.originalRelativePath.normalize("NFC")).not.toBe(
      file.originalRelativePath,
    );
  });

  it("gives every file an opaque objectKey containing no part of the filename", async () => {
    const repo = new MemoryRepository();
    const res = await registerFiles({ repo })(
      event({
        stashId: "s",
        files: [
          { relativePath: "Secret Folder/My Track Name.wav", sizeBytes: 1, checksum: "c" },
        ],
      }),
    );
    const body = JSON.parse(res.body);
    expect(body.fileIds).toHaveLength(1);
    const file = repo.all().find((i): i is FileRecord => i.entity === "FILE")!;
    expect(file.objectKey).toBe(`users/${USER}/${file.fileId}`);
    expect(UUID_RE.test(file.fileId)).toBe(true);
    for (const fragment of ["Secret", "Folder", "My", "Track", "Name", ".wav", " "]) {
      expect(file.objectKey).not.toContain(fragment);
    }
  });

  it("rejects the WHOLE batch with 400 and writes nothing when one path is bad", async () => {
    const repo = new MemoryRepository();
    const res = await registerFiles({ repo })(
      event({
        stashId: "s",
        files: [
          { relativePath: "Good/one.wav", sizeBytes: 1, checksum: "c" },
          { relativePath: "../escape.wav", sizeBytes: 1, checksum: "c" },
          { relativePath: "Good/two.wav", sizeBytes: 1, checksum: "c" },
        ],
      }),
    );
    expect(res.statusCode).toBe(400);
    expect(repo.all()).toHaveLength(0);
  });

  it("ignores a user_id in the body in favour of the verified claim", async () => {
    const repo = new MemoryRepository();
    await registerFiles({ repo })(
      event({
        user_id: "attacker",
        userId: "attacker",
        stashId: "s",
        files: [{ relativePath: "a/b.wav", sizeBytes: 1, checksum: "c" }],
      }),
    );
    for (const item of repo.all()) {
      expect(item.pk).toBe(`USER#${USER}`);
      expect(JSON.stringify(item)).not.toContain("attacker");
    }
  });

  it("returns 401 when the sub claim is missing", async () => {
    const repo = new MemoryRepository();
    const res = await registerFiles({ repo })(
      event({ stashId: "s", files: [{ relativePath: "a.wav", sizeBytes: 1, checksum: "c" }] }, null),
    );
    expect(res.statusCode).toBe(401);
    expect(repo.all()).toHaveLength(0);
  });
});
