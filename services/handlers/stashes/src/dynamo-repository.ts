import {
  ConditionalCheckFailedException,
  TransactionCanceledException,
} from "@aws-sdk/client-dynamodb";
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  QueryCommand,
  TransactWriteCommand,
} from "@aws-sdk/lib-dynamodb";
import { conflict, quotaExceeded } from "../../../shared/src/index.js";
import { CREATE_SCOPE } from "./repository.js";
import type {
  CancelStashInput,
  CompleteStashInput,
  CreateStashInput,
  IdempotentResult,
  StashRepository,
} from "./repository.js";
import type { StashFileRef, StashRecord, UserProfileRecord } from "./types.js";

const hex = (value: string): string => Buffer.from(value, "utf8").toString("hex");

/**
 * Each component is hex-encoded before joining, so a creator-supplied key
 * containing `#` cannot collide with — or forge — another scope's replay
 * record. Same discipline as the files package.
 */
function idempotencySk(scope: string, key: string): string {
  return `IDEMPOTENCY#${hex(scope)}#${hex(key)}`;
}

/** Index of a transaction action, used to read CancellationReasons positionally. */
const STASH_ACTION = 0;
const PROFILE_ACTION = 1;

/**
 * Matched by error NAME as well as by `instanceof`: if two copies of
 * `@aws-sdk/client-dynamodb` resolve in the dependency tree, `instanceof`
 * silently fails against the other copy's class and a lost quota guard would
 * be misread as an unknown failure — returning 500 instead of the 507 that
 * tells the creator they are out of space.
 */
function cancellationCodes(error: unknown): string[] | undefined {
  const name = (error as { name?: string } | undefined)?.name;

  if (
    error instanceof TransactionCanceledException ||
    name === "TransactionCanceledException"
  ) {
    const reasons =
      (error as TransactionCanceledException).CancellationReasons ?? [];
    return reasons.map((r) => r.Code ?? "None");
  }
  if (
    error instanceof ConditionalCheckFailedException ||
    name === "ConditionalCheckFailedException"
  ) {
    return ["ConditionalCheckFailed"];
  }
  return undefined;
}

/**
 * The DynamoDB implementation of the Stash persistence port.
 *
 * Every mutation is a single `TransactWriteCommand`, because each one couples
 * a Stash state change to a quota movement and the two must never diverge:
 * a Stash without its reservation lets a creator open unlimited Stashes, and
 * a reservation without its Stash strands quota nobody can release.
 *
 * ## Why the quota condition is not literally `usedBytes + :n <= quotaBytes`
 *
 * DynamoDB allows arithmetic in an **update** expression but not in a
 * **condition** expression, whose operands are paths, values and functions
 * only. The equivalent guard therefore pins the two profile attributes the
 * decision depends on:
 *
 *     attribute_exists(pk) AND quotaBytes = :quota AND usedBytes <= :maxUsed
 *
 * with `:maxUsed = quotaBytes - reserveBytes` computed from a consistent read.
 * This is the same decision, still made SERVER-SIDE by the write itself and
 * never by the client: concurrent creates are serialized by DynamoDB, so the
 * second one sees the first one's increment and loses. Pinning `quotaBytes`
 * means a quota that changed under us fails the write closed (507) instead of
 * silently applying a stale limit.
 */
export class DynamoStashRepository implements StashRepository {
  constructor(
    private readonly doc: DynamoDBDocumentClient,
    private readonly tableName: string,
  ) {}

