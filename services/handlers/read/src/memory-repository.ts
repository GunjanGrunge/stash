import type { ReadRepository } from "./repository.js";
import type { StashRecord, UsageRecord } from "./types.js";
import { readUsage } from "./usage.js";

/**
 * Same partition discipline as DynamoDB: everything is addressed by
 * `pk = USER#<user_id>`, so a cross-tenant read is unaddressable here too
 * and the tests exercise the same guarantee the table gives.
 */
export class MemoryReadRepository implements ReadRepository {
  private readonly stashes: StashRecord[] = [];
  private readonly profiles = new Map<string, Record<string, unknown>>();

  seedStash(record: StashRecord): void {
    this.stashes.push(record);
  }

  seedProfile(userId: string, usage: UsageRecord): void {
    this.seedRawProfile(userId, { ...usage });
  }

  /** Seeds a PROFILE item verbatim, malformed attributes included. */
  seedRawProfile(userId: string, item: Record<string, unknown>): void {
    this.profiles.set(`USER#${userId}`, item);
  }

  /** Test helper: every Stash id seeded for one creator. */
  allStashIds(userId: string): string[] {
    const pk = `USER#${userId}`;
    return this.stashes.filter((s) => s.pk === pk).map((s) => s.stashId);
  }

  async listStashes(userId: string): Promise<StashRecord[]> {
    const pk = `USER#${userId}`;
    return this.stashes.filter(
      (item) => item.pk === pk && item.sk.startsWith("STASH#"),
    );
  }

  async getUsage(userId: string): Promise<UsageRecord | undefined> {
    return readUsage(this.profiles.get(`USER#${userId}`));
  }
}
