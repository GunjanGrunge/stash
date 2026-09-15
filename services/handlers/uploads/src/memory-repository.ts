import type { IdempotentResult, UploadRepository } from "./repository.js";
import type { UploadFileRecord } from "./types.js";

export interface Profile {
  quotaBytes: number;
  usedBytes: number;
}

function hexJoin(parts: string[]): string {
  return parts.map((p) => Buffer.from(p, "utf8").toString("hex")).join("#");
}

/**
 * In-memory fake with the SAME conditional semantics as DynamoDB.
 *
 * The port has no condition expressions, so each guard is enforced here in
 * application code and returns false exactly where DynamoDB would cancel the
 * transaction. If this fake were permissive, every handler test would pass
 * against a store that cannot exist in production.
 */
export class MemoryUploadRepository implements UploadRepository {
  private readonly files = new Map<string, UploadFileRecord>();
  private readonly profiles = new Map<string, Profile>();
  private readonly idempotency = new Map<string, IdempotentResult>();

  seedFile(record: UploadFileRecord): void {
    this.files.set(hexJoin([record.pk, record.fileId]), { ...record });
  }

  seedProfile(userId: string, profile: Profile): void {
    this.profiles.set(userId, { ...profile });
  }

  /** Test-only inspection. */
  file(userId: string, fileId: string): UploadFileRecord | undefined {
    const found = this.files.get(hexJoin([`USER#${userId}`, fileId]));
    return found === undefined ? undefined : { ...found };
  }

  /** Test-only inspection. */
  profile(userId: string): Profile | undefined {
    const found = this.profiles.get(userId);
    return found === undefined ? undefined : { ...found };
  }

  async findFile(
    userId: string,
    fileId: string,
  ): Promise<UploadFileRecord | undefined> {
    // Tenancy is structural: another creator's file lives under another pk.
    const found = this.files.get(hexJoin([`USER#${userId}`, fileId]));
    return found === undefined ? undefined : { ...found };
  }

  async beginUpload(
    userId: string,
    fileId: string,
    uploadId: string,
  ): Promise<boolean> {
    const key = hexJoin([`USER#${userId}`, fileId]);
    const found = this.files.get(key);
    if (found === undefined || found.state !== "pending") return false;
    this.files.set(key, { ...found, state: "uploading", uploadId });
    return true;
  }

  async commitFile(userId: string, fileId: string): Promise<boolean> {
    const key = hexJoin([`USER#${userId}`, fileId]);
    const found = this.files.get(key);
    // Rule 4: committed is reachable from `uploading` and nowhere else.
    if (found === undefined || found.state !== "uploading") return false;
    this.files.set(key, { ...found, state: "committed" });
    return true;
  }

  async failFile(userId: string, fileId: string): Promise<boolean> {
    const key = hexJoin([`USER#${userId}`, fileId]);
    const found = this.files.get(key);
    if (found === undefined || found.state !== "uploading") return false;
    this.files.set(key, { ...found, state: "failed" });
    return true;
  }

  async abortAndReleaseQuota(
    userId: string,
    fileId: string,
    sizeBytes: number,
  ): Promise<boolean> {
    const key = hexJoin([`USER#${userId}`, fileId]);
    const found = this.files.get(key);
    if (found === undefined) return false;
    // The once-only guard. A second abort finds the flag set and refunds
    // nothing — otherwise a retried abort hands the creator free quota.
    if (found.quotaReleased === true || found.state === "committed") return false;

    this.files.set(key, { ...found, state: "failed", quotaReleased: true });
    const profile = this.profiles.get(userId);
    if (profile !== undefined) {
      this.profiles.set(userId, {
        ...profile,
        usedBytes: Math.max(0, profile.usedBytes - sizeBytes),
      });
    }
    return true;
  }

  async getIdempotentResult(
    userId: string,
    fileId: string,
    key: string,
  ): Promise<IdempotentResult | undefined> {
    return this.idempotency.get(hexJoin([userId, fileId, key]));
  }

  async putIdempotentResult(
    userId: string,
    fileId: string,
    key: string,
    result: IdempotentResult,
  ): Promise<void> {
    this.idempotency.set(hexJoin([userId, fileId, key]), result);
  }
}
