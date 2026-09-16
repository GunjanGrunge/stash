import { describe, it, expect } from "vitest";
import { checkManifest } from "../src/check-manifest.js";
import { manifestHash } from "../src/manifest-hash.js";
import { MemoryManifestRepository } from "../src/memory-repository.js";
import type { ManifestEntry, ManifestRecord } from "../src/types.js";

const FOLDER = "Sample Pack";
const USER = "user-abc123";
const OTHER = "user-zzz999";

function event(body: unknown, sub: string | null = USER): any {
  return {
    requestContext: {
      authorizer: sub === null ? {} : { jwt: { claims: { sub } } },
    },
    headers: {},
    pathParameters: { id: "stash-1" },
    body: JSON.stringify(body),
  };
}

function pack(count: number, prefix = "Sample Pack"): ManifestEntry[] {
  return Array.from({ length: count }, (_, i) => ({
    relativePath: `${prefix}/Vol ${i % 7}/file-${i}.wav`,
    sizeBytes: 1000 + i,
    checksum: `sum-${i}`,
  }));
}

function record(
  userId: string,
  folderName: string,
  entries: ManifestEntry[],
  folderId = "folder-1",
): ManifestRecord {
  const hash = manifestHash(folderName, entries);
  return {
    pk: `USER#${userId}`,
    sk: `MANIFEST#${hash}`,
    entity: "MANIFEST",
    manifestHash: hash,
    folderId,
    folderName,
    fileCount: entries.length,
    totalBytes: entries.reduce((sum, e) => sum + e.sizeBytes, 0),
    entries,
  };
}

