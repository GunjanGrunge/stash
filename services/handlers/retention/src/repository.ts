import type { DueFile } from "./types.js";

/** Persistence operations for the scheduled retention worker. */
export interface RetentionRepository {
  /** All due candidates, not merely DynamoDB's first 1 MB page. */
  listDue(now: string): Promise<DueFile[]>;
  /** Atomically claims a recoverable record; false means it was restored/raced. */
  claim(file: DueFile): Promise<boolean>;
  /** Atomically removes claimed metadata and decrements the owning PROFILE quota. */
  finalize(file: DueFile): Promise<void>;
}
