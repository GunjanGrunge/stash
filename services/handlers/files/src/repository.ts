import type { EntityRecord, FileRecord, FolderRecord } from "./types.js";

/** A previously-returned handler outcome, replayed verbatim on retry. */
export interface IdempotentResult {
  statusCode: number;
  body: string;
}

/**
 * The narrow persistence port the file handlers depend on. Implemented in
 * memory for tests and (later) by DynamoDB in production.
 */
export interface Repository {
  /**
   * Writes a batch. Implementations MUST refuse to create a second FOLDER
   * with the same (pk, parentFolderId, name) — folder identity is stable per
   * creator/parent/name, and a blind write would fork a creator's library.
   * The batch is all-or-nothing.
   */
  putEntities(items: EntityRecord[]): Promise<void>;

  listChildren(
    userId: string,
    parentFolderId: string | null,
  ): Promise<EntityRecord[]>;

  /**
   * Resolves an EXISTING folder by its stable identity. Identity comes from
   * lookup, never from hashing the path: a rename must stay a metadata write,
   * so descendants keep pointing at the same folderId.
   */
  findFolder(
    userId: string,
    parentFolderId: string | null,
    name: string,
  ): Promise<FolderRecord | undefined>;

  /** Existence check for a folder owned by this caller (cross-tenant → undefined). */
  findFolderById(userId: string, folderId: string): Promise<FolderRecord | undefined>;

  /** A caller-scoped FILE lookup. A foreign id is indistinguishable from absent. */
  findFile(userId: string, fileId: string): Promise<FileRecord | undefined>;

  /** Atomically moves a committed caller-owned file to Trash. */
  trashFile(
    userId: string,
    fileId: string,
    deletedAt: string,
    purgeAfter: string,
  ): Promise<FileRecord | undefined>;

  /** Lists only this caller's recoverable Trash records. */
  listTrash(userId: string): Promise<FileRecord[]>;

  /** Atomically restores a caller-owned recoverable Trash record. */
  restoreFile(userId: string, fileId: string): Promise<FileRecord | undefined>;

  /** Replay support: the stored outcome of a previous (user, stash, key) call. */
  getIdempotentResult(
    userId: string,
    stashId: string,
    key: string,
  ): Promise<IdempotentResult | undefined>;

  putIdempotentResult(
    userId: string,
    stashId: string,
    key: string,
    result: IdempotentResult,
  ): Promise<void>;
}
