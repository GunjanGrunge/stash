import { createHash } from "node:crypto";
import type { ManifestEntry } from "./types.js";

/** Hex of the RAW UTF-8 bytes — no normalization, case-folding or trimming. */
function hex(value: string): string {
  return Buffer.from(value, "utf8").toString("hex");
}

/**
 * Encodes one entry unambiguously. Path and checksum are hex-encoded from
 * their RAW UTF-8 bytes — no normalization, case-folding or trimming
 * (Rule 1), so NFC and NFD produce different encodings. Hex encoding also
 * makes the field boundaries unambiguous: no path or checksum content can
 * ever impersonate the separator, so `("a/b", "cc")` and `("a", "b/cc")`
 * cannot collide.
 */
function encodeEntry(entry: ManifestEntry): string {
  return [hex(entry.relativePath), String(entry.sizeBytes), hex(entry.checksum)].join(
    ":",
  );
}

/**
 * sha256 hex over the canonical form of a folder's IDENTITY: its name plus
 * its contents.
 *
 * `folderName` is part of the digest (hex-framed from raw UTF-8 bytes, so it
 * can no more forge a field boundary than a path can) because the digest is
 * used as a folder identity by `findByHash`. Contents alone are a content
 * fingerprint, and a checksum match is NEVER an identity match (Rule 3):
 * without the name, two genuinely different folders holding byte-identical
 * files (a template pack copied per client) would resolve to one another and
 * the creator would be told they already have a folder they have never
 * Stashed — a false positive that can cost them the files.
 *
 * ACCEPTED CONSEQUENCE: the same folder re-Stashed under a RENAMED name no
 * longer hashes alike, so it is reported `none` and re-uploads. That false
 * negative costs bandwidth; the false positive it prevents costs data. The
 * trade is deliberate.
 *
 * Order-independent: the encoded entry lines are sorted, so the same entries
 * shuffled hash identically (a client walking a directory gives no stable
 * order). The folder line is NOT sorted with them — it is always first.
 * Path-sensitive: the path is part of every line, so `Vol 4/Kicks/x.wav` and
 * `Vol 5/Kicks/x.wav` with the SAME checksum hash differently.
 */
export function manifestHash(folderName: string, entries: ManifestEntry[]): string {
  const hash = createHash("sha256");
  // Always first, and tagged, so no entry line can ever occupy this slot.
  hash.update(`folder:${hex(folderName)}`, "utf8");
  hash.update("\n", "utf8");
  for (const line of entries.map(encodeEntry).sort()) {
    hash.update(line, "utf8");
    hash.update("\n", "utf8");
  }
  return hash.digest("hex");
}
