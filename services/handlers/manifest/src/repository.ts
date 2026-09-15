import type { ManifestRecord } from "./types.js";

/**
 * The narrow persistence port for manifests. Implemented in memory for tests
 * and (later) by DynamoDB: `findByHash` is a point read on
 * (pk = USER#<userId>, sk = MANIFEST#<hash>); `findByFolderName` is a
 * per-user lookup by folder name.
 *
 * Every read is scoped by `userId`: one creator's manifest must never be
 * reported to another (Rule 7 tenancy).
 */
export interface ManifestRepository {
  findByHash(
    userId: string,
    manifestHash: string,
  ): Promise<ManifestRecord | undefined>;

  findByFolderName(userId: string, folderName: string): Promise<ManifestRecord[]>;

  /** Write path — NOT used by the check endpoint, which writes nothing. */
  putManifest(record: ManifestRecord): Promise<void>;
}
