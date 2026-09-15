import { conflict } from "../../../shared/src/index.js";
import type { IdempotentResult, Repository } from "./repository.js";
import type { EntityRecord, FolderRecord } from "./types.js";

/** Stable folder identity key: (pk, parentFolderId, name), raw UTF-8 bytes. */
function folderIdentity(
  pk: string,
  parentFolderId: string | null,
  name: string,
): string {
  return [
    Buffer.from(pk, "utf8").toString("hex"),
    Buffer.from(parentFolderId ?? "ROOT", "utf8").toString("hex"),
    Buffer.from(name, "utf8").toString("hex"),
  ].join("#");
}

/** Same key discipline as DynamoDB: query by pk and by the gsi1 parent index. */
export class MemoryRepository implements Repository {
  private readonly items: EntityRecord[] = [];
  private readonly folderIndex = new Map<string, FolderRecord>();
  private readonly idempotency = new Map<string, IdempotentResult>();

  /**
   * DynamoDB expresses create-if-absent as a conditional put. The in-memory
   * port has no condition expression, so the same invariant is enforced here
   * directly: a second FOLDER with an identity that already exists (or that
   * repeats inside the batch) rejects the WHOLE batch and writes nothing.
   */
  async putEntities(items: EntityRecord[]): Promise<void> {
    const pending = new Map<string, FolderRecord>();
    for (const item of items) {
      if (item.entity !== "FOLDER") continue;
      const id = folderIdentity(item.pk, item.parentFolderId, item.name);
      if (this.folderIndex.has(id) || pending.has(id)) {
        throw conflict(
          "a folder with this name already exists under this parent",
        );
      }
      pending.set(id, item);
    }
    for (const [id, folder] of pending) this.folderIndex.set(id, folder);
    this.items.push(...items);
  }

  async listChildren(
    userId: string,
    parentFolderId: string | null,
  ): Promise<EntityRecord[]> {
    const pk = `USER#${userId}`;
    const gsi1pk = `${pk}#PARENT#${parentFolderId ?? "ROOT"}`;
    return this.items.filter(
      (item) => item.pk === pk && item.gsi1pk === gsi1pk,
    );
  }

  async findFolder(
    userId: string,
    parentFolderId: string | null,
    name: string,
  ): Promise<FolderRecord | undefined> {
    return this.folderIndex.get(
      folderIdentity(`USER#${userId}`, parentFolderId, name),
    );
  }

  async findFolderById(
    userId: string,
    folderId: string,
  ): Promise<FolderRecord | undefined> {
    const pk = `USER#${userId}`;
    return this.items.find(
      (item): item is FolderRecord =>
        item.entity === "FOLDER" && item.pk === pk && item.folderId === folderId,
    );
  }

  async getIdempotentResult(
    userId: string,
    stashId: string,
    key: string,
  ): Promise<IdempotentResult | undefined> {
    return this.idempotency.get(idempotencyKey(userId, stashId, key));
  }

  async putIdempotentResult(
    userId: string,
    stashId: string,
    key: string,
    result: IdempotentResult,
  ): Promise<void> {
    this.idempotency.set(idempotencyKey(userId, stashId, key), result);
  }

  /** Test-only inspection of everything written, across all users. */
  all(): EntityRecord[] {
    return [...this.items];
  }
}

function idempotencyKey(userId: string, stashId: string, key: string): string {
  return [userId, stashId, key]
    .map((part) => Buffer.from(part, "utf8").toString("hex"))
    .join("#");
}
