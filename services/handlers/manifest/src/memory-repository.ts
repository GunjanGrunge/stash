import type { ManifestRepository } from "./repository.js";
import type { ManifestRecord } from "./types.js";

/** Raw-UTF-8 key: no normalization or case-folding anywhere (Rule 1). */
function bytesKey(...parts: string[]): string {
  return parts.map((p) => Buffer.from(p, "utf8").toString("hex")).join("#");
}

/**
 * In-memory manifest store with the same key discipline as DynamoDB. It also
 * counts writes so a test can prove the check endpoint writes NOTHING.
 */
export class MemoryManifestRepository implements ManifestRepository {
  private readonly items = new Map<string, ManifestRecord>();
  private writes = 0;

  async findByHash(
    userId: string,
    manifestHash: string,
  ): Promise<ManifestRecord | undefined> {
    return this.items.get(bytesKey(`USER#${userId}`, `MANIFEST#${manifestHash}`));
  }

  async findByFolderName(
    userId: string,
    folderName: string,
  ): Promise<ManifestRecord[]> {
    const pk = `USER#${userId}`;
    return [...this.items.values()].filter(
      (record) => record.pk === pk && record.folderName === folderName,
    );
  }

  async putManifest(record: ManifestRecord): Promise<void> {
    this.writes += 1;
    this.items.set(bytesKey(record.pk, record.sk), record);
  }

  /** Test-only: how many writes this repository has ever accepted. */
  writeCount(): number {
    return this.writes;
  }

  /** Test-only inspection of everything stored, across all users. */
  all(): ManifestRecord[] {
    return [...this.items.values()];
  }
}
