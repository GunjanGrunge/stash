/**
 * ADVERSARIAL validation of the F1 claim.
 *
 * Claim under test: a folder tree registered through `registerFiles` and read
 * back through `listChildren` returns BYTE-IDENTICAL; nothing is renamed,
 * flattened, mis-parented, normalized or rewritten; S3 object keys are opaque
 * and leak no part of the creator's filename or path.
 *
 * These tests deliberately attack the cases the random property test cannot
 * reach: its generator uses a `taken` Set of exact strings, only picks from a
 * fixed 17-name pool, caps depth at 5 and width at 12, never registers the
 * same folder twice, never puts a file and a folder under the same name, and
 * never crosses a tenant boundary.
 */
import { describe, it, expect } from "vitest";
import { MemoryRepository } from "../src/memory-repository.js";
import { registerFiles } from "../src/register-files.js";
import { listChildren } from "../src/list-children.js";
import type { EntityRecord, FileRecord, FolderRecord } from "../src/types.js";

const hex = (s: string): string => Buffer.from(s, "utf8").toString("hex");

function evt(userId: string, extra: Record<string, unknown> = {}): any {
  return {
    requestContext: { authorizer: { jwt: { claims: { sub: userId } } } },
    headers: {},
    ...extra,
  };
}

async function register(
  repo: MemoryRepository,
  userId: string,
  paths: string[],
  stashId = "stash-adv",
): Promise<{ statusCode: number; body: any }> {
  const res = await registerFiles({ repo })(
    evt(userId, {
      body: JSON.stringify({
        stashId,
        files: paths.map((p, i) => ({
          relativePath: p,
          sizeBytes: i,
          checksum: `sum-${i}`,
        })),
      }),
    }),
  );
  return { statusCode: res.statusCode, body: JSON.parse(res.body) };
}

async function list(
  repo: MemoryRepository,
  userId: string,
  folderId?: string,
): Promise<EntityRecord[]> {
  const res = await listChildren({ repo })(
    evt(userId, {
      pathParameters: folderId === undefined ? undefined : { folderId },
    }),
  );
  expect(res.statusCode).toBe(200);
  // Go through the real serialized body: this is what the client actually sees.
  return JSON.parse(res.body).items as EntityRecord[];
}

/** The raw handler result, for the cases where the STATUS is the assertion. */
async function listRaw(
  repo: MemoryRepository,
  userId: string,
  folderId?: string,
): Promise<{ statusCode: number; body: any }> {
  const res = await listChildren({ repo })(
    evt(userId, {
      pathParameters: folderId === undefined ? undefined : { folderId },
    }),
  );
  return { statusCode: res.statusCode, body: JSON.parse(res.body) };
}

/** Recursively rebuild every file path the API would show the creator. */
async function reconstruct(repo: MemoryRepository, userId: string): Promise<string[]> {
  const out: string[] = [];
  const seenFolders = new Set<string>();
  const walk = async (folderId: string | undefined, prefix: string): Promise<void> => {
    for (const item of await list(repo, userId, folderId)) {
      const full = prefix === "" ? item.name : `${prefix}/${item.name}`;
      if (item.entity === "FILE") {
        out.push(full);
      } else {
        const fid = (item as FolderRecord).folderId;
        if (seenFolders.has(fid)) throw new Error(`folder ${fid} visited twice`);
        seenFolders.add(fid);
        await walk(fid, full);
      }
    }
  };
  await walk(undefined, "");
  return out;
}

async function expectRoundTrip(userId: string, paths: string[]): Promise<MemoryRepository> {
  const repo = new MemoryRepository();
  const reg = await register(repo, userId, paths);
  expect(reg.statusCode, `registration of ${JSON.stringify(paths)}`).toBe(201);
  const rebuilt = await reconstruct(repo, userId);
  expect(rebuilt.map(hex).sort()).toEqual(paths.map(hex).sort());
  expect(rebuilt.length).toBe(paths.length);
  return repo;
}

// ---------------------------------------------------------------------------
// 1. Unicode: forms that a careless normalize/trim/case-fold would MERGE.
// ---------------------------------------------------------------------------

