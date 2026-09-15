/**
 * ADVERSARIAL validation of PRD section 7 duplicate detection.
 *
 * Written by an independent validator. The priority failure mode is the
 * FALSE POSITIVE: wrongly telling a creator "you already have this folder"
 * can make them cancel a Stash and permanently lose files that were never
 * uploaded. A false negative only wastes bandwidth.
 *
 * Tests that FAIL here are deliberate: they document a defect in the code
 * under test, which this file is forbidden to fix.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { checkManifest } from "../src/check-manifest.js";
import { manifestHash } from "../src/manifest-hash.js";
import { MemoryManifestRepository } from "../src/memory-repository.js";
import type { APIGatewayProxyEventV2WithJWTAuthorizer } from "aws-lambda";
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
    body: JSON.stringify(body),
  };
}

/** A deliberately malformed/partial event, as an attacker's request arrives. */
function rawEvent(e: Record<string, unknown>): APIGatewayProxyEventV2WithJWTAuthorizer {
  return e as unknown as APIGatewayProxyEventV2WithJWTAuthorizer;
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

async function check(
  repo: MemoryManifestRepository,
  body: unknown,
  sub: string | null = USER,
) {
  const res = await checkManifest({ repo })(event(body, sub));
  return { statusCode: res.statusCode, body: JSON.parse(res.body) as any };
}

function pack(count: number, prefix = "Sample Pack"): ManifestEntry[] {
  return Array.from({ length: count }, (_, i) => ({
    relativePath: `${prefix}/Vol ${i % 7}/file-${i}.wav`,
    sizeBytes: 1000 + i,
    checksum: `sum-${i}`,
  }));
}

afterEach(() => {
  vi.restoreAllMocks();
});

// -------------------------------------------------------------------------
// A. FALSE POSITIVES - the failure mode that loses data.
// -------------------------------------------------------------------------
describe("ADVERSARIAL: false positives", () => {
  it("DEFECT HUNT: identical contents under a DIFFERENT folderName must not be exact", async () => {
    // Two genuinely different deliverable folders holding byte-identical
    // files at identical relative paths (a designer copying a template pack
    // per client). folderName is NOT part of manifestHash, so findByHash
    // returns Client A's record for a Client B folder never Stashed.
    const repo = new MemoryManifestRepository();
    const entries: ManifestEntry[] = [
      { relativePath: "logo.png", sizeBytes: 100, checksum: "aa" },
      { relativePath: "brief.pdf", sizeBytes: 200, checksum: "bb" },
    ];
    await repo.putManifest(record(USER, "Client A Deliverables", entries, "folder-A"));

    const { body } = await check(repo, {
      folderName: "Client B Deliverables",
      entries,
    });
    expect(body.match).not.toBe("exact");
  });

  it("a folder whose name matches but whose every path differs is none", async () => {
    const repo = new MemoryManifestRepository();
    await repo.putManifest(
      record(USER, "Drums", [
        { relativePath: "Drums/2023/kick.wav", sizeBytes: 1, checksum: "aa" },
        { relativePath: "Drums/2023/snare.wav", sizeBytes: 2, checksum: "bb" },
      ]),
    );
    const { body } = await check(repo, {
      folderName: "Drums",
      entries: [
        { relativePath: "Drums/2024/kick.wav", sizeBytes: 1, checksum: "aa" },
        { relativePath: "Drums/2024/snare.wav", sizeBytes: 2, checksum: "bb" },
      ],
    });
    expect(body).toEqual({ match: "none" });
  });

  it("a manifest where every file shares ONE checksum never matches a different folder", async () => {
    const repo = new MemoryManifestRepository();
    const stored: ManifestEntry[] = Array.from({ length: 20 }, (_, i) => ({
      relativePath: `Empties/a-${i}.wav`,
      sizeBytes: 0,
      checksum: "e3b0c44298fc1c149afbf4c8996fb924",
    }));
    await repo.putManifest(record(USER, "Empties", stored, "folder-empties"));

    const different: ManifestEntry[] = Array.from({ length: 20 }, (_, i) => ({
      relativePath: `Empties/b-${i}.wav`,
      sizeBytes: 0,
      checksum: "e3b0c44298fc1c149afbf4c8996fb924",
    }));
    const { body } = await check(repo, { folderName: "Empties", entries: different });
    expect(body).toEqual({ match: "none" });
  });

  it("a 3-file subset of an 1,850-file stored folder is never exact", async () => {
    const repo = new MemoryManifestRepository();
    const big = pack(1850);
    await repo.putManifest(record(USER, "Sample Pack", big, "folder-big"));

    const { body } = await check(repo, {
      folderName: "Sample Pack",
      entries: big.slice(0, 3),
    });
    expect(body.match).toBe("partial");
    expect(body.existingCount).toBe(3);
    expect(body.newFiles).toEqual([]);
    expect(body.newBytes).toBe(0);
  });

  it("a single-file manifest sharing one file with a huge folder is partial, never exact", async () => {
    const repo = new MemoryManifestRepository();
    const big = pack(1850);
    await repo.putManifest(record(USER, "Sample Pack", big, "folder-big"));
    const { body } = await check(repo, {
      folderName: "Sample Pack",
      entries: [big[42]],
    });
    expect(body.match).toBe("partial");
    expect(body.existingCount).toBe(1);
  });

  it("checksum case is significant: ABC and abc are DIFFERENT files", async () => {
    expect(
      manifestHash(FOLDER, [{ relativePath: "a.wav", sizeBytes: 1, checksum: "ABC" }]),
    ).not.toBe(manifestHash(FOLDER, [{ relativePath: "a.wav", sizeBytes: 1, checksum: "abc" }]));

    const repo = new MemoryManifestRepository();
    await repo.putManifest(
      record(USER, "Pack", [
        { relativePath: "Pack/a.wav", sizeBytes: 1, checksum: "ABC" },
      ]),
    );
    const { body } = await check(repo, {
      folderName: "Pack",
      entries: [{ relativePath: "Pack/a.wav", sizeBytes: 1, checksum: "abc" }],
    });
    expect(body).toEqual({ match: "none" });
  });

  it("path case is significant: A.WAV and a.wav are DIFFERENT files", async () => {
    const repo = new MemoryManifestRepository();
    await repo.putManifest(
      record(USER, "Pack", [
        { relativePath: "Pack/A.WAV", sizeBytes: 1, checksum: "aa" },
      ]),
    );
    const { body } = await check(repo, {
      folderName: "Pack",
      entries: [{ relativePath: "Pack/a.wav", sizeBytes: 1, checksum: "aa" }],
    });
    expect(body).toEqual({ match: "none" });
  });

  it("DEFECT HUNT: same path + same checksum but a DIFFERENT sizeBytes must count as NEW", async () => {
    // pairKey() ignores sizeBytes. A stored record claiming 1 byte and a
    // candidate claiming 4 GB at the same path with the same checksum is a
    // contradiction; calling it "already Stashed" means 4 GB never uploads.
    const repo = new MemoryManifestRepository();
    await repo.putManifest(
      record(
        USER,
        "Pack",
        [
          { relativePath: "Pack/a.wav", sizeBytes: 1, checksum: "aa" },
          { relativePath: "Pack/b.wav", sizeBytes: 2, checksum: "bb" },
        ],
        "folder-p",
      ),
    );
    const { body } = await check(repo, {
      folderName: "Pack",
      entries: [
        { relativePath: "Pack/a.wav", sizeBytes: 1, checksum: "aa" },
        { relativePath: "Pack/b.wav", sizeBytes: 4000000000, checksum: "bb" },
      ],
    });
    expect(body.match).toBe("partial");
    expect(body.existingCount).toBe(1);
    expect(body.newFiles).toEqual([
      { relativePath: "Pack/b.wav", sizeBytes: 4000000000, checksum: "bb" },
    ]);
    expect(body.newBytes).toBe(4000000000);
  });
});

// -------------------------------------------------------------------------
// B. HASH FORGERY - can two different manifests be made to collide?
// -------------------------------------------------------------------------
describe("ADVERSARIAL: manifestHash collision attempts", () => {
  const NL = String.fromCharCode(10);
  const forgeries: Array<[string, ManifestEntry[], ManifestEntry[]]> = [
    [
      "path carrying the field separator",
      [{ relativePath: "a:1:62", sizeBytes: 1, checksum: "b" }],
      [{ relativePath: "a", sizeBytes: 1, checksum: "b" }],
    ],
    [
      "checksum carrying the field separator",
      [{ relativePath: "a", sizeBytes: 1, checksum: "b:2:63" }],
      [{ relativePath: "a", sizeBytes: 12, checksum: "63" }],
    ],
    [
      "checksum carrying a newline",
      [{ relativePath: "a", sizeBytes: 1, checksum: `x${NL}6` }],
      [{ relativePath: "a", sizeBytes: 1, checksum: "x" }],
    ],
    [
      "path that is the hex of another entry field",
      [{ relativePath: "61", sizeBytes: 1, checksum: "62" }],
      [{ relativePath: "a", sizeBytes: 1, checksum: "b" }],
    ],
    [
      "one entry impersonating two entries",
      [{ relativePath: "a", sizeBytes: 1, checksum: `b${NL}63:2:64` }],
      [
        { relativePath: "a", sizeBytes: 1, checksum: "b" },
        { relativePath: "c", sizeBytes: 2, checksum: "d" },
      ],
    ],
    [
      "path shifted across the path/checksum boundary",
      [{ relativePath: "dir/sub", sizeBytes: 5, checksum: "cc" }],
      [{ relativePath: "dir", sizeBytes: 5, checksum: "/subcc" }],
    ],
    [
      "size string exploiting exponent notation",
      [{ relativePath: "a", sizeBytes: 1e21, checksum: "b" }],
      [{ relativePath: "a", sizeBytes: 1, checksum: "be21" }],
    ],
  ];

  for (const [name, left, right] of forgeries) {
    it(`cannot forge a collision via ${name}`, () => {
      expect(manifestHash(FOLDER, left)).not.toBe(manifestHash(FOLDER, right));
    });
  }

  it("duplicate identical entries change the hash (multiset, not set)", () => {
    const a: ManifestEntry = { relativePath: "a", sizeBytes: 1, checksum: "b" };
    expect(manifestHash(FOLDER, [a])).not.toBe(manifestHash(FOLDER, [a, a]));
  });

  it("is order-independent across 500 random shuffles of a 200-entry manifest", () => {
    const entries = pack(200);
    const base = manifestHash(FOLDER, entries);
    for (let round = 0; round < 500; round += 1) {
      const shuffled = [...entries];
      for (let i = shuffled.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        const tmp = shuffled[i]!;
        shuffled[i] = shuffled[j]!;
        shuffled[j] = tmp;
      }
      expect(manifestHash(FOLDER, shuffled)).toBe(base);
    }
  });

  it("no two distinct entries in a 2,000-entry corpus hash alike", () => {
    const seen = new Map<string, string>();
    const variants: ManifestEntry[] = [];
    for (let i = 0; i < 500; i += 1) {
      variants.push({ relativePath: `p${i}`, sizeBytes: i, checksum: "c" });
      variants.push({ relativePath: "p", sizeBytes: i, checksum: `c${i}` });
      variants.push({ relativePath: `p${i}`, sizeBytes: 0, checksum: `c${i}` });
      variants.push({ relativePath: `p/${i}`, sizeBytes: i, checksum: `${i}/c` });
    }
    for (const entry of variants) {
      const id = JSON.stringify(entry);
      const h = manifestHash(FOLDER, [entry]);
      const prior = seen.get(h);
      expect(prior === undefined || prior === id).toBe(true);
      seen.set(h, id);
    }
    expect(seen.size).toBe(variants.length);
  });

  it("does not normalize: NFC, NFD, emoji and RTL-override paths all hash differently", () => {
    const base = "Café/kick.wav";
    const paths = [
      base.normalize("NFC"),
      base.normalize("NFD"),
      "Café/kick.wav",
      "Café/kick‮.wav",
      "Café/kick🎧.wav",
      "CAFÉ/kick.wav",
    ];
    const hashes = new Set(
      paths.map((p) => manifestHash(FOLDER, [{ relativePath: p, sizeBytes: 1, checksum: "aa" }])),
    );
    // Cafe + combining acute IS the NFD form: 5 distinct paths, 5 hashes.
    expect(new Set(paths).size).toBe(5);
    expect(hashes.size).toBe(5);
  });
});

// -------------------------------------------------------------------------
// C. TENANCY
// -------------------------------------------------------------------------
describe("ADVERSARIAL: tenancy", () => {
  it("a crafted body user_id / sub cannot reach another creator's manifest", async () => {
    const repo = new MemoryManifestRepository();
    const entries = pack(4);
    await repo.putManifest(record(OTHER, "Sample Pack", entries, "folder-other"));

    for (const forged of [
      { folderName: "Sample Pack", entries, user_id: OTHER },
      { folderName: "Sample Pack", entries, userId: OTHER },
      { folderName: "Sample Pack", entries, sub: OTHER },
      { folderName: "Sample Pack", entries, pk: `USER#${OTHER}` },
    ]) {
      const { body } = await check(repo, forged);
      expect(body).toEqual({ match: "none" });
    }
  });

  it("a folderName shaped like the key scheme cannot cross the partition", async () => {
    const repo = new MemoryManifestRepository();
    const entries: ManifestEntry[] = [
      { relativePath: "a.wav", sizeBytes: 1, checksum: "aa" },
    ];
    await repo.putManifest(record(OTHER, `USER#${OTHER}`, entries, "folder-other"));
    await repo.putManifest(
      record(OTHER, `MANIFEST#${manifestHash(FOLDER, entries)}`, entries, "folder-other-2"),
    );

    for (const folderName of [
      `USER#${OTHER}`,
      `MANIFEST#${manifestHash(FOLDER, entries)}`,
      `USER#${OTHER}#MANIFEST#${manifestHash(FOLDER, entries)}`,
    ]) {
      const { body } = await check(repo, { folderName, entries });
      expect(body).toEqual({ match: "none" });
    }
  });

  it("a userId containing the key delimiter cannot alias another userId", async () => {
    const repo = new MemoryManifestRepository();
    const entries = pack(3);
    await repo.putManifest(record("a#MANIFEST", "Pack", entries, "folder-weird"));

    const { body } = await check(repo, { folderName: "Pack", entries }, "a");
    expect(body).toEqual({ match: "none" });
  });

  it("401 (never a match) when the sub claim is absent, empty or non-string", async () => {
    const repo = new MemoryManifestRepository();
    const entries = pack(2);
    await repo.putManifest(record(USER, "Pack", entries, "folder-p"));
    const claimSets: Array<Record<string, unknown> | undefined> = [
      undefined,
      {},
      { sub: "" },
      { sub: 123 },
      { sub: null },
    ];
    for (const claims of claimSets) {
      const res = await checkManifest({ repo })(rawEvent({
        requestContext: {
          authorizer: claims === undefined ? {} : { jwt: { claims } },
        },
        headers: {},
        body: JSON.stringify({ folderName: "Pack", entries }),
      }));
      expect(res.statusCode).toBe(401);
      expect(res.body).not.toContain("folder-p");
    }
  });
});

// -------------------------------------------------------------------------
// D. RULE 3 / RULE 9 - no write, no S3, no mutation, under EVERY branch.
// -------------------------------------------------------------------------
describe("ADVERSARIAL: the check is purely read-only", () => {
  it("never writes and never mutates the stored record on any branch", async () => {
    const repo = new MemoryManifestRepository();
    const stored = pack(10);
    const rec = record(USER, "Sample Pack", stored, "folder-ro");
    await repo.putManifest(rec);
    rec.entries.forEach((e) => Object.freeze(e));
    Object.freeze(rec.entries);
    Object.freeze(rec);
    const writesBefore = repo.writeCount();
    const snapshot = JSON.stringify(repo.all());

    await check(repo, { folderName: "Sample Pack", entries: stored });
    await check(repo, {
      folderName: "Sample Pack",
      entries: [...stored, ...pack(2, "New")],
    });
    await check(repo, { folderName: "Nothing", entries: pack(2, "Nothing") });
    await check(repo, { folderName: "", entries: stored });
    await check(repo, { folderName: "Sample Pack", entries: stored }, null);

    expect(repo.writeCount()).toBe(writesBefore);
    expect(JSON.stringify(repo.all())).toBe(snapshot);
  });

  it("makes no network call of any kind (no S3, no fetch)", async () => {
    const repo = new MemoryManifestRepository();
    const entries = pack(5);
    await repo.putManifest(record(USER, "Sample Pack", entries, "folder-net"));
    const fetchSpy = vi.spyOn(globalThis as any, "fetch").mockImplementation(() => {
      throw new Error("network call attempted during manifest check");
    });
    await check(repo, { folderName: "Sample Pack", entries });
    await check(repo, { folderName: "Sample Pack", entries: pack(6) });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("the manifest source tree references no S3 / AWS SDK client at all", () => {
    const srcDir = join(dirname(fileURLToPath(import.meta.url)), "..", "src");
    const offenders: string[] = [];
    for (const file of readdirSync(srcDir)) {
      const text = readFileSync(join(srcDir, file), "utf8");
      if (/@aws-sdk\/client-s3|S3Client|GetObjectCommand|PutObjectCommand/.test(text)) {
        offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("nothing in the check handler deletes, repoints, merges or dedupes", () => {
    const srcDir = join(dirname(fileURLToPath(import.meta.url)), "..", "src");
    const handler = readFileSync(join(srcDir, "check-manifest.ts"), "utf8");
    expect(handler).not.toMatch(/\.putManifest\(/);
    expect(handler).not.toMatch(/\.delete[A-Za-z]*\(/);
    expect(handler).not.toMatch(/\.update[A-Za-z]*\(/);
  });
});

// -------------------------------------------------------------------------
// E. INPUT ABUSE
// -------------------------------------------------------------------------
describe("ADVERSARIAL: input abuse", () => {
  it("rejects malformed bodies and entry shapes with 400, never a match", async () => {
    const repo = new MemoryManifestRepository();
    await repo.putManifest(record(USER, "Pack", pack(2), "folder-p"));
    const bad: unknown[] = [
      undefined,
      null,
      "not json",
      "[]",
      "null",
      JSON.stringify({ folderName: "Pack" }),
      JSON.stringify({ folderName: "Pack", entries: {} }),
      JSON.stringify({ folderName: "Pack", entries: [null] }),
      JSON.stringify({ folderName: "Pack", entries: ["a/b.wav"] }),
      JSON.stringify({ folderName: "Pack", entries: [{ sizeBytes: 1, checksum: "aa" }] }),
      JSON.stringify({
        folderName: "Pack",
        entries: [{ relativePath: "a", checksum: "aa" }],
      }),
      JSON.stringify({ folderName: "Pack", entries: [{ relativePath: "a", sizeBytes: 1 }] }),
      JSON.stringify({
        folderName: "Pack",
        entries: [{ relativePath: "a", sizeBytes: null, checksum: "aa" }],
      }),
      JSON.stringify({
        folderName: "Pack",
        entries: [{ relativePath: "a", sizeBytes: "1", checksum: "aa" }],
      }),
      JSON.stringify({
        folderName: "Pack",
        entries: [{ relativePath: "a", sizeBytes: 1, checksum: 42 }],
      }),
      JSON.stringify({ folderName: 42, entries: pack(1) }),
      JSON.stringify({ folderName: "", entries: pack(1) }),
    ];
    for (const body of bad) {
      const res = await checkManifest({ repo })(rawEvent({
        requestContext: { authorizer: { jwt: { claims: { sub: USER } } } },
        headers: {},
        body,
      }));
      expect(res.statusCode).toBe(400);
      expect(res.body).not.toContain("folder-p");
    }
  });

  it("a NaN sizeBytes is rejected, never treated as a match", async () => {
    const repo = new MemoryManifestRepository();
    const res = await checkManifest({ repo })(rawEvent({
      requestContext: { authorizer: { jwt: { claims: { sub: USER } } } },
      headers: {},
      body: {
        folderName: "Pack",
        entries: [{ relativePath: "a", sizeBytes: Number.NaN, checksum: "aa" }],
      },
    }));
    expect(res.statusCode).toBe(400);
  });

  it("__proto__ as a folderName or path segment does not pollute Object.prototype", async () => {
    const repo = new MemoryManifestRepository();
    await repo.putManifest(
      record(
        USER,
        "__proto__",
        [{ relativePath: "__proto__/constructor.wav", sizeBytes: 1, checksum: "aa" }],
        "folder-proto",
      ),
    );
    const { statusCode, body } = await check(repo, {
      folderName: "__proto__",
      entries: [
        { relativePath: "__proto__/constructor.wav", sizeBytes: 1, checksum: "aa" },
        { relativePath: "constructor/prototype.wav", sizeBytes: 2, checksum: "bb" },
      ],
    });
    expect(statusCode).toBe(200);
    expect(body.match).toBe("partial");
    expect(({} as any).polluted).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(Object.prototype, "aa")).toBe(false);
  });

  it("a JSON-injected __proto__ key in the body cannot poison the result", async () => {
    const repo = new MemoryManifestRepository();
    const res = await checkManifest({ repo })(rawEvent({
      requestContext: { authorizer: { jwt: { claims: { sub: USER } } } },
      headers: {},
      body: '{"folderName":"Pack","entries":[{"relativePath":"a.wav","sizeBytes":1,"checksum":"aa","__proto__":{"match":"exact"}}]}',
    }));
    expect(JSON.parse(res.body)).toEqual({ match: "none" });
    expect(({} as any).match).toBeUndefined();
  });

  it("zero-byte files are legal and contribute 0 to newBytes", async () => {
    const repo = new MemoryManifestRepository();
    await repo.putManifest(
      record(USER, "Pack", [{ relativePath: "Pack/a.wav", sizeBytes: 0, checksum: "aa" }], "f0"),
    );
    const { body } = await check(repo, {
      folderName: "Pack",
      entries: [
        { relativePath: "Pack/a.wav", sizeBytes: 0, checksum: "aa" },
        { relativePath: "Pack/b.wav", sizeBytes: 0, checksum: "bb" },
      ],
    });
    expect(body.match).toBe("partial");
    expect(body.existingCount).toBe(1);
    expect(body.newBytes).toBe(0);
    expect(body.newFiles).toHaveLength(1);
  });

  it("an enormous manifest (5,000 entries) is diffed correctly and in bounds", async () => {
    const repo = new MemoryManifestRepository();
    const all = pack(5000);
    await repo.putManifest(record(USER, "Sample Pack", all.slice(0, 4997), "folder-huge"));
    const { body } = await check(repo, { folderName: "Sample Pack", entries: all });
    expect(body.match).toBe("partial");
    expect(body.existingCount).toBe(4997);
    expect(body.newFiles).toHaveLength(3);
    expect(body.existingCount + body.newFiles.length).toBe(all.length);
    expect(body.newBytes).toBe(all.slice(4997).reduce((s, e) => s + e.sizeBytes, 0));
  });

  it("a very long folderName never throws and never matches a short one", async () => {
    // REVISED with F2-5: folderName is now validated (<= 255 bytes), so an
    // absurd name is rejected with 400 before anything is compared. The
    // guarantee this test exists for is unchanged and still asserted: the
    // handler never throws, and a long name NEVER yields a match against a
    // short one.
    const repo = new MemoryManifestRepository();
    await repo.putManifest(record(USER, "P", pack(2), "folder-short"));
    const { statusCode, body } = await check(repo, {
      folderName: "P".repeat(100000),
      entries: pack(2, "Other"),
    });
    expect(statusCode).toBe(400);
    expect(body.match).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain("folder-short");
  });

  it("F2-5: rejects an empty, control-character or over-long folderName with 400, writing nothing", async () => {
    const repo = new MemoryManifestRepository();
    const entries = pack(2, "Pack");
    await repo.putManifest(record(USER, "Pack", entries, "folder-p"));
    const writesBefore = repo.writeCount();
    const badNames = [
      "",
      "Pack\u0000name",
      "Pack\nname",
      "Pack\tname",
      "Pack\u001b[31m",
      "Pack\u007f",
      "P".repeat(256),
      // 255 characters but 510 BYTES: the limit is bytes, not code units.
      "é".repeat(255),
    ];
    for (const folderName of badNames) {
      const { statusCode, body } = await check(repo, { folderName, entries });
      expect(statusCode).toBe(400);
      expect(body.match).toBeUndefined();
      expect(JSON.stringify(body)).not.toContain("folder-p");
    }
    // AFR-004: many separate calls, one repository — still zero writes.
    expect(repo.writeCount()).toBe(writesBefore);
  });

  it("F2-5: a unicode folderName is accepted and matched BYTE-IDENTICALLY (Rule 1)", async () => {
    const repo = new MemoryManifestRepository();
    const nfc = "Café 🎧 مجلد".normalize("NFC");
    const nfd = nfc.normalize("NFD");
    expect(nfc).not.toBe(nfd);
    const entries: ManifestEntry[] = [
      { relativePath: "a.wav", sizeBytes: 1, checksum: "aa" },
    ];
    await repo.putManifest(record(USER, nfc, entries, "folder-nfc"));

    // The exact same bytes match; its NFD twin, and a padded variant, do not.
    const same = await check(repo, { folderName: nfc, entries });
    expect(same.statusCode).toBe(200);
    expect(same.body.match).toBe("exact");
    expect(same.body.folderName).toBe(nfc);

    for (const other of [nfd, ` ${nfc}`, `${nfc} `, nfc.toUpperCase()]) {
      const res = await check(repo, { folderName: other, entries });
      expect(res.statusCode).toBe(200);
      expect(res.body).toEqual({ match: "none" });
    }
  });
});

// -------------------------------------------------------------------------
// F. PARTIAL ARITHMETIC INVARIANTS
// -------------------------------------------------------------------------
describe("ADVERSARIAL: partial arithmetic invariants", () => {
  it("across 200 randomized folders the invariants always hold", async () => {
    for (let round = 0; round < 200; round += 1) {
      const repo = new MemoryManifestRepository();
      const total = 1 + Math.floor(Math.random() * 40);
      const all = pack(total, `Pack${round}`);
      const keep = Math.floor(Math.random() * (total + 1));
      const stored = all.slice(0, keep);
      if (stored.length > 0) {
        await repo.putManifest(record(USER, `Pack${round}`, stored, `f${round}`));
      }
      const { body } = await check(repo, { folderName: `Pack${round}`, entries: all });

      if (body.match === "partial") {
        expect(body.existingCount).toBeGreaterThan(0);
        expect(body.existingCount).toBeLessThanOrEqual(all.length);
        expect(body.existingCount + body.newFiles.length).toBe(all.length);
        expect(body.newBytes).toBe(
          body.newFiles.reduce((s: number, e: ManifestEntry) => s + e.sizeBytes, 0),
        );
        const storedKeys = new Set(stored.map((e) => `${e.relativePath}|${e.checksum}`));
        for (const nf of body.newFiles as ManifestEntry[]) {
          expect(storedKeys.has(`${nf.relativePath}|${nf.checksum}`)).toBe(false);
        }
        expect(body.existingCount).toBe(keep);
      } else if (body.match === "exact") {
        expect(keep).toBe(total);
      } else {
        expect(keep).toBe(0);
      }
    }
  });

  it("F2-2: two same-name candidates both sharing files are AMBIGUOUS -> none, deterministically", async () => {
    // REVISED with F2-2. This test previously asserted that the best-overlap
    // candidate won. Naming one of several same-name folders puts ANOTHER
    // folder's folderId in front of the creator and withholds the shared
    // files from newFiles; a client acting on that merges distinct folders
    // (Rule 1). The determinism this test was written to guard is unchanged:
    // repeated calls still give one identical answer.
    const repo = new MemoryManifestRepository();
    const a = pack(6, "Shared");
    await repo.putManifest(record(USER, "Shared", a.slice(0, 3), "folder-a"));
    await repo.putManifest(
      record(USER, "Shared", [...a.slice(0, 3)].reverse().concat(a[3]!), "folder-b"),
    );
    const handler = checkManifest({ repo });
    const results: string[] = [];
    for (let i = 0; i < 5; i += 1) {
      results.push((await handler(event({ folderName: "Shared", entries: a }))).body);
    }
    expect(new Set(results).size).toBe(1);
    expect(JSON.parse(results[0]!)).toEqual({ match: "none" });
    expect(results[0]!).not.toContain("folder-a");
    expect(results[0]!).not.toContain("folder-b");
  });

  it("F2-2: exactly ONE overlapping candidate still reports partial (AFR-004: two calls, one repo)", async () => {
    const repo = new MemoryManifestRepository();
    const a = pack(6, "Shared");
    await repo.putManifest(record(USER, "Shared", a.slice(0, 4), "folder-a"));
    const handler = checkManifest({ repo });

    const one = JSON.parse(
      (await handler(event({ folderName: "Shared", entries: a }))).body,
    );
    expect(one.match).toBe("partial");
    expect(one.folderId).toBe("folder-a");
    expect(one.existingCount).toBe(4);

    // A second same-name folder that shares NOTHING is not a candidate, so the
    // answer must not change: ambiguity is about OVERLAP, not about the name.
    await repo.putManifest(record(USER, "Shared", pack(3, "Elsewhere"), "folder-c"));
    const two = JSON.parse(
      (await handler(event({ folderName: "Shared", entries: a }))).body,
    );
    expect(two).toEqual(one);

    // A THIRD folder that does overlap makes it ambiguous: none.
    await repo.putManifest(record(USER, "Shared", a.slice(0, 2), "folder-d"));
    const three = JSON.parse(
      (await handler(event({ folderName: "Shared", entries: a }))).body,
    );
    expect(three).toEqual({ match: "none" });
  });

  it("exact wins over a same-name partial candidate", async () => {
    const repo = new MemoryManifestRepository();
    const entries = pack(5, "Pack");
    await repo.putManifest(record(USER, "Pack", entries.slice(0, 4), "folder-partial"));
    await repo.putManifest(record(USER, "Pack", entries, "folder-exact"));
    const { body } = await check(repo, { folderName: "Pack", entries });
    expect(body.match).toBe("exact");
    expect(body.folderId).toBe("folder-exact");
  });
});