describe("checkManifest", () => {
  it("requires an owned open Stash when supplied a Stash lookup", async () => {
    const repo = new MemoryManifestRepository();
    const getStash = async (userId: string, stashId: string) =>
      userId === USER && stashId === "stash-1" ? { state: "open" } : undefined;
    const handler = checkManifest({ repo, stashes: { getStash } });
    expect((await handler(event({ folderName: "Pack", entries: pack(1) }))).statusCode).toBe(200);
    const foreign = event({ folderName: "Pack", entries: pack(1) });
    foreign.pathParameters.id = "foreign";
    expect((await handler(foreign)).statusCode).toBe(404);
  });

  it("rejects a closed owned Stash before checking its manifest", async () => {
    const repo = new MemoryManifestRepository();
    const handler = checkManifest({ repo, stashes: { getStash: async () => ({ state: "completed" }) } });
    expect((await handler(event({ folderName: "Pack", entries: pack(1) }))).statusCode).toBe(409);
  });
  it("returns exact for a manifest already stored, with counts and bytes", async () => {
    const repo = new MemoryManifestRepository();
    const entries = pack(5);
    await repo.putManifest(record(USER, "Sample Pack", entries, "folder-abc"));

    const res = await checkManifest({ repo })(
      event({ folderName: "Sample Pack", entries }),
    );
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({
      match: "exact",
      folderId: "folder-abc",
      folderName: "Sample Pack",
      fileCount: 5,
      totalBytes: entries.reduce((s, e) => s + e.sizeBytes, 0),
    });
  });

  it("returns partial with exactly the 3 new entries for 1,847 of 1,850", async () => {
    const repo = new MemoryManifestRepository();
    const all = pack(1850);
    const stored = all.slice(0, 1847);
    await repo.putManifest(record(USER, "Sample Pack", stored, "folder-big"));

    const res = await checkManifest({ repo })(
      event({ folderName: "Sample Pack", entries: all }),
    );
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.match).toBe("partial");
    expect(body.folderId).toBe("folder-big");
    expect(body.existingCount).toBe(1847);
    expect(body.newFiles).toEqual(all.slice(1847));
    expect(body.newFiles).toHaveLength(3);
    expect(body.newBytes).toBe(
      all.slice(1847).reduce((s, e) => s + e.sizeBytes, 0),
    );
  });

  it("returns none for a manifest never seen before", async () => {
    const repo = new MemoryManifestRepository();
    const res = await checkManifest({ repo })(
      event({ folderName: "Brand New Pack", entries: pack(3, "Brand New Pack") }),
    );
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ match: "none" });
  });

  it("FALSE POSITIVE GUARD: byte-identical files at different paths never match (Rule 3)", async () => {
    const repo = new MemoryManifestRepository();
    const vol4: ManifestEntry[] = [
      { relativePath: "Vol 4/Kicks/x.wav", sizeBytes: 10, checksum: "aa" },
      { relativePath: "Vol 4/Snares/y.wav", sizeBytes: 20, checksum: "bb" },
    ];
    const vol5: ManifestEntry[] = [
      { relativePath: "Vol 5/Kicks/x.wav", sizeBytes: 10, checksum: "aa" },
      { relativePath: "Vol 5/Snares/y.wav", sizeBytes: 20, checksum: "bb" },
    ];
    await repo.putManifest(record(USER, "Vol 4", vol4, "folder-v4"));

    const res = await checkManifest({ repo })(
      event({ folderName: "Vol 5", entries: vol5 }),
    );
    expect(JSON.parse(res.body)).toEqual({ match: "none" });
  });

  it("FALSE POSITIVE GUARD: a same folderName with no shared file is none, not partial", async () => {
    const repo = new MemoryManifestRepository();
    await repo.putManifest(
      record(USER, "Drums", [
        { relativePath: "Drums/a.wav", sizeBytes: 1, checksum: "aa" },
      ]),
    );
    const res = await checkManifest({ repo })(
      event({
        folderName: "Drums",
        entries: [{ relativePath: "Drums/b.wav", sizeBytes: 2, checksum: "bb" }],
      }),
    );
    expect(JSON.parse(res.body)).toEqual({ match: "none" });
  });

  it("counts a same-path-different-checksum entry as a NEW file", async () => {
    const repo = new MemoryManifestRepository();
    const stored: ManifestEntry[] = [
      { relativePath: "Pack/a.wav", sizeBytes: 1, checksum: "aa" },
      { relativePath: "Pack/b.wav", sizeBytes: 2, checksum: "bb" },
    ];
    await repo.putManifest(record(USER, "Pack", stored, "folder-p"));

    const changed: ManifestEntry[] = [
      { relativePath: "Pack/a.wav", sizeBytes: 1, checksum: "aa" },
      { relativePath: "Pack/b.wav", sizeBytes: 9, checksum: "CHANGED" },
    ];
    const body = JSON.parse(
      (await checkManifest({ repo })(event({ folderName: "Pack", entries: changed })))
        .body,
    );
    expect(body.match).toBe("partial");
    expect(body.existingCount).toBe(1);
    expect(body.newFiles).toEqual([changed[1]]);
    expect(body.newBytes).toBe(9);
  });

  it("never matches another user's manifest (tenancy)", async () => {
    const repo = new MemoryManifestRepository();
    const entries = pack(4);
    await repo.putManifest(record(OTHER, "Sample Pack", entries, "folder-other"));

    const res = await checkManifest({ repo })(
      event({ folderName: "Sample Pack", entries }),
    );
    expect(JSON.parse(res.body)).toEqual({ match: "none" });
  });

  it("performs NO write: putManifest is never invoked during a check (Rule 9)", async () => {
    const repo = new MemoryManifestRepository();
    const entries = pack(3);
    await repo.putManifest(record(USER, "Sample Pack", entries, "folder-abc"));
    const writesBefore = repo.writeCount();

    await checkManifest({ repo })(event({ folderName: "Sample Pack", entries }));
    await checkManifest({ repo })(
      event({ folderName: "Sample Pack", entries: pack(9) }),
    );
    await checkManifest({ repo })(event({ folderName: "Nope", entries: pack(2, "Nope") }));

    expect(repo.writeCount()).toBe(writesBefore);
    expect(repo.all()).toHaveLength(1);
  });

  it("AFR-004: identity is stable across separate calls on one repository", async () => {
    const repo = new MemoryManifestRepository();
    const stored = pack(10);
    await repo.putManifest(record(USER, "Sample Pack", stored, "folder-stable"));
    const handler = checkManifest({ repo });

    const superset = [
      ...stored,
      { relativePath: "Sample Pack/Vol 9/extra.wav", sizeBytes: 55, checksum: "extra" },
    ];
    const first = JSON.parse(
      (await handler(event({ folderName: "Sample Pack", entries: superset }))).body,
    );
    expect(first.match).toBe("partial");
    expect(first.folderId).toBe("folder-stable");
    expect(first.existingCount).toBe(10);
    expect(first.newBytes).toBe(55);

    const second = JSON.parse(
      (await handler(event({ folderName: "Sample Pack", entries: stored }))).body,
    );
    expect(second.match).toBe("exact");
    expect(second.folderId).toBe("folder-stable");

    const third = JSON.parse(
      (await handler(event({ folderName: "Sample Pack", entries: [...stored].reverse() })))
        .body,
    );
    expect(third).toEqual(second);
  });

  it("returns 401 when the verified sub claim is missing (Rule 7)", async () => {
    const repo = new MemoryManifestRepository();
    const res = await checkManifest({ repo })(
      event({ folderName: "Pack", entries: pack(2) }, null),
    );
    expect(res.statusCode).toBe(401);
  });

  it("returns 400 for an empty entries array", async () => {
    const repo = new MemoryManifestRepository();
    const res = await checkManifest({ repo })(
      event({ folderName: "Pack", entries: [] }),
    );
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 for a traversal path and rejects the WHOLE request", async () => {
    const repo = new MemoryManifestRepository();
    const res = await checkManifest({ repo })(
      event({
        folderName: "Pack",
        entries: [
          { relativePath: "Pack/ok.wav", sizeBytes: 1, checksum: "aa" },
          { relativePath: "../escape.wav", sizeBytes: 1, checksum: "bb" },
        ],
      }),
    );
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 for a duplicate relativePath inside one manifest", async () => {
    const repo = new MemoryManifestRepository();
    const res = await checkManifest({ repo })(
      event({
        folderName: "Pack",
        entries: [
          { relativePath: "Pack/a.wav", sizeBytes: 1, checksum: "aa" },
          { relativePath: "Pack/a.wav", sizeBytes: 1, checksum: "bb" },
        ],
      }),
    );
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 for a negative size or an empty checksum", async () => {
    const repo = new MemoryManifestRepository();
    const neg = await checkManifest({ repo })(
      event({
        folderName: "Pack",
        entries: [{ relativePath: "Pack/a.wav", sizeBytes: -1, checksum: "aa" }],
      }),
    );
    expect(neg.statusCode).toBe(400);
    const empty = await checkManifest({ repo })(
      event({
        folderName: "Pack",
        entries: [{ relativePath: "Pack/a.wav", sizeBytes: 1, checksum: "" }],
      }),
    );
    expect(empty.statusCode).toBe(400);
  });

  it("returns 400 for a missing folderName", async () => {
    const repo = new MemoryManifestRepository();
    const res = await checkManifest({ repo })(event({ entries: pack(2) }));
    expect(res.statusCode).toBe(400);
  });

  it("keeps NFC and NFD folder manifests distinct (Rule 1)", async () => {
    const repo = new MemoryManifestRepository();
    const nfc = "Café/kick.wav".normalize("NFC");
    const nfd = "Café/kick.wav".normalize("NFD");
    await repo.putManifest(
      record(USER, "Café", [{ relativePath: nfc, sizeBytes: 1, checksum: "aa" }]),
    );
    const res = await checkManifest({ repo })(
      event({
        folderName: "Café".normalize("NFD"),
        entries: [{ relativePath: nfd, sizeBytes: 1, checksum: "aa" }],
      }),
    );
    expect(JSON.parse(res.body)).toEqual({ match: "none" });
  });

  it("F2-1: identical contents under a different folderName are none, never exact (Rule 3)", async () => {
    const repo = new MemoryManifestRepository();
    const entries: ManifestEntry[] = [
      { relativePath: "logo.png", sizeBytes: 100, checksum: "aa" },
      { relativePath: "brief.pdf", sizeBytes: 200, checksum: "bb" },
    ];
    await repo.putManifest(record(USER, "Client A Deliverables", entries, "folder-A"));
    const handler = checkManifest({ repo });

    // AFR-004: two separate calls against ONE repository.
    const other = JSON.parse(
      (await handler(event({ folderName: "Client B Deliverables", entries }))).body,
    );
    expect(other).toEqual({ match: "none" });

    const own = JSON.parse(
      (await handler(event({ folderName: "Client A Deliverables", entries }))).body,
    );
    expect(own.match).toBe("exact");
    expect(own.folderId).toBe("folder-A");
  });

  it("F2-1 ACCEPTED CONSEQUENCE: a RENAMED folder returns none and re-uploads — intended", async () => {
    // A false negative costs bandwidth; the false positive it replaces costs
    // the creator their files. Documented as intended behaviour, not a bug.
    const repo = new MemoryManifestRepository();
    const entries = pack(4, "Mixdowns");
    await repo.putManifest(record(USER, "Mixdowns", entries, "folder-mix"));
    const res = await checkManifest({ repo })(
      event({ folderName: "Mixdowns FINAL", entries }),
    );
    expect(JSON.parse(res.body)).toEqual({ match: "none" });
  });
});
