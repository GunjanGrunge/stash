/**
 * THE PROOF OF F1.
 *
 * A folder tree registered through `registerFiles` and read back by walking
 * `listChildren` recursively from ROOT must return BYTE-IDENTICAL paths.
 * No renaming, flattening, re-ordering of segments, or unicode normalization
 * (Rule 1). S3 keys stay opaque (Rule 6).
 */
import { describe, it, expect } from "vitest";
import { MemoryRepository } from "../src/memory-repository.js";
import { registerFiles } from "../src/register-files.js";
import { listChildren } from "../src/list-children.js";
import type { FileRecord, FolderRecord } from "../src/types.js";

const CASES = 200;
const MAX_PATH_BYTES = 1024;
const SAFE_PATH_BYTES = 900;

/** Deterministic PRNG so a failure is reproducible from the seed alone. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const NAME_POOL: string[] = [
  "Kicks",
  "snare_01",
  "take-2",
  "My Folder Name",
  "two  spaces",
  "rock #1",
  "drums & bass",
  "don't stop",
  "it's #3 & final",
  "你好",
  "音楽フォルダ",
  "샘플",
  "\u{1F3B9}\u{1F525}",
  "mix \u{1F3A7} v2",
  "Café",           // NFD
  "Café",            // NFC
  "a".repeat(200),        // 200-char name
];

const EXT_POOL = [".wav", ".aiff", ".mp3", " final.wav", "\u{1F3B5}.wav", ".音"];

function bytes(s: string): number {
  return Buffer.byteLength(s, "utf8");
}

interface Node {
  name: string;
  files: string[];
  children: Node[];
}

function generateTree(rnd: () => number): { paths: string[] } {
  const depth = 1 + Math.floor(rnd() * 5); // 1..5
  const paths: string[] = [];

  const pick = <T,>(pool: T[]): T => pool[Math.floor(rnd() * pool.length)]!;

  const uniqueName = (taken: Set<string>, prefix: string, suffix: string): string => {
    let base = pick(NAME_POOL) + suffix;
    if (bytes(prefix) + 1 + bytes(base) > SAFE_PATH_BYTES) base = "s" + suffix;
    let name = base;
    let n = 1;
    while (taken.has(name)) {
      const candidate = `${base}~${n++}`;
      name = bytes(prefix) + 1 + bytes(candidate) > SAFE_PATH_BYTES ? `s${n}${suffix}` : candidate;
    }
    taken.add(name);
    return name;
  };

  const build = (prefix: string, level: number): void => {
    const taken = new Set<string>();

    const fileCount = 1 + Math.floor(rnd() * 12); // 1..12
    for (let i = 0; i < fileCount; i++) {
      const name = uniqueName(taken, prefix, pick(EXT_POOL));
      const full = prefix === "" ? name : `${prefix}/${name}`;
      if (bytes(full) <= MAX_PATH_BYTES) paths.push(full);
    }

    if (level >= depth) return;
    const childCount = 1 + Math.floor(rnd() * 2); // 1..2 subfolders
    for (let i = 0; i < childCount; i++) {
      const name = uniqueName(taken, prefix, "");
      const full = prefix === "" ? name : `${prefix}/${name}`;
      if (bytes(full) + 8 > SAFE_PATH_BYTES) continue;
      build(full, level + 1);
    }
  };

  build("", 1);
  return { paths };
}

async function reconstruct(
  repo: MemoryRepository,
  userId: string,
): Promise<string[]> {
  const handler = listChildren({ repo });
  const out: string[] = [];

  const walk = async (folderId: string | undefined, prefix: string): Promise<void> => {
    const res = await handler({
      requestContext: { authorizer: { jwt: { claims: { sub: userId } } } },
      headers: {},
      pathParameters: folderId === undefined ? undefined : { folderId },
    } as any);
    expect(res.statusCode).toBe(200);
    const items = JSON.parse(res.body).items as Array<FolderRecord | FileRecord>;
    for (const item of items) {
      const full = prefix === "" ? item.name : `${prefix}/${item.name}`;
      if (item.entity === "FILE") out.push(full);
      else await walk((item as FolderRecord).folderId, full);
    }
  };

  await walk(undefined, "");
  return out;
}

const hex = (s: string): string => Buffer.from(s, "utf8").toString("hex");

describe("hierarchy round-trip property", () => {
  it(`round-trips >= ${CASES} random folder trees byte-identically`, async () => {
    let generated = 0;
    let totalFiles = 0;
    let maxDepth = 0;

    for (let c = 0; c < CASES; c++) {
      const rnd = mulberry32(0x5745 + c * 7919);
      const { paths } = generateTree(rnd);
      generated++;
      totalFiles += paths.length;
      maxDepth = Math.max(maxDepth, ...paths.map((p) => p.split("/").length));

      const userId = `user-prop-${c}`;
      const repo = new MemoryRepository();
      const res = await registerFiles({ repo })({
        requestContext: { authorizer: { jwt: { claims: { sub: userId } } } },
        headers: {},
        body: JSON.stringify({
          stashId: `stash-${c}`,
          files: paths.map((p, i) => ({
            relativePath: p,
            sizeBytes: i + 1,
            checksum: "sum",
          })),
        }),
      } as any);
      expect(res.statusCode, `case ${c} registration`).toBe(201);

      const rebuilt = await reconstruct(repo, userId);

      const expected = paths.map(hex).sort();
      const actual = rebuilt.map(hex).sort();
      expect(actual, `case ${c} byte-identical round trip`).toEqual(expected);

      // Rule 6: keys stay opaque and carry no part of the path.
      for (const item of repo.all()) {
        if (item.entity !== "FILE") continue;
        expect(item.objectKey).toBe(`users/${userId}/${item.fileId}`);
        expect(item.objectKey).not.toContain(item.name);
      }
    }

    expect(generated).toBeGreaterThanOrEqual(200);
    expect(totalFiles).toBeGreaterThan(generated);
    console.log(
      `[hierarchy-property] generated cases=${generated} files=${totalFiles} maxPathDepth=${maxDepth}`,
    );
  }, 120_000);
});
