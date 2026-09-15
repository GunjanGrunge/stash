/**
 * Entity shapes for the Stash side of the STASH single-table model.
 *
 * Rule 2: File, Folder and Stash are three DIFFERENT concepts. A StashRecord
 * describes ONE ingestion event — its reservation, its counts, its lifecycle.
 * It never describes, replaces or owns the creator's folder hierarchy.
 */

/**
 * Spec §3.2: `open | completed | cancelled`. Only a `committed` FILE counts as
 * Stashed; a Stash's own state says nothing about any individual file.
 */
export type StashState = "open" | "completed" | "cancelled";

export interface StashRecord {
  pk: string;
  sk: string;
  entity: "STASH";
  stashId: string;
  state: StashState;
  /** Files the client's manifest declared when the Stash was opened. */
  fileCount: number;
  /** Files actually verified `committed`, filled in by completeStash. */
  committedCount: number;
  /** Bytes reserved against the profile quota when the Stash opened. */
  reservedBytes: number;
  /** Bytes actually verified `committed`. */
  committedBytes: number;
  startedAt: string;
  updatedAt: string;
}

/**
 * The quota half of the user profile item (`USER#<id>` / `PROFILE`).
 *
 * Deliberately narrow: this package reads and adjusts exactly two attributes
 * and never rewrites the item, because the profile is owned elsewhere.
 */
export interface UserProfileRecord {
  pk: string;
  sk: "PROFILE";
  quotaBytes: number;
  usedBytes: number;
}

/**
 * The slice of a FILE record that Stash accounting needs, read through GSI2.
 *
 * Only `state`, `sizeBytes` and the id are consumed — nothing here can reach
 * a creator's path, so no Stash operation can ever rewrite one (Rule 1).
 */
export interface StashFileRef {
  fileId: string;
  state: "pending" | "uploading" | "committed" | "failed";
  sizeBytes: number;
}
