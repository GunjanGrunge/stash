import type { DueFile, DueFolder, DueItem, FolderDescendant } from "./types.js";

/** Persistence operations for the scheduled retention worker. */
export interface RetentionRepository {
  /** All due candidates, not merely DynamoDB's first 1 MB page. */
  listDue(now: string): Promise<DueItem[]>;
  /** Atomically claims a recoverable record; false means it was restored/raced. */
  claim(item: DueItem): Promise<boolean>;
  /** Atomically removes claimed metadata and decrements the owning PROFILE quota. */
  finalize(file: DueFile): Promise<void>;
  /** Reads every direct child of a claimed folder root or descendant. */
  listFolderChildren(folder: DueFolder): Promise<FolderDescendant[]>;
  /**
   * Removes a safe batch from a claimed tree. `folders` must be leaves; the
   * root is removed only after every descendant is gone.
   */
  finalizeFolderBatch(root: DueFolder, files: DueFile[], folders: DueFolder[]): Promise<void>;
  /** Removes the claimed root and its identity after its tree is empty. */
  finalizeFolderRoot(root: DueFolder): Promise<void>;
}
