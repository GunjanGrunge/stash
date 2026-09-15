import { describe, it, expect } from "vitest";
import { manifestHash } from "../src/manifest-hash.js";
import type { ManifestEntry } from "../src/types.js";

const FOLDER = "Vol 4";
const A: ManifestEntry = { relativePath: "Vol 4/Kicks/x.wav", sizeBytes: 10, checksum: "aa" };
const B: ManifestEntry = { relativePath: "Vol 4/Snares/y.wav", sizeBytes: 20, checksum: "bb" };
const C: ManifestEntry = { relativePath: "Vol 4/Hats/z.wav", sizeBytes: 30, checksum: "cc" };

describe("manifestHash", () => {
  it("is a sha256 hex digest", () => {
    expect(manifestHash(FOLDER, [A])).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is order-independent: shuffled entries hash identically", () => {
    expect(manifestHash(FOLDER, [A, B, C])).toBe(manifestHash(FOLDER, [C, A, B]));
    expect(manifestHash(FOLDER, [A, B, C])).toBe(manifestHash(FOLDER, [B, C, A]));
  });

  it("is path-sensitive: same checksum in a different pack hashes differently", () => {
    const vol4: ManifestEntry = { relativePath: "Vol 4/Kicks/x.wav", sizeBytes: 10, checksum: "aa" };
    const vol5: ManifestEntry = { relativePath: "Vol 5/Kicks/x.wav", sizeBytes: 10, checksum: "aa" };
    // Rule 3: a checksum match is never an identity match.
    expect(manifestHash(FOLDER, [vol4])).not.toBe(manifestHash(FOLDER, [vol5]));
  });

  it("is size-sensitive", () => {
    expect(manifestHash(FOLDER, [A])).not.toBe(
      manifestHash(FOLDER, [{ ...A, sizeBytes: A.sizeBytes + 1 }]),
    );
  });

  it("is checksum-sensitive", () => {
    expect(manifestHash(FOLDER, [A])).not.toBe(manifestHash(FOLDER, [{ ...A, checksum: "ab" }]));
  });

  it("treats NFC and NFD paths as DIFFERENT (Rule 1: never normalize)", () => {
    const nfc = "Café/kick.wav".normalize("NFC");
    const nfd = "Café/kick.wav".normalize("NFD");
    expect(nfc).not.toBe(nfd);
    expect(manifestHash(FOLDER, [{ relativePath: nfc, sizeBytes: 1, checksum: "aa" }])).not.toBe(
      manifestHash(FOLDER, [{ relativePath: nfd, sizeBytes: 1, checksum: "aa" }]),
    );
  });

  it("does not confuse field boundaries between neighbouring entries", () => {
    const one = [{ relativePath: "a/b", sizeBytes: 1, checksum: "cc" }];
    const two = [{ relativePath: "a", sizeBytes: 1, checksum: "b/cc" as string }];
    expect(manifestHash(FOLDER, one)).not.toBe(manifestHash(FOLDER, two as ManifestEntry[]));
  });

  it("hashes a 1,850-entry manifest deterministically across repeated calls", () => {
    const entries: ManifestEntry[] = Array.from({ length: 1850 }, (_, i) => ({
      relativePath: `Sample Pack/Vol ${i % 7}/file-${i}.wav`,
      sizeBytes: 1000 + i,
      checksum: `sum-${i}`,
    }));
    const first = manifestHash(FOLDER, entries);
    const second = manifestHash(FOLDER, entries);
    const shuffled = [...entries].reverse();
    expect(second).toBe(first);
    expect(manifestHash(FOLDER, shuffled)).toBe(first);
  });

  it("F2-1: is folderName-sensitive — the SAME contents under a different name hash differently", () => {
    // Rule 3: a content fingerprint is not a folder identity. Two client
    // deliverable folders holding byte-identical files are DIFFERENT folders.
    expect(manifestHash("Client A Deliverables", [A, B])).not.toBe(
      manifestHash("Client B Deliverables", [A, B]),
    );
    expect(manifestHash(FOLDER, [A, B])).toBe(manifestHash(FOLDER, [B, A]));
  });

  it("F2-1: treats NFC, NFD, case and padding of the folderName as DIFFERENT (Rule 1)", () => {
    const nfc = "Café".normalize("NFC");
    const names = [nfc, nfc.normalize("NFD"), "CAFÉ", ` ${nfc}`, `${nfc} `, "Cafe"];
    const hashes = new Set(names.map((n) => manifestHash(n, [A])));
    expect(new Set(names).size).toBe(6);
    expect(hashes.size).toBe(6);
  });

  it("F2-1: a folderName cannot forge a field boundary (hex-framed like every other field)", () => {
    const forgeries: Array<[string, ManifestEntry[], string, ManifestEntry[]]> = [
      // A name carrying the entry separators / line break.
      ["a:1:62", [A], "a", [A]],
      ["a\n" + Buffer.from("a", "utf8").toString("hex") + ":1:62", [], "a", [A]],
      // A name that is the hex of another name.
      [Buffer.from("x", "utf8").toString("hex"), [A], "x", [A]],
      // A name shifted across the folder/entry boundary.
      ["folder:" + Buffer.from("x", "utf8").toString("hex"), [A], "x", [A]],
    ];
    for (const [ln, le, rn, re] of forgeries) {
      expect(manifestHash(ln, le)).not.toBe(manifestHash(rn, re));
    }
  });

  it("F2-1 ACCEPTED CONSEQUENCE: a RENAMED folder no longer hashes alike — intended, not a bug", () => {
    // The identical folder re-Stashed under a new name is a FALSE NEGATIVE:
    // it re-uploads and wastes bandwidth. That is the deliberate price of
    // never telling a creator they already have a folder they do not, which
    // costs them files. Documented here as intended behaviour.
    const before = manifestHash("Mixdowns", [A, B, C]);
    const afterRename = manifestHash("Mixdowns FINAL", [A, B, C]);
    expect(afterRename).not.toBe(before);
  });
});