  async getProfile(userId: string): Promise<UserProfileRecord | undefined> {
    const result = await this.doc.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { pk: `USER#${userId}`, sk: "PROFILE" },
        ConsistentRead: true,
      }),
    );
    const item = result.Item;
    if (item === undefined) return undefined;
    const quotaBytes = item["quotaBytes"];
    const usedBytes = item["usedBytes"];
    if (typeof quotaBytes !== "number" || typeof usedBytes !== "number") {
      return undefined;
    }
    return { pk: `USER#${userId}`, sk: "PROFILE", quotaBytes, usedBytes };
  }

  async getStash(userId: string, stashId: string): Promise<StashRecord | undefined> {
    const result = await this.doc.send(
      new GetCommand({
        TableName: this.tableName,
        // A Stash belonging to another creator lives in another partition, so
        // a cross-tenant read simply finds nothing — hence 404, never 403.
        Key: { pk: `USER#${userId}`, sk: `STASH#${stashId}` },
        ConsistentRead: true,
      }),
    );
    const item = result.Item as StashRecord | undefined;
    if (item === undefined || item.entity !== "STASH") return undefined;
    return item;
  }

  async createStash(input: CreateStashInput): Promise<void> {
    const profile = await this.getProfile(input.userId);
    // Fail closed: no profile means no PROVEN quota, and an unproven quota is
    // not a licence to store bytes.
    if (profile === undefined) throw quotaExceeded();

    const maxUsed = profile.quotaBytes - input.reserveBytes;
    if (profile.usedBytes > maxUsed) throw quotaExceeded();

    const transactItems: Record<string, unknown>[] = [
      {
        Put: {
          TableName: this.tableName,
          Item: input.stash,
          // Rule 8 discipline: every write is create-only. A repeated Stash id
          // is a bug, not an update.
          ConditionExpression: "attribute_not_exists(pk)",
        },
      },
      {
        Update: {
          TableName: this.tableName,
          Key: { pk: `USER#${input.userId}`, sk: "PROFILE" },
          UpdateExpression: "SET usedBytes = usedBytes + :n",
          ConditionExpression:
            "attribute_exists(pk) AND quotaBytes = :quota AND usedBytes <= :maxUsed",
          ExpressionAttributeValues: {
            ":n": input.reserveBytes,
            ":maxUsed": maxUsed,
            ":quota": profile.quotaBytes,
          },
        },
      },
    ];

    this.appendIdempotency(transactItems, input.userId, CREATE_SCOPE, input.idempotency);

    try {
      await this.doc.send(
        new TransactWriteCommand({ TransactItems: transactItems as never }),
      );
    } catch (error) {
      const codes = cancellationCodes(error);
      if (codes === undefined) throw error;
      if (codes[PROFILE_ACTION] === "ConditionalCheckFailed") throw quotaExceeded();
      if (codes[STASH_ACTION] === "ConditionalCheckFailed") {
        throw conflict("stash already exists");
      }
      throw quotaExceeded();
    }
  }

  async cancelStash(input: CancelStashInput): Promise<void> {
    const now = new Date().toISOString();
    const transactItems: Record<string, unknown>[] = [
      {
        Update: {
          TableName: this.tableName,
          Key: { pk: `USER#${input.userId}`, sk: `STASH#${input.stashId}` },
          UpdateExpression: "SET #state = :cancelled, updatedAt = :now",
          // THE double-release guard. The release below is in the same
          // transaction, so when this loses, nothing is released.
          ConditionExpression: "attribute_exists(pk) AND #state = :open",
          ExpressionAttributeNames: { "#state": "state" },
          ExpressionAttributeValues: {
            ":cancelled": "cancelled",
            ":open": "open",
            ":now": now,
          },
        },
      },
    ];

    if (input.releaseBytes > 0) {
      transactItems.push({
        Update: {
          TableName: this.tableName,
          Key: { pk: `USER#${input.userId}`, sk: "PROFILE" },
          UpdateExpression: "SET usedBytes = usedBytes - :n",
          // A negative usedBytes would be free storage forever.
          ConditionExpression: "attribute_exists(pk) AND usedBytes >= :n",
          ExpressionAttributeValues: { ":n": input.releaseBytes },
        },
      });
    }

    this.appendIdempotency(transactItems, input.userId, input.stashId, input.idempotency);
    await this.sendGuarded(transactItems, "stash is not open");
  }

  async completeStash(input: CompleteStashInput): Promise<void> {
    const now = new Date().toISOString();
    const transactItems: Record<string, unknown>[] = [
      {
        Update: {
          TableName: this.tableName,
          Key: { pk: `USER#${input.userId}`, sk: `STASH#${input.stashId}` },
          UpdateExpression:
            "SET #state = :completed, committedCount = :cc, committedBytes = :cb, updatedAt = :now",
          ConditionExpression: "attribute_exists(pk) AND #state = :open",
          ExpressionAttributeNames: { "#state": "state" },
          ExpressionAttributeValues: {
            ":completed": "completed",
            ":open": "open",
            ":cc": input.committedCount,
            ":cb": input.committedBytes,
            ":now": now,
          },
        },
      },
    ];

    if (input.deltaBytes < 0) {
      transactItems.push({
        Update: {
          TableName: this.tableName,
          Key: { pk: `USER#${input.userId}`, sk: "PROFILE" },
          UpdateExpression: "SET usedBytes = usedBytes - :n",
          ConditionExpression: "attribute_exists(pk) AND usedBytes >= :n",
          ExpressionAttributeValues: { ":n": -input.deltaBytes },
        },
      });
    } else if (input.deltaBytes > 0) {
      transactItems.push({
        Update: {
          TableName: this.tableName,
          Key: { pk: `USER#${input.userId}`, sk: "PROFILE" },
          UpdateExpression: "SET usedBytes = usedBytes + :n",
          // Deliberately UNCONDITIONAL. These bytes are already objects in S3;
          // vetoing the write on quota would leave usedBytes understating real
          // storage, which is a worse lie than a small overage.
          ExpressionAttributeValues: { ":n": input.deltaBytes },
        },
      });
    }

    if (input.manifest !== undefined) {
      transactItems.push({
        Put: {
          TableName: this.tableName,
          Item: input.manifest,
          ConditionExpression: "attribute_not_exists(pk)",
        },
      });
    }

    this.appendIdempotency(transactItems, input.userId, input.stashId, input.idempotency);
    await this.sendGuarded(transactItems, "stash is not open");
  }

  async listStashFiles(userId: string, stashId: string): Promise<StashFileRef[]> {
    const pk = `USER#${userId}`;
    const gsi2pk = `${pk}#STASH#${stashId}`;
    const out: StashFileRef[] = [];
    let cursor: Record<string, unknown> | undefined;

    // A Stash of a few thousand files spans several pages. Stopping at the
    // first would under-count the committed total and silently hand back quota
    // for bytes the creator is actually storing.
    do {
      const page = await this.doc.send(
        new QueryCommand({
          TableName: this.tableName,
          IndexName: "gsi2",
          KeyConditionExpression: "gsi2pk = :gsi2pk",
          // Defence in depth: gsi2pk already embeds the caller's id.
          FilterExpression: "pk = :pk",
          ExpressionAttributeValues: { ":gsi2pk": gsi2pk, ":pk": pk },
          ExclusiveStartKey: cursor as never,
        }),
      );
      for (const item of (page.Items ?? []) as Record<string, unknown>[]) {
        const fileId = item["fileId"];
        const state = item["state"];
        const sizeBytes = item["sizeBytes"];
        const originalRelativePath = item["originalRelativePath"];
        const checksum = item["checksum"];
        const rootFolderId = item["rootFolderId"];
        if (typeof fileId !== "string" || typeof state !== "string") continue;
        out.push({
          fileId,
          state: state as StashFileRef["state"],
          sizeBytes: typeof sizeBytes === "number" ? sizeBytes : 0,
          originalRelativePath: typeof originalRelativePath === "string" ? originalRelativePath : undefined,
          checksum: typeof checksum === "string" ? checksum : undefined,
          rootFolderId: typeof rootFolderId === "string" ? rootFolderId : undefined,
        });
      }
      cursor = page.LastEvaluatedKey as Record<string, unknown> | undefined;
    } while (cursor !== undefined);

    return out;
  }

  async deleteFiles(userId: string, fileIds: string[]): Promise<void> {
    // Individual deletes, not a transaction: these are `pending` placeholders
    // with no bytes behind them, so a partial failure is harmless and the
    // retry is naturally idempotent. A transaction would cap the batch at 100
    // and fail a whole cancel because one delete lost a race.
    for (const fileId of fileIds) {
      await this.doc.send(
        new DeleteCommand({
          TableName: this.tableName,
          Key: { pk: `USER#${userId}`, sk: `FILE#${fileId}` },
        }),
      );
    }
  }

  async getIdempotentResult(
    userId: string,
    scope: string,
    key: string,
  ): Promise<IdempotentResult | undefined> {
    const result = await this.doc.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { pk: `USER#${userId}`, sk: idempotencySk(scope, key) },
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

  // --- internals ----------------------------------------------------------

  private appendIdempotency(
    transactItems: Record<string, unknown>[],
    userId: string,
    scope: string,
    idempotency: { key: string; result: IdempotentResult } | undefined,
  ): void {
    if (idempotency === undefined) return;
    transactItems.push({
      Put: {
        TableName: this.tableName,
        Item: {
          pk: `USER#${userId}`,
          sk: idempotencySk(scope, idempotency.key),
          entity: "IDEMPOTENCY",
          statusCode: idempotency.result.statusCode,
          body: idempotency.result.body,
        },
      },
    });
  }

  private async sendGuarded(
    transactItems: Record<string, unknown>[],
    message: string,
  ): Promise<void> {
    try {
      await this.doc.send(
        new TransactWriteCommand({ TransactItems: transactItems as never }),
      );
    } catch (error) {
      if (cancellationCodes(error)?.includes("ConditionalCheckFailed") === true) {
        throw conflict(message);
      }
      throw error;
    }
  }
}
