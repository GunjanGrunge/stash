/**
 * Entity shapes for the STASH single-table model.
 *
 * Rule 2: File, Folder and Stash are three DIFFERENT concepts. A FolderRecord
 * is the creator's own hierarchy; a FileRecord is one asset inside it; the
 * stashId on a file names the ingestion event only and never replaces folders.
 */

export interface RegisterFileInput {
  relativePath: string;
  sizeBytes: number;
  checksum: string;
}

export interface FolderRecord {
  pk: string;
  sk: string;
  entity: "FOLDER";
  folderId: string;
  name: string;
  parentFolderId: string | null;
  /** The folder's own full path prefix, byte-identical to the input slice. */
  relativePath: string;
  gsi1pk: string;
  gsi1sk: string;
}

export interface FileRecord {
  pk: string;
  sk: string;
  entity: "FILE";
  fileId: string;
  stashId: string;
  name: string;
  parentFolderId: string;
  /** Stable selected-root folder for this ingestion event. */
  rootFolderId?: string;
  /** Rule 1: stored verbatim. Never normalized, trimmed or rewritten. */
  originalRelativePath: string;
  sizeBytes: number;
  checksum: string;
  /** Rule 6: `users/<user_id>/<file_id>` — opaque ids only. */
  objectKey: string;
  state: "pending" | "uploading" | "committed" | "failed" | "trashed" | "purging";
  /** Set only while the file is recoverable in Trash. ISO-8601 UTC. */
  deletedAt?: string;
  /** Earliest instant the retention worker may permanently purge this file. */
  purgeAfter?: string;
  /** Reserved for the later search scope — always [] here. */
  searchTokens: string[];
  /** Reserved for the later extraction scope — always {} here. */
  extractedMetadata: Record<string, unknown>;
  /** Sparse while the record is in Trash or being permanently purged. */
  gsi1pk?: string;
  gsi1sk?: string;
  gsi2pk: string;
  gsi2sk: string;
  /** Rule 3: DETECTION only. A checksum match is never an identity match. */
  gsi3pk: string;
  /**
   * DynamoDB projects an item into a GSI only when BOTH key attributes are
   * present. gsi3 is declared with a partition AND a sort key, so a FileRecord
   * without `gsi3sk` would never appear in the checksum index at all. Many
   * files legitimately share one checksum, so the sort key is the fileId.
   */
  gsi3sk: string;
  /** Sparse per-creator Trash listing index; absent outside Trash. */
  gsi4pk?: string;
  gsi4sk?: string;
  /** Sparse global retention-work queue; absent outside Trash. */
  gsi5pk?: string;
  gsi5sk?: string;
}

export type EntityRecord = FolderRecord | FileRecord;
