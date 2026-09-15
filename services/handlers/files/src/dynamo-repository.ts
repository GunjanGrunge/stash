import {
  ConditionalCheckFailedException,
  TransactionCanceledException,
} from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  QueryCommand,
  TransactWriteCommand,
} from "@aws-sdk/lib-dynamodb";
import { badRequest, conflict } from "../../../shared/src/index.js";
import type { IdempotentResult, Repository } from "./repository.js";
import type { EntityRecord, FolderRecord } from "./types.js";

/**
 * DynamoDB caps a single transaction at 100 actions. `putEntities` is
 * contractually all-or-nothing, so a batch that would exceed the cap is
 * REJECTED rather than split: splitting would let a creator's library end up
 * half-written, which is precisely the state the transaction exists to prevent.
 */
export const TRANSACT_ITEM_LIMIT = 100;

const hex = (value: string): string => Buffer.from(value, "utf8").toString("hex");

/**
 * The sort key of a folder's identity item.
 *
 * Every component is hex-encoded before joining, so a folder legitimately
 * named `a#b` cannot collide with — or forge — the identity of a folder named
 * `a`. Creator-chosen names are untrusted input to key construction.
 */
export function folderIdentitySk(
  parentFolderId: string | null,
  name: string,
): string {
  return `FOLDERID#${hex(parentFolderId ?? "ROOT")}#${hex(name)}`;
}

function idempotencySk(stashId: string, key: string): string {
  return `IDEMPOTENCY#${hex(stashId)}#${hex(key)}`;
}

/** True when a transaction was cancelled because a guard condition lost. */
function isConditionFailure(error: unknown): boolean {
  if (error instanceof ConditionalCheckFailedException) return true;
  if (error instanceof TransactionCanceledException) {
    return (error.CancellationReasons ?? []).some(
      (reason) => reason.Code === "ConditionalCheckFailed",
    );
  }
  return false;
}

/**
 * The DynamoDB implementation of the file/folder persistence port.
 *
 * Folder identity is the load-bearing concern. `MemoryRepository` enforces
 * "at most one FOLDER per (pk, parentFolderId, name)" in application code,
 * but DynamoDB cannot express a condition against a GSI, and a plain
 * read-before-write is racy: two concurrent registrations of the same path
 * would both miss, both insert, and FORK the creator's library (Rule 1).
 *
 * So each folder is written as TWO items inside one transaction — the FOLDER
 * record itself, and a guarded identity item keyed by (parent, name) whose
 * `attribute_not_exists` condition only one writer can win. Identity still
 * comes from LOOKUP, never from hashing the path, so a rename remains a
 * metadata write and every descendant keeps pointing at the same folderId.
 */
export class DynamoRepository implements Repository {
  constructor(
    private readonly doc: DynamoDBDocumentClient,
    private readonly tableName: string,
  ) {}

  async putEntities(items: EntityRecord[]): Promise<void> {
    if (items.length === 0) return;

    const transactItems: Record<string, unknown>[] = [];
    const seenIdentities = new Set<string>();

    for (const item of items) {
      // Rule 8: S3 versioning is off and an overwrite is unrecoverable, so
      // every write is create-only. A repeated key is a bug, not an update.
      transactItems.push({
        Put: {
          TableName: this.tableName,
          Item: item,
          ConditionExpression: "attribute_not_exists(pk)",
        },
      });

      if (item.entity !== "FOLDER") continue;

      const sk = folderIdentitySk(item.parentFolderId, item.name);
      const identity = `${item.pk}|${sk}`;
      if (seenIdentities.has(identity)) {
        // Mirrors MemoryRepository: one repeat rejects the WHOLE batch.
        // DynamoDB would reject a duplicate key itself, but with an opaque
        // ValidationException rather than a creator-meaningful 409.
        throw conflict(
          "a folder with this name already exists under this parent",
        );
      }
      seenIdentities.add(identity);

      transactItems.push({
        Put: {
          TableName: this.tableName,
          Item: {
            pk: item.pk,
            sk,
            entity: "FOLDERID",
            folderId: item.folderId,
            parentFolderId: item.parentFolderId,
            name: item.name,
          },
          ConditionExpression: "attribute_not_exists(pk)",
        },
      });
    }

    if (transactItems.length > TRANSACT_ITEM_LIMIT) {
      throw badRequest(
        `a single registration may write at most ${TRANSACT_ITEM_LIMIT} items atomically`,
      );
    }

    try {
      await this.doc.send(
        new TransactWriteCommand({ TransactItems: transactItems as never }),
      );
    } catch (error) {
      if (isConditionFailure(error)) {
        throw conflict(
          "a folder with this name already exists under this parent",
        );
      }
      throw error;
    }
  }