describe("unicode siblings that only a normalizing layer would merge", () => {
  it("keeps NFC and NFD forms of the same visual name as distinct siblings", async () => {
    const nfc = "Cafe\u0301".normalize("NFC"); // Café, single code point
    const nfd = "Cafe\u0301"; // Café, e + combining acute
    expect(nfc).not.toBe(nfd);
    expect(nfc.normalize("NFD")).toBe(nfd.normalize("NFD"));

    const paths = [
      `Sessions/${nfc}/take.wav`,
      `Sessions/${nfd}/take.wav`,
      `Sessions/${nfc}.wav`,
      `Sessions/${nfd}.wav`,
    ];
    const repo = await expectRoundTrip("u-nfc-nfd", paths);

    const root = await list(repo, "u-nfc-nfd");
    const sessions = root.find((i) => i.name === "Sessions") as FolderRecord;
    const kids = await list(repo, "u-nfc-nfd", sessions.folderId);
    // Two folders + two files, all four byte-distinct. A merge would lose a file.
    expect(kids.length).toBe(4);
    const names = new Set(kids.map((k) => hex(k.name)));
    expect(names.size).toBe(4);
    expect(names.has(hex(nfc))).toBe(true);
    expect(names.has(hex(nfd))).toBe(true);
  });

  it("keeps case-folding traps (Turkish i, eszett, Kelvin sign) distinct", async () => {
    const paths = [
      "fold/I.wav",
      "fold/i.wav",
      "fold/\u0130.wav", // İ  dotted capital I
      "fold/\u0131.wav", // ı  dotless i
      "fold/STRASSE.wav",
      "fold/strasse.wav",
      "fold/stra\u00DFe.wav", // straße
      "fold/\u212A.wav", // KELVIN SIGN, NFKC-folds to K
      "fold/K.wav",
      "fold/\uFB01x.wav", // ﬁ ligature, NFKC-folds to "fi"
      "fold/fix.wav",
    ];
    const repo = await expectRoundTrip("u-casefold", paths);
    const root = await list(repo, "u-casefold");
    const fold = root.find((i) => i.entity === "FOLDER") as FolderRecord;
    const kids = await list(repo, "u-casefold", fold.folderId);
    expect(kids.length).toBe(paths.length);
    expect(new Set(kids.map((k) => hex(k.name))).size).toBe(paths.length);
  });

  it("preserves zero-width joiners, RTL overrides, astral emoji and lone surrogates", async () => {
    const zwj = "\u{1F469}\u200D\u{1F4BB}"; // woman technologist (ZWJ sequence)
    const parts = "\u{1F469}\u{1F4BB}"; // same code points WITHOUT the joiner
    const names = [
      zwj,
      parts,
      "a\u200Bb", // zero width space
      "a\u200Cb", // ZWNJ
      "ab", // the same visually-adjacent pair with nothing between
      "\u202Emp3.evil", // RTL override
      "\u202Dmp3.evil", // LTR override
      "\uFEFFbom-lead", // leading BOM
      "\u{1F3B9}\u{1F525}\u{10FFFF}", // astral plane, top of range
      "\uD83D", // LONE high surrogate
      "\uDC69", // LONE low surrogate
      "n\u0303\u0303\u0303", // stacked combining tildes
    ];
    const paths = names.map((n, i) => `zw/${n}#${i}.bin`);
    const repo = await expectRoundTrip("u-zw", paths);

    const root = await list(repo, "u-zw");
    const zw = root.find((i) => i.entity === "FOLDER") as FolderRecord;
    const kids = await list(repo, "u-zw", zw.folderId);
    expect(kids.length).toBe(names.length);
    for (let i = 0; i < names.length; i++) {
      const want = `${names[i]}#${i}.bin`;
      const got = kids.find((k) => k.name === want);
      expect(got, `name ${i} survived JSON round-trip`).toBeDefined();
      expect(hex(got!.name)).toBe(hex(want));
    }
  });
});

// ---------------------------------------------------------------------------
// 2. Structural traps: key-scheme lookalikes, ROOT, dots, spaces.
// ---------------------------------------------------------------------------

