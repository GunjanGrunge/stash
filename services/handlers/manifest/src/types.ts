/**
 * One file as the client observed it on disk at ONE ingestion event.
 * `relativePath` is stored and compared byte-for-byte (Rule 1): never
 * normalized, case-folded or trimmed, so NFC and NFD stay DIFFERENT paths.
 */
export interface ManifestEntry {
  relativePath: string;
  sizeBytes: number;
  checksum: string;
}

/**
 * A Manifest describes a folder's contents at one ingestion event (Rule 2).
 * It is NOT a File and NOT a Folder and replaces neither — it exists only so
 * duplicate detection can answer before any payload byte is uploaded.
 */
export interface ManifestRecord {
  pk: string;
  sk: string;
  entity: "MANIFEST";
  manifestHash: string;
  folderId: string;
  folderName: string;
  fileCount: number;
  totalBytes: number;
  entries: ManifestEntry[];
}

/**
 * What the creator is told. `exact` drives "You already have this folder in
 * STASH"; `partial` drives "1,847 of 1,850 files already Stashed · 3 new
 * files". Reporting only — nothing is deleted, repointed, merged or deduped
 * (Rule 3).
 */
export type ManifestCheckResult =
  | {
      match: "exact";
      folderId: string;
      folderName: string;
      fileCount: number;
      totalBytes: number;
    }
  | {
      match: "partial";
      folderId: string;
      folderName: string;
      existingCount: number;
      newFiles: ManifestEntry[];
      newBytes: number;
    }
  | { match: "none" };
