import { randomUUID } from "node:crypto";
import { conflict, quotaExceeded } from "../../../shared/src/index.js";
import { CREATE_SCOPE } from "./repository.js";
import type {
  CancelStashInput,
  CompleteStashInput,
  CreateStashInput,
  IdempotentResult,
  StashRepository,
} from "./repository.js";
import type {
  StashFileRef,
  StashRecord,
  StashState,
  UserProfileRecord,
} from "./types.js";

function scopedKey(...parts: string[]): string {
  return parts.map((p) => Buffer.from(p, "utf8").toString("hex")).join("#");
}

/**
 * In-memory stand-in for the DynamoDB table, used to test handler LOGIC.
 *
 * It reproduces the two behaviours the handlers actually depend on, because a
 * fake that is looser than production would let a real defect pass:
 *
 *  1. `createStash` is all-or-nothing and enforces the quota itself. The
 *     handler never reads-then-decides; the store decides.
 *  2. `cancelStash` / `completeStash` refuse to act unless the Stash is still
 *     `open`, and the state flip and the quota adjustment happen together.
 */
export class MemoryStashRepository implements StashRepository {
  private readonly profiles = new Map<string, UserProfileRecord>();
  private readonly stashes = new Map<string, StashRecord>();
  private readonly files = new Map<string, StashFileRef & { userId: string; stashId: string }>();
  private readonly idempotency = new Map<string, IdempotentResult>();

  // --- test seeding -------------------------------------------------------

  seedProfile(userId: string, quota: { quotaBytes: number; usedBytes: number }): void {
    this.profiles.set(userId, {
      pk: `USER#${userId}`,
      sk: "PROFILE",
      quotaBytes: quota.quotaBytes,
      usedBytes: quota.usedBytes,
    });
  }

  seedStash(
    userId: string,
    overrides: Partial<StashRecord> & { state: StashState },
  ): string {
    const stashId = overrides.stashId ?? randomUUID();
    const now = new Date().toISOString();
    this.stashes.set(`${userId}|${stashId}`, {
      pk: `USER#${userId}`,
      sk: `STASH#${stashId}`,
      entity: "STASH",
      stashId,
      fileCount: 0,
      committedCount: 0,
      reservedBytes: 0,
      committedBytes: 0,
      startedAt: now,
      updatedAt: now,
      ...overrides,
      state: overrides.state,
    });
    return stashId;
  }

  seedFile(userId: string, stashId: string, file: StashFileRef): void {
    this.files.set(`${userId}|${file.fileId}`, { ...file, userId, stashId });
  }

  allStashes(): StashRecord[] {
    return [...this.stashes.values()];
  }

  // --- port ---------------------------------------------------------------

  async getProfile(userId: string): Promise<UserProfileRecord | undefined> {
    const profile = this.profiles.get(userId);
    return profile === undefined ? undefined : { ...profile };
  }

  async getStash(userId: string, stashId: string): Promise<StashRecord | undefined> {
    const stash = this.stashes.get(`${userId}|${stashId}`);
    return stash === undefined ? undefined : { ...stash };
  }

  async createStash(input: CreateStashInput): Promise<void> {
    const profile = this.profiles.get(input.userId);
    // Fail closed. No profile means no PROVEN quota, and an unproven quota is
    // not a licence to store bytes. In DynamoDB the same case is a failed
    // condition on a missing item, which is likewise a 507.
    if (profile === undefined) throw quotaExceeded();
    if (profile.usedBytes + input.reserveBytes > profile.quotaBytes) {
      throw quotaExceeded();
    }
    if (this.stashes.has(`${input.userId}|${input.stash.stashId}`)) {
      throw conflict("stash already exists");
    }

    profile.usedBytes += input.reserveBytes;
    this.stashes.set(`${input.userId}|${input.stash.stashId}`, { ...input.stash });
    this.recordIdempotency(input.userId, CREATE_SCOPE, input.idempotency);
  }

  async cancelStash(input: CancelStashInput): Promise<void> {
    const stash = this.requireOpen(input.userId, input.stashId);
    const profile = this.profiles.get(input.userId);
    if (profile === undefined) throw conflict("stash is not open");

    stash.state = "cancelled";
    stash.updatedAt = new Date().toISOString();
    // Never below zero: a negative usedBytes is free storage forever.
    profile.usedBytes = Math.max(0, profile.usedBytes - input.releaseBytes);
    this.recordIdempotency(input.userId, input.stashId, input.idempotency);
  }

  async completeStash(input: CompleteStashInput): Promise<void> {
    const stash = this.requireOpen(input.userId, input.stashId);
    const profile = this.profiles.get(input.userId);
    if (profile === undefined) throw conflict("stash is not open");

    stash.state = "completed";
    stash.committedCount = input.committedCount;
    stash.committedBytes = input.committedBytes;
    stash.updatedAt = new Date().toISOString();
    profile.usedBytes = Math.max(0, profile.usedBytes + input.deltaBytes);
    this.recordIdempotency(input.userId, input.stashId, input.idempotency);
  }

  async listStashFiles(userId: string, stashId: string): Promise<StashFileRef[]> {
    return [...this.files.values()]
      .filter((f) => f.userId === userId && f.stashId === stashId)
      .map(({ fileId, state, sizeBytes, originalRelativePath, checksum, rootFolderId }) => ({ fileId, state, sizeBytes, originalRelativePath, checksum, rootFolderId }));
  }

  async deleteFiles(userId: string, fileIds: string[]): Promise<void> {
    for (const fileId of fileIds) this.files.delete(`${userId}|${fileId}`);
  }

  async getIdempotentResult(
    userId: string,
    scope: string,
    key: string,
  ): Promise<IdempotentResult | undefined> {
    return this.idempotency.get(scopedKey(userId, scope, key));
  }

  // --- internals ----------------------------------------------------------

  /**
   * The single chokepoint that makes a second cancel (or complete) a no-op.
   * Mirrors the DynamoDB `#state = :open` condition inside the transaction.
   */
  private requireOpen(userId: string, stashId: string): StashRecord {
    const stash = this.stashes.get(`${userId}|${stashId}`);
    if (stash === undefined || stash.state !== "open") {
      throw conflict("stash is not open");
    }
    return stash;
  }

  private recordIdempotency(
    userId: string,
    scope: string,
    idempotency: { key: string; result: IdempotentResult } | undefined,
  ): void {
    if (idempotency === undefined) return;
    this.idempotency.set(
      scopedKey(userId, scope, idempotency.key),
      idempotency.result,
    );
  }
}
