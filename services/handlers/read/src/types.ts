/**
 * Read-side entity shapes for the STASH single-table model.
 *
 * These mirror what the write handlers persist — they are NOT a second
 * definition of the truth. Rule 2 still holds: a Stash is metadata about one
 * ingestion event, never a folder and never a file.
 */

/** Spec §3.2: a Stash is `open`, `completed` or `cancelled`. */
export type StashState = "open" | "completed" | "cancelled";

export interface StashRecord {
  pk: string;
  sk: string;
  entity: "STASH";
  stashId: string;
  state: StashState;
  fileCount: number;
  /** Only `committed` files count as Stashed (PRD §13). */
  committedCount: number;
  reservedBytes: number;
  committedBytes: number;
  startedAt: string;
  updatedAt: string;
}

/** The creator's storage counters, as stored on `USER#<id> / PROFILE`. */
export interface UsageRecord {
  usedBytes: number;
  quotaBytes: number;
}

/** What a read handler hands back to the API Gateway shell. */
export interface HandlerResult {
  statusCode: number;
  body: string;
}