describe("structural traps", () => {
  it("keeps a file and a folder with the SAME name in the same parent", async () => {
    const repo = await expectRoundTrip("u-fileVsFolder", [
      "Mix",
      "Mix/inner.wav",
      "deep/Take",
      "deep/Take/1.wav",
    ]);
    const root = await list(repo, "u-fileVsFolder");
    const mixes = root.filter((i) => i.name === "Mix");
    expect(mixes.length).toBe(2);
    expect(new Set(mixes.map((m) => m.entity))).toEqual(new Set(["FILE", "FOLDER"]));
  });

  it("treats a folder literally named ROOT as an ordinary folder, not the root", async () => {
    const repo = await expectRoundTrip("u-root", [
      "ROOT/a.wav",
      "ROOT/ROOT/b.wav",
      "top.wav",
    ]);
    const root = await list(repo, "u-root");
    const rootFolder = root.find((i) => i.entity === "FOLDER") as FolderRecord;
    expect(rootFolder.name).toBe("ROOT");
    // Its id must NOT be the sentinel string, or listing it would return the
    // real root and mis-parent the whole tree.
    expect(rootFolder.folderId).not.toBe("ROOT");
    const kids = await list(repo, "u-root", rootFolder.folderId);
    expect(kids.map((k) => k.name).sort()).toEqual(["ROOT", "a.wav"]);
    // The real root still contains top.wav, not ROOT's children.
    expect(root.map((r) => r.name).sort()).toEqual(["ROOT", "top.wav"]);
  });

  it("preserves names that are only spaces, only dots, or have trailing space/dot", async () => {
    const names = [
      " ",
      "   ",
      "...",
      "....",
      " leading.wav",
      "trailing.wav ",
      "trailing.dot.",
      "\t-ish\u00A0nbsp", // non-breaking space (not a control char)
      "-",
      "~",
    ].filter((n) => !/[\u0000-\u001f\u007f]/.test(n));
    const paths = names.map((n) => `dots/${n}`);
    const repo = await expectRoundTrip("u-dots", paths);
    const root = await list(repo, "u-dots");
    const f = root.find((i) => i.entity === "FOLDER") as FolderRecord;
    const kids = await list(repo, "u-dots", f.folderId);
    expect(kids.map((k) => hex(k.name)).sort()).toEqual(names.map(hex).sort());
  });

  it("does not let key-scheme lookalike segments collide with the DynamoDB key model", async () => {
    const hostile = [
      "USER#u-keys",
      "FILE#abc",
      "FOLDER#abc",
      "PARENT#ROOT",
      "USER#u-keys#PARENT#ROOT",
      "#",
      "##",
      "SUM#deadbeef",
      "STASH#stash-adv",
    ];
    const paths = hostile.map((n) => `${n}/inside.wav`).concat(hostile.map((n) => `${n}.wav`));
    const repo = await expectRoundTrip("u-keys", paths);

    const root = await list(repo, "u-keys");
    expect(root.length).toBe(hostile.length * 2);
    // Every folder is addressed by an opaque uuid, never by its name.
    for (const item of root) {
      if (item.entity !== "FOLDER") continue;
      expect(item.folderId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
      expect(item.sk).toBe(`FOLDER#${item.folderId}`);
    }
  });

  it("rejects the whole batch and writes nothing when one path is hostile", async () => {
    for (const bad of [
      "../escape.wav",
      "/abs.wav",
      "C:\\win.wav",
      "back\\slash.wav",
      "a//b.wav",
      "a/./b.wav",
      "nul\u0000.wav",
      "bell\u0007.wav",
      "trail/",
      "",
      "x".repeat(256) + "/a.wav",
      "y".repeat(1025),
    ]) {
      const repo = new MemoryRepository();
      const res = await register(repo, "u-atomic", ["good/one.wav", bad, "good/two.wav"]);
      expect(res.statusCode, `path ${JSON.stringify(bad)} must be rejected`).toBe(400);
      expect(repo.all(), `nothing written for ${JSON.stringify(bad)}`).toEqual([]);
    }
  });
});

// ---------------------------------------------------------------------------
// 3. Ordering, width, depth, length.
// ---------------------------------------------------------------------------

describe("ordering, width, depth and length", () => {
  it("never drops or duplicates a sibling among 500 children, incl. names differing past char 200", async () => {
    const names: string[] = [];
    for (let i = 0; i < 400; i++) names.push(`f${String(i).padStart(4, "0")}.wav`);
    // 40 names identical for the first 200 chars.
    for (let i = 0; i < 40; i++) names.push("p".repeat(200) + String(i).padStart(3, "0") + ".w");
    // 60 names that differ only by byte-order vs locale-order sensitive chars.
    const locale = ["a", "A", "z", "Z", "ä", "Ä", "å", "é", "ñ", "ö", "_", "-", "~", "0", "9"];
    for (let i = 0; i < locale.length; i++) {
      names.push(`${locale[i]}sort.wav`);
      names.push(`sort${locale[i]}.wav`);
      names.push(`${locale[i]}${locale[i]}.wav`);
      names.push(`x${locale[i]}x.wav`);
    }
    expect(new Set(names).size).toBe(names.length);
    expect(names.length).toBe(500);

    const repo = new MemoryRepository();
    const reg = await register(repo, "u-wide", names.map((n) => `wide/${n}`));
    expect(reg.statusCode).toBe(201);

    const root = await list(repo, "u-wide");
    expect(root.length).toBe(1);
    const kids = await list(repo, "u-wide", (root[0] as FolderRecord).folderId);
    expect(kids.length).toBe(names.length);
    expect(kids.map((k) => hex(k.name)).sort()).toEqual(names.map(hex).sort());
    // No duplicate ids either.
    expect(new Set(kids.map((k) => (k as FileRecord).fileId)).size).toBe(names.length);
    // The documented ordering is byte order of the utf8 name.
    for (let i = 1; i < kids.length; i++) {
      expect(
        Buffer.compare(Buffer.from(kids[i - 1]!.name, "utf8"), Buffer.from(kids[i]!.name, "utf8")),
        `pair ${i} must be in utf8 byte order`,
      ).toBeLessThanOrEqual(0);
    }
  });

  it("round-trips a 40-level deep tree", async () => {
    const segs: string[] = [];
    for (let i = 0; i < 40; i++) segs.push(`lvl${i}`);
    const paths = segs.map((_, i) => `${segs.slice(0, i + 1).join("/")}/leaf${i}.wav`);
    const deepest = `${segs.join("/")}/bottom.wav`;
    paths.push(deepest);
    const repo = await expectRoundTrip("u-deep", paths);
    const files = repo.all().filter((i) => i.entity === "FILE") as FileRecord[];
    expect(files.find((f) => f.originalRelativePath === deepest)).toBeDefined();
    // Exactly 40 folders: no duplication down the chain.
    expect(repo.all().filter((i) => i.entity === "FOLDER").length).toBe(40);
  });

  it("round-trips a path of exactly 1024 bytes and segments of exactly 255 bytes", async () => {
    const dirs = Array.from({ length: 9 }, (_, i) => String.fromCharCode(97 + i).repeat(100));
    const prefix = dirs.join("/"); // 9*100 + 8 = 908
    expect(prefix.length).toBe(908);
    const leaf = "z".repeat(1024 - 908 - 1);
    const maxPath = `${prefix}/${leaf}`;
    expect(Buffer.byteLength(maxPath, "utf8")).toBe(1024);

    const seg255 = "\u00E9".repeat(127) + "x"; // 127*2 + 1 = 255 bytes
    expect(Buffer.byteLength(seg255, "utf8")).toBe(255);
    const multi = `${seg255}/${seg255}/f.wav`;

    const repo = await expectRoundTrip("u-long", [maxPath, multi]);
    const files = repo.all().filter((i) => i.entity === "FILE") as FileRecord[];
    expect(files.map((f) => hex(f.originalRelativePath)).sort()).toEqual(
      [maxPath, multi].map(hex).sort(),
    );
  });
});

// ---------------------------------------------------------------------------
// 4. Key opacity (Rule 6).
// ---------------------------------------------------------------------------

describe("S3 object key opacity", () => {
  it("never leaks any path fragment, extension or extra segment into objectKey", async () => {
    const userId = "u-opaque";
    const hostile = [
      "users/leak.wav", // mimics the key prefix itself
      "users",
      "secret-client-name/Q3 revenue.xlsx",
      "a/b/c/d/e/f/g/h.wav",
      "\u{1F3B9}emoji.wav",
      "..dotdot.wav",
      "USER#u-opaque/FILE#1.wav",
    ];
    const repo = new MemoryRepository();
    expect((await register(repo, userId, hostile)).statusCode).toBe(201);

    for (const f of repo.all().filter((i) => i.entity === "FILE") as FileRecord[]) {
      expect(f.objectKey).toBe(`users/${userId}/${f.fileId}`);
      const segs = f.objectKey.split("/");
      expect(segs.length, "key must be exactly 3 segments").toBe(3);
      expect(segs[0]).toBe("users");
      expect(segs[1]).toBe(userId);
      expect(segs[2]).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
      // No fragment of the creator's path appears after the opaque prefix.
      const tail = f.objectKey.slice(`users/${userId}/`.length);
      expect(tail).toBe(f.fileId);
      for (const seg of f.originalRelativePath.split("/")) {
        if (seg === "users" || seg === userId) continue; // structural prefix, not a leak
        // Segments of 1-2 chars can occur inside a hex uuid by pure chance, so
        // only distinctive segments are evidence of a leak.
        if (seg.length < 3) continue;
        expect(tail).not.toContain(seg);
      }
      expect(f.objectKey).not.toContain(".wav");
      expect(f.objectKey).not.toContain("#");
    }
  });

  it("rejects, rather than embeds, a non-opaque subject claim", async () => {
    for (const sub of ["../other", "a/b", "u#1", "u p", "..", "user\u0000"]) {
      const repo = new MemoryRepository();
      const res = await register(repo, sub, ["a/b.wav"]);
      expect(res.statusCode, `sub ${JSON.stringify(sub)}`).toBe(400);
      expect(repo.all()).toEqual([]);
    }
  });
});

// ---------------------------------------------------------------------------
// 5. Tenancy (Rule 7).
// ---------------------------------------------------------------------------

describe("tenancy", () => {
  it("cannot reach another creator's folder by guessing its folderId", async () => {
    const repo = new MemoryRepository();
    expect((await register(repo, "victim", ["Private/secret.wav"])).statusCode).toBe(201);
    expect((await register(repo, "attacker", ["Mine/ok.wav"])).statusCode).toBe(201);

    const victimFolder = repo
      .all()
      .find((i) => i.entity === "FOLDER" && i.pk === "USER#victim") as FolderRecord;

    // A resource belonging to another creator must 404, not 200 with an empty
    // list: an empty 200 is distinguishable from a real empty folder by a
    // probing client and so discloses existence.
    const stolen = await listRaw(repo, "attacker", victimFolder.folderId);
    expect(stolen.statusCode).toBe(404);
    expect(stolen.body.code).toBe("not_found");
    expect(JSON.stringify(stolen.body)).not.toContain("Private");
    expect(JSON.stringify(stolen.body)).not.toContain("secret");

    const attackerRoot = await list(repo, "attacker");
    expect(attackerRoot.map((i) => i.name)).toEqual(["Mine"]);
  });

  it("ignores crafted parentFolderId path parameters", async () => {
    const repo = new MemoryRepository();
    expect((await register(repo, "victim", ["Private/secret.wav"])).statusCode).toBe(201);
    expect((await register(repo, "attacker", ["Mine/ok.wav"])).statusCode).toBe(201);

    // "ROOT" and "" mean the caller's own top level: 200, own items only.
    for (const crafted of ["ROOT", ""]) {
      const res = await listRaw(repo, "attacker", crafted);
      expect(res.statusCode, `crafted=${crafted}`).toBe(200);
      for (const item of res.body.items as EntityRecord[]) {
        expect(item.pk, `crafted=${crafted} must stay in the attacker's partition`).toBe(
          "USER#attacker",
        );
      }
    }
    // Anything else names a folder that does not exist FOR THIS CALLER: 404.
    for (const crafted of [
      "../victim",
      "USER#victim#PARENT#ROOT",
      "victim",
      "ROOT#PARENT#ROOT",
    ]) {
      const res = await listRaw(repo, "attacker", crafted);
      expect(res.statusCode, `crafted=${crafted} must not be answerable`).toBe(404);
      expect(JSON.stringify(res.body)).not.toContain("victim");
    }

    // And a body-supplied user_id must not steer the write.
    const res = await registerFiles({ repo })(
      evt("attacker", {
        pathParameters: { folderId: "ROOT" },
        body: JSON.stringify({
          stashId: "s",
          user_id: "victim",
          userId: "victim",
          files: [{ relativePath: "Injected/x.wav", sizeBytes: 1, checksum: "c" }],
        }),
      }),
    );
    expect(res.statusCode).toBe(201);
    expect(repo.all().every((i) => i.pk === "USER#victim" || i.pk === "USER#attacker")).toBe(true);
    const victimRoot = await list(repo, "victim");
    expect(victimRoot.map((i) => i.name)).toEqual(["Private"]);
  });
});

// ---------------------------------------------------------------------------
// 6. Repeat registration — the incremental-upload case the property test
//    never exercises (it uses one fresh repo + one call per case).
// ---------------------------------------------------------------------------

describe("repeat registration into an existing folder", () => {
  it("adds a second file to the SAME folder instead of forking the folder", async () => {
    const repo = new MemoryRepository();
    expect((await register(repo, "u-inc", ["Beats/a.wav"], "stash-1")).statusCode).toBe(201);
    expect((await register(repo, "u-inc", ["Beats/b.wav"], "stash-2")).statusCode).toBe(201);

    const root = await list(repo, "u-inc");
    const beats = root.filter((i) => i.name === "Beats");
    expect(
      beats.length,
      "the creator has ONE folder named Beats; a second folder record splits their library in two",
    ).toBe(1);

    const kids = await list(repo, "u-inc", (beats[0] as FolderRecord).folderId);
    expect(kids.map((k) => k.name).sort()).toEqual(["a.wav", "b.wav"]);
  });

  it("does not duplicate a deep chain when a sibling branch is added later", async () => {
    const repo = new MemoryRepository();
    expect((await register(repo, "u-inc2", ["A/B/C/one.wav"], "s1")).statusCode).toBe(201);
    expect((await register(repo, "u-inc2", ["A/B/D/two.wav"], "s2")).statusCode).toBe(201);

    const folders = repo.all().filter((i) => i.entity === "FOLDER") as FolderRecord[];
    expect(
      folders.filter((f) => f.relativePath === "A").length,
      "folder A must exist exactly once",
    ).toBe(1);
    expect(folders.filter((f) => f.relativePath === "A/B").length).toBe(1);

    expect(await reconstruct(repo, "u-inc2")).toEqual(
      expect.arrayContaining(["A/B/C/one.wav", "A/B/D/two.wav"]),
    );
  });

  // DECISION (supersedes this test's original expectation that both files are
  // created): two identical relativePath values inside ONE batch now reject
  // the whole batch with 400 and write nothing. A real filesystem cannot hold
  // two `x.wav` in one folder, so accepting the input would materialize a
  // structure that is not the creator's — a Rule 1 violation. The comparison
  // is on raw UTF-8 bytes and uses no content information, so Rule 3 ("a
  // checksum match is never an identity match") is untouched.
  it("rejects the whole batch with 400 when one batch repeats a relativePath", async () => {
    const repo = new MemoryRepository();
    const res = await register(repo, "u-dup", ["D/x.wav", "D/x.wav"]);
    expect(res.statusCode).toBe(400);
    expect(repo.all(), "a rejected batch must write NOTHING").toHaveLength(0);
  });

  it("still accepts byte-different sibling names that only normalization would merge", async () => {
    const repo = new MemoryRepository();
    const nfc = "Cafe\u0301".normalize("NFC");
    const nfd = "Cafe\u0301";
    const res = await register(repo, "u-dup-nfd", [`D/${nfc}.wav`, `D/${nfd}.wav`]);
    expect(res.statusCode, "NFC and NFD are DIFFERENT paths, not duplicates").toBe(201);
    const folders = repo.all().filter((i) => i.entity === "FOLDER");
    expect(folders.length).toBe(1);
    const kids = await list(repo, "u-dup-nfd", (folders[0] as FolderRecord).folderId);
    expect(kids.map((k) => hex(k.name)).sort()).toEqual(
      [hex(`${nfc}.wav`), hex(`${nfd}.wav`)].sort(),
    );
  });
});
