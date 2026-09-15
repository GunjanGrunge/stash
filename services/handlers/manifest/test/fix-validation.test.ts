/**
 * FINAL FIX VALIDATION for F2 (F2-1, F2-2, F2-3, F2-5, typed event, AFR-005).
 *
 * Written by an independent final validator AFTER the repairs landed. Nothing
 * here may modify src; a failing test here documents a defect the repair did
 * not close (or introduced).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { checkManifest } from "../src/check-manifest.js";
import { manifestHash } from "../src/manifest-hash.js";
import { MemoryManifestRepository } from "../src/memory-repository.js";
import type { APIGatewayProxyEventV2WithJWTAuthorizer } from "aws-lambda";
import type { ManifestEntry, ManifestRecord } from "../src/types.js";

const USER = "user-fixval";
const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "src");

function event(body: unknown, sub: string | null = USER): APIGatewayProxyEventV2WithJWTAuthorizer {
  return {
    requestContext: { authorizer: sub === null ? {} : { jwt: { claims: { sub } } } },
    headers: {},
    body: JSON.stringify(body),
  } as unknown as APIGatewayProxyEventV2WithJWTAuthorizer;
}

function rawEvent(e: unknown): APIGatewayProxyEventV2WithJWTAuthorizer {
  return e as APIGatewayProxyEventV2WithJWTAuthorizer;
}

function record(
  userId: string,
  folderName: string,
  entries: ManifestEntry[],
  folderId: string,
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
    totalBytes: entries.reduce((s, e) => s + e.sizeBytes, 0),
    entries,
  };
}

async function check(repo: MemoryManifestRepository, body: unknown, sub: string | null = USER) {
  const res = await checkManifest({ repo })(event(body, sub));
  return { statusCode: res.statusCode, raw: res.body, body: JSON.parse(res.body) as any };
}

function pack(n: number, prefix: string): ManifestEntry[] {
  return Array.from({ length: n }, (_, i) => ({
    relativePath: `${prefix}/f-${i}.wav`,
    sizeBytes: 1000 + i,
    checksum: `sum-${prefix}-${i}`,
  }));
}

// =========================================================================
// F2-1: the folder: line cannot be forged from either side.
// =========================================================================
describe("FIXVAL F2-1: manifestHash folder framing", () => {
  it("no crafted folderName or relativePath produces a digest collision", () => {
    // Every pair here is a DIFFERENT folder identity. If the folder: line
    // could be forged, or an entry line could occupy the folder slot, two of
    // these would hash alike.
    const e = (p: string, s: number, c: string): ManifestEntry[] => [
      { relativePath: p, sizeBytes: s, checksum: c },
    ];
    const cases: Array<[string, string, ManifestEntry[]]> = [
      ["plain", "A", e("a.wav", 1, "aa")],
      ["plain-other-name", "B", e("a.wav", 1, "aa")],
      // A folderName that literally spells the tag.
      ["literal-tag", "folder:61", e("a.wav", 1, "aa")],
      ["literal-tag-nl", "folder:61\n61:1:6161", e("a.wav", 1, "aa")],
      // A folderName that is pure hex, i.e. looks like an encoded field.
      ["hexlike", "61", e("a.wav", 1, "aa")],
      ["hexlike2", "6161", e("a.wav", 1, "aa")],
      // Separator characters inside the name.
      ["colon", "A:B", e("a.wav", 1, "aa")],
      ["colon-swap", "A", e("a.wav:B", 1, "aa")],
      ["newline", "A\nB", e("a.wav", 1, "aa")],
      ["hash", "A#B", e("a.wav", 1, "aa")],
      // Path/checksum boundary shifting inside an entry line.
      ["shift-1", "A", e("a", 1, "bcc")],
      ["shift-2", "A", e("ab", 1, "cc")],
      ["shift-3", "A", e("a", 11, "cc")],
      ["shift-4", "A", e("a", 1, "1cc")],
      // Name/path boundary shifting across the folder line.
      ["nameshift-1", "AB", e("c.wav", 1, "aa")],
      ["nameshift-2", "A", e("Bc.wav", 1, "aa")],
      // Empty name (reachable only via the raw function, never the handler).
      ["empty-name", "", e("a.wav", 1, "aa")],
      ["empty-name-2", "", e("folder:a.wav", 1, "aa")],
    ];
    const seen = new Map<string, string>();
    for (const [label, name, entries] of cases) {
      const h = manifestHash(name, entries);
      const prior = seen.get(h);
      expect(prior, `collision: ${label} vs ${prior}`).toBeUndefined();
      seen.set(h, label);
    }
    expect(seen.size).toBe(cases.length);
  });

  it("the folder line is never sorted into the entry lines (order-independent entries only)", () => {
    const entries: ManifestEntry[] = [
      { relativePath: "z.wav", sizeBytes: 3, checksum: "cc" },
      { relativePath: "a.wav", sizeBytes: 1, checksum: "aa" },
      { relativePath: "m.wav", sizeBytes: 2, checksum: "bb" },
    ];
    const shuffled = [entries[1]!, entries[2]!, entries[0]!];
    expect(manifestHash("Pack", entries)).toBe(manifestHash("Pack", shuffled));
    // A folderName that sorts before every hex line still cannot displace it.
    expect(manifestHash("!", entries)).not.toBe(manifestHash("Pack", entries));
  });

  it("ACCEPTED TRADE-OFF: a RENAMED folder returns none and does nothing worse", async () => {
    const repo = new MemoryManifestRepository();
    const entries = pack(4, "Vol");
    await repo.putManifest(record(USER, "Old Name", entries, "folder-old"));
    const before = JSON.parse(JSON.stringify(repo.all()));
    const writesBefore = repo.writeCount();

    const { statusCode, body, raw } = await check(repo, { folderName: "New Name", entries });
    // A false NEGATIVE: re-upload. Never a merge, a repoint or a leak.
    expect(statusCode).toBe(200);
    expect(body).toEqual({ match: "none" });
    expect(raw).not.toContain("folder-old");
    expect(raw).not.toContain("Old Name");
    // Nothing written, nothing mutated, nothing duplicated, nothing reparented.
    expect(repo.writeCount()).toBe(writesBefore);
    expect(repo.all()).toHaveLength(1);
    expect(JSON.parse(JSON.stringify(repo.all()))).toEqual(before);
    // The ORIGINAL folder is still findable by its own identity.
    const still = await check(repo, { folderName: "Old Name", entries });
    expect(still.body.match).toBe("exact");
    expect(still.body.folderId).toBe("folder-old");
  });
});

// =========================================================================
// F2-2: ambiguity -> none, no disclosure, no write, deterministic.
// =========================================================================
describe("FIXVAL F2-2: ambiguity handling", () => {
  it("exactly ONE overlapping candidate among many zero-overlap ones still reports partial", async () => {
    const repo = new MemoryManifestRepository();
    const mine = pack(6, "Shared");
    await repo.putManifest(record(USER, "Shared", pack(3, "Nope1"), "folder-z1"));
    await repo.putManifest(record(USER, "Shared", pack(3, "Nope2"), "folder-z2"));
    await repo.putManifest(record(USER, "Shared", mine.slice(0, 4), "folder-hit"));
    await repo.putManifest(record(USER, "Shared", pack(3, "Nope3"), "folder-z3"));

    const { statusCode, body, raw } = await check(repo, { folderName: "Shared", entries: mine });
    expect(statusCode).toBe(200);
    expect(body.match).toBe("partial");
    expect(body.folderId).toBe("folder-hit");
    expect(body.existingCount).toBe(4);
    expect(body.newFiles).toHaveLength(2);
    for (const leak of ["folder-z1", "folder-z2", "folder-z3"]) {
      expect(raw).not.toContain(leak);
    }
  });

  it("ALL candidates zero-overlap is none, not ambiguity, and leaks no folderId", async () => {
    const repo = new MemoryManifestRepository();
    for (let i = 0; i < 4; i += 1) {
      await repo.putManifest(record(USER, "Shared", pack(3, `Other${i}`), `folder-z${i}`));
    }
    const { statusCode, body, raw } = await check(repo, {
      folderName: "Shared",
      entries: pack(3, "Mine"),
    });
    expect(statusCode).toBe(200);
    expect(body).toEqual({ match: "none" });
    expect(Object.keys(body)).toEqual(["match"]);
    for (let i = 0; i < 4; i += 1) expect(raw).not.toContain(`folder-z${i}`);
  });

  it("the ambiguous response discloses no folderId/folderName/entry of any candidate, writes nothing", async () => {
    const repo = new MemoryManifestRepository();
    const mine = pack(8, "Shared");
    await repo.putManifest(record(USER, "Shared", mine.slice(0, 5), "folder-a"));
    await repo.putManifest(record(USER, "Shared", mine.slice(3, 7), "folder-b"));
    await repo.putManifest(record(USER, "Shared", pack(2, "Irrelevant"), "folder-c"));
    const before = JSON.parse(JSON.stringify(repo.all()));
    const writesBefore = repo.writeCount();

    const { statusCode, body, raw } = await check(repo, { folderName: "Shared", entries: mine });
    expect(statusCode).toBe(200);
    expect(body).toEqual({ match: "none" });
    // Exactly one key: no existingCount, no newFiles, no newBytes, no ids.
    expect(Object.keys(body)).toEqual(["match"]);
    for (const leak of ["folder-a", "folder-b", "folder-c", "Shared", "f-0.wav", "sum-Shared-0"]) {
      expect(raw).not.toContain(leak);
    }
    // Read-only on the ambiguity branch.
    expect(repo.writeCount()).toBe(writesBefore);
    expect(JSON.parse(JSON.stringify(repo.all()))).toEqual(before);
  });

  it("ambiguity is deterministic across repeated calls AND across candidate insertion order", async () => {
    const mine = pack(8, "Shared");
    const build = async (order: number[]) => {
      const repo = new MemoryManifestRepository();
      const recs = [
        record(USER, "Shared", mine.slice(0, 5), "folder-a"),
        record(USER, "Shared", mine.slice(3, 7), "folder-b"),
        record(USER, "Shared", mine.slice(6, 8), "folder-c"),
      ];
      for (const i of order) await repo.putManifest(recs[i]!);
      return repo;
    };
    const answers = new Set<string>();
    for (const order of [[0, 1, 2], [2, 1, 0], [1, 2, 0], [1, 0, 2]]) {
      const repo = await build(order);
      const handler = checkManifest({ repo });
      for (let i = 0; i < 4; i += 1) {
        answers.add((await handler(event({ folderName: "Shared", entries: mine }))).body);
      }
    }
    expect(answers.size).toBe(1);
    expect(JSON.parse([...answers][0]!)).toEqual({ match: "none" });
  });

  it("ambiguity cannot be bypassed by a third user's folder or by a same-name folder of another user", async () => {
    const repo = new MemoryManifestRepository();
    const mine = pack(6, "Shared");
    await repo.putManifest(record(USER, "Shared", mine.slice(0, 4), "folder-a"));
    await repo.putManifest(record("user-other", "Shared", mine.slice(0, 4), "folder-other"));
    // Only ONE of my folders overlaps -> partial, and the other user's is invisible.
    const one = await check(repo, { folderName: "Shared", entries: mine });
    expect(one.body.match).toBe("partial");
    expect(one.raw).not.toContain("folder-other");

    await repo.putManifest(record(USER, "Shared", mine.slice(2, 6), "folder-b"));
    const two = await check(repo, { folderName: "Shared", entries: mine });
    expect(two.body).toEqual({ match: "none" });
    expect(two.raw).not.toContain("folder-other");
  });
});

// =========================================================================
// F2-3: pairKey boundary forging.
// =========================================================================
describe("FIXVAL F2-3: pairKey framing", () => {
  it("path/size/checksum boundaries cannot be shifted to fake an already-Stashed file", async () => {
    // Stored: one file. Candidates below are each a DIFFERENT triple chosen so
    // that an unframed join would collide with the stored one.
    const stored: ManifestEntry[] = [{ relativePath: "a", sizeBytes: 1, checksum: "bcc" }];
    const forgeries: ManifestEntry[] = [
      { relativePath: "a", sizeBytes: 1, checksum: "bcc" }, // control: real match
      { relativePath: "a", sizeBytes: 1, checksum: "b" },
      { relativePath: "a", sizeBytes: 11, checksum: "cc" },
      { relativePath: "a", sizeBytes: 1, checksum: "bc" },
      { relativePath: "ab", sizeBytes: 1, checksum: "cc" },
      { relativePath: "a", sizeBytes: 1, checksum: "Bcc" },
    ];
    for (const [i, candidate] of forgeries.entries()) {
      const repo = new MemoryManifestRepository();
      await repo.putManifest(record(USER, "Pack", stored, "folder-s"));
      const { body } = await check(repo, { folderName: "Pack", entries: [candidate] });
      if (i === 0) {
        expect(body.match).toBe("exact");
      } else {
        expect(body, `forgery ${i} was accepted`).toEqual({ match: "none" });
      }
    }
  });

  it("exponent, fractional and huge sizes are size-sensitive, never conflated", async () => {
    const sizes = [0, 1, 1.5, 1e21, 1e21 + 1e6, Number.MAX_SAFE_INTEGER, 100000000000000000000];
    // Every distinct size must produce a distinct identity for the same path.
    const hashes = new Set(
      sizes.map((s) => manifestHash("Pack", [{ relativePath: "a.wav", sizeBytes: s, checksum: "aa" }])),
    );
    expect(hashes.size).toBe(new Set(sizes).size);

    // And through the handler: a stored 2-byte file never absorbs a 4GB one.
    const repo = new MemoryManifestRepository();
    await repo.putManifest(
      record(USER, "Pack", [{ relativePath: "big.bin", sizeBytes: 2, checksum: "aa" }], "folder-s"),
    );
    const { body } = await check(repo, {
      folderName: "Pack",
      entries: [{ relativePath: "big.bin", sizeBytes: 4_000_000_000, checksum: "aa" }],
    });
    expect(body).toEqual({ match: "none" });

    // 1e21 round-trips as its own identity (String() gives "1e+21").
    const repo2 = new MemoryManifestRepository();
    await repo2.putManifest(
      record(USER, "Pack", [{ relativePath: "x", sizeBytes: 1e21, checksum: "aa" }], "folder-e"),
    );
    const same = await check(repo2, {
      folderName: "Pack",
      entries: [{ relativePath: "x", sizeBytes: 1e21, checksum: "aa" }],
    });
    expect(same.body.match).toBe("exact");
  });
});

// =========================================================================
// F2-5: validateFolderName.
// =========================================================================
describe("FIXVAL F2-5: folderName validation", () => {
  it("rejects EVERY control code point (0x00-0x1F and 0x7F) with 400 and no write", async () => {
    const repo = new MemoryManifestRepository();
    const entries = pack(1, "Pack");
    await repo.putManifest(record(USER, "Pack", entries, "folder-p"));
    const writesBefore = repo.writeCount();
    const codes = [...Array.from({ length: 0x20 }, (_, i) => i), 0x7f];
    for (const cp of codes) {
      const name = `Pack${String.fromCodePoint(cp)}x`;
      const { statusCode, raw } = await check(repo, { folderName: name, entries });
      expect(statusCode, `code point 0x${cp.toString(16)} was accepted`).toBe(400);
      expect(raw).not.toContain("folder-p");
    }
    expect(repo.writeCount()).toBe(writesBefore);
  });

  it("the limit is BYTES not characters, at the exact 255/256 boundary", async () => {
    const repo = new MemoryManifestRepository();
    const entries = pack(1, "Pack");
    const cases: Array<[string, number]> = [
      ["a".repeat(255), 200],
      ["a".repeat(256), 400],
      // 2-byte: 127*2 + 1 = 255 bytes / 128*2 = 256 bytes
      [`${"é".repeat(127)}a`, 200],
      ["é".repeat(128), 400],
      // 3-byte: 85*3 = 255 bytes / 86*3 = 258 bytes
      ["中".repeat(85), 200],
      ["中".repeat(86), 400],
      // 4-byte astral (surrogate pairs): 63*4+3 = 255 / 64*4 = 256 bytes
      [`${"🎧".repeat(63)}abc`, 200],
      ["🎧".repeat(64), 400],
      // 255 CHARACTERS of a multi-byte code point must be REJECTED.
      ["ñ".repeat(255), 400],
      ["🎧".repeat(255), 400],
    ];
    for (const [name, expected] of cases) {
      const { statusCode } = await check(repo, { folderName: name, entries });
      expect(
        statusCode,
        `len=${name.length} bytes=${Buffer.byteLength(name, "utf8")}`,
      ).toBe(expected);
    }
    expect(repo.writeCount()).toBe(0);
  });

  it("surrogate pairs, lone surrogates and combining marks never throw", async () => {
    const repo = new MemoryManifestRepository();
    const entries = pack(1, "Pack");
    const names = ["🎧", "\ud800", "\udfff", "a\ud800b", "é", "́", "﻿A", "A​"];
    for (const folderName of names) {
      const res = await checkManifest({ repo })(event({ folderName, entries }));
      expect([200, 400]).toContain(res.statusCode);
      expect(() => JSON.parse(res.body)).not.toThrow();
    }
  });

  it("is byte-identical: no trim, no normalize, no case-fold, echoed back exactly", async () => {
    const nfd = "Café 🎧".normalize("NFD");
    const variants = [nfd, nfd.normalize("NFC"), ` ${nfd}`, `${nfd} `, nfd.toUpperCase(), `${nfd}​`];
    const entries: ManifestEntry[] = [{ relativePath: "a.wav", sizeBytes: 1, checksum: "aa" }];
    // All distinct as raw bytes, therefore all distinct identities.
    expect(new Set(variants).size).toBe(variants.length);
    const repo = new MemoryManifestRepository();
    for (const [i, v] of variants.entries()) {
      await repo.putManifest(record(USER, v, entries, `folder-${i}`));
    }
    for (const [i, v] of variants.entries()) {
      const { body } = await check(repo, { folderName: v, entries });
      expect(body.match).toBe("exact");
      expect(body.folderId).toBe(`folder-${i}`);
      // Byte-identical echo.
      expect(body.folderName).toBe(v);
      expect(Buffer.from(body.folderName, "utf8").toString("hex")).toBe(
        Buffer.from(v, "utf8").toString("hex"),
      );
    }
  });
});

// =========================================================================
// Typed event: hostile/malformed events.
// =========================================================================
describe("FIXVAL typed event: hostile inputs", () => {
  it("malformed events are rejected 400/401 and never throw", async () => {
    const repo = new MemoryManifestRepository();
    await repo.putManifest(record(USER, "Pack", pack(1, "Pack"), "folder-p"));
    const writesBefore = repo.writeCount();
    const handler = checkManifest({ repo });
    const hostile: unknown[] = [
      undefined,
      null,
      "",
      "not-an-event",
      42,
      [],
      {},
      { requestContext: null },
      { requestContext: { authorizer: { jwt: { claims: { sub: {} } } } } },
      { requestContext: { authorizer: { jwt: { claims: { sub: USER } } } } }, // no body
      { requestContext: { authorizer: { jwt: { claims: { sub: USER } } } }, body: "{" },
      { requestContext: { authorizer: { jwt: { claims: { sub: USER } } } }, body: "[]" },
      { requestContext: { authorizer: { jwt: { claims: { sub: USER } } } }, body: "null" },
      { requestContext: { authorizer: { jwt: { claims: { sub: USER } } } }, body: 42 },
      { requestContext: { authorizer: { jwt: { claims: { sub: USER } } } }, body: [] },
      { requestContext: { authorizer: { jwt: { claims: { sub: USER } } } }, headers: null, body: "{}" },
      { requestContext: { authorizer: { jwt: { claims: { sub: USER } } } }, headers: "x", body: "{}" },
    ];
    for (const [i, e] of hostile.entries()) {
      let res: { statusCode: number; body: string } | undefined;
      await expect(
        (async () => {
          res = await handler(rawEvent(e));
        })(),
      ).resolves.toBeUndefined();
      expect([400, 401], `hostile event #${i} -> ${res!.statusCode}`).toContain(res!.statusCode);
      expect(res!.body).not.toContain("folder-p");
      expect(() => JSON.parse(res!.body)).not.toThrow();
    }
    expect(repo.writeCount()).toBe(writesBefore);
  });

  it("an event with throwing property getters yields a JSON error, never an unhandled throw", async () => {
    const repo = new MemoryManifestRepository();
    const handler = checkManifest({ repo });
    const boom = () => {
      throw new Error("hostile getter: secret-value");
    };
    const events = [
      { get requestContext(): never { return boom(); } },
      { requestContext: { authorizer: { jwt: { claims: { sub: USER } } } }, get headers(): never { return boom(); } },
      { requestContext: { authorizer: { jwt: { claims: { sub: USER } } } }, headers: {}, get body(): never { return boom(); } },
    ];
    for (const e of events) {
      const res = await handler(rawEvent(e));
      expect(res.statusCode).toBeGreaterThanOrEqual(400);
      expect(res.body).not.toContain("secret-value");
      expect(() => JSON.parse(res.body)).not.toThrow();
    }
    expect(repo.writeCount()).toBe(0);
  });
});

// =========================================================================
// Rule 3 / Rule 9 regression: read-only on EVERY branch, no AWS SDK.
// =========================================================================
describe("FIXVAL read-only + Rule 3 regression", () => {
  it("no manifest src file imports the AWS SDK, S3, fetch or any network client", () => {
    for (const f of ["check-manifest.ts", "manifest-hash.ts", "memory-repository.ts", "repository.ts", "types.ts"]) {
      const text = readFileSync(join(SRC, f), "utf8");
      for (const forbidden of ["aws-sdk", "@aws-sdk", "S3Client", "PutObject", "GetObject", "fetch(", "node:http", "node:https", "DynamoDBClient"]) {
        expect(text.includes(forbidden), `${f} references ${forbidden}`).toBe(false);
      }
    }
  });

  it("every branch (exact, partial, ambiguous, none, 400, 401) writes nothing and mutates nothing", async () => {
    const repo = new MemoryManifestRepository();
    const mine = pack(6, "Shared");
    await repo.putManifest(record(USER, "Shared", mine, "folder-exact"));
    await repo.putManifest(record(USER, "Partial", mine.slice(0, 3), "folder-partial"));
    await repo.putManifest(record(USER, "Ambig", mine.slice(0, 3), "folder-am1"));
    await repo.putManifest(record(USER, "Ambig", mine.slice(2, 5), "folder-am2"));
    const writesBefore = repo.writeCount();
    const before = JSON.parse(JSON.stringify(repo.all()));

    const seen: string[] = [];
    seen.push((await check(repo, { folderName: "Shared", entries: mine })).body.match);
    seen.push((await check(repo, { folderName: "Partial", entries: mine })).body.match);
    seen.push((await check(repo, { folderName: "Ambig", entries: mine })).body.match);
    seen.push((await check(repo, { folderName: "Nothing", entries: mine })).body.match);
    await check(repo, { folderName: "", entries: mine }); // 400
    await check(repo, { folderName: "Shared", entries: mine }, null); // 401

    expect(seen).toEqual(["exact", "partial", "none", "none"]);
    expect(repo.writeCount()).toBe(writesBefore);
    expect(repo.all()).toHaveLength(4);
    expect(JSON.parse(JSON.stringify(repo.all()))).toEqual(before);
  });

  it("Rule 3: a full checksum match deletes, repoints, merges and dedupes NOTHING", async () => {
    const repo = new MemoryManifestRepository();
    const entries = pack(4, "Dup");
    // Two DIFFERENT folders whose contents are byte-identical.
    await repo.putManifest(record(USER, "Client A", entries, "folder-A"));
    await repo.putManifest(record(USER, "Client B", entries, "folder-B"));
    const before = JSON.parse(JSON.stringify(repo.all()));

    const a = await check(repo, { folderName: "Client A", entries });
    const b = await check(repo, { folderName: "Client B", entries });
    expect(a.body.folderId).toBe("folder-A");
    expect(b.body.folderId).toBe("folder-B");
    // Both still exist, unmerged and unmodified.
    expect(repo.all()).toHaveLength(2);
    expect(JSON.parse(JSON.stringify(repo.all()))).toEqual(before);
    expect(repo.all().map((r) => r.folderId).sort()).toEqual(["folder-A", "folder-B"]);
    expect(repo.writeCount()).toBe(2); // only the two test fixtures
  });
});
