import type { StashRecord, UsageRecord } from "./types.js";

/**
 * The narrow read-only persistence port behind `listStashes` and `getUsage`.
 * Implemented in memory for tests and by DynamoDB in production.
 */
export interface ReadRepository {
  /**
   * Every Stash owned by this creator.
   *
   * Implementations MUST follow every underlying page. A creator with more
   * than 1 MB of Stash records would otherwise see their Recent Stashes
   * silently truncated, which reads as data loss.
   */
  listStashes(userId: string): Promise<StashRecord[]>;

  /**
   * The creator's storage counters, or `undefined` when no PROFILE item
   * exists yet — or when the one that exists carries counters that are not
   * numbers. A read handler never invents a quota.
   */
  getUsage(userId: string): Promise<UsageRecord | undefined>;
}