  async listChildren(
    userId: string,
    parentFolderId: string | null,
  ): Promise<EntityRecord[]> {
    const pk = `USER#${userId}`;
    const gsi1pk = `${pk}#PARENT#${parentFolderId ?? "ROOT"}`;
    const out: EntityRecord[] = [];
    let cursor: Record<string, unknown> | undefined;

    // A folder with more than 1 MB of children spans several pages. Returning
    // only the first would silently hide a creator's files, so follow them all.
    do {
      const page = await this.doc.send(
        new QueryCommand({
          TableName: this.tableName,
          IndexName: "gsi1",
          KeyConditionExpression: "gsi1pk = :gsi1pk",
          // Defence in depth: gsi1pk already embeds the caller's id, and this
          // makes a cross-tenant read impossible even if that ever changes.
          FilterExpression: "pk = :pk",
          ExpressionAttributeValues: { ":gsi1pk": gsi1pk, ":pk": pk },
          ExclusiveStartKey: cursor as never,
        }),
      );
      out.push(...((page.Items ?? []) as EntityRecord[]));
      cursor = page.LastEvaluatedKey as Record<string, unknown> | undefined;
    } while (cursor !== undefined);

    return out;
  }

  async findFolder(
    userId: string,
    parentFolderId: string | null,
    name: string,
  ): Promise<FolderRecord | undefined> {
    const pk = `USER#${userId}`;
    const identity = await this.doc.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { pk, sk: folderIdentitySk(parentFolderId, name) },
        ConsistentRead: true,
      }),
    );

    const folderId = identity.Item?.["folderId"];
    if (typeof folderId !== "string") return undefined;
    return this.findFolderById(userId, folderId);
  }

  async findFolderById(
    userId: string,
    folderId: string,
  ): Promise<FolderRecord | undefined> {
    const result = await this.doc.send(
      new GetCommand({
        TableName: this.tableName,
        // A folder belonging to another creator lives in another partition,
        // so a cross-tenant read simply finds nothing.
        Key: { pk: `USER#${userId}`, sk: `FOLDER#${folderId}` },
        ConsistentRead: true,
      }),
    );
    const item = result.Item as EntityRecord | undefined;
    if (item === undefined || item.entity !== "FOLDER") return undefined;
    return item;
  }

  async getIdempotentResult(
    userId: string,
    stashId: string,
    key: string,
  ): Promise<IdempotentResult | undefined> {
    const result = await this.doc.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { pk: `USER#${userId}`, sk: idempotencySk(stashId, key) },
        ConsistentRead: true,
      }),
    );
    const item = result.Item;
    if (item === undefined) return undefined;
    const statusCode = item["statusCode"];
    const body = item["body"];
    if (typeof statusCode !== "number" || typeof body !== "string") {
      return undefined;
    }
    return { statusCode, body };
  }

  async putIdempotentResult(
    userId: string,
    stashId: string,
    key: string,
    result: IdempotentResult,
  ): Promise<void> {
    await this.doc.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Put: {
              TableName: this.tableName,
              Item: {
                pk: `USER#${userId}`,
                sk: idempotencySk(stashId, key),
                entity: "IDEMPOTENCY",
                statusCode: result.statusCode,
                body: result.body,
              },
            },
          },
        ],
      }),
    );
  }
}
