import {
  ConditionalCheckFailedException,
  TransactionCanceledException,
} from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  TransactWriteCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import type { IdempotentResult, UploadRepository } from "./repository.js";
import type { FileState, UploadFileRecord } from "./types.js";

const hex = (value: string): string => Buffer.from(value, "utf8").toString("hex");

/**
 * Every component is hex-encoded before joining, so a file id containing `#`
 * cannot collide with — or forge — another (fileId, key) pair's record.
 */
function idempotencySk(fileId: string, key: string): string {
  return `IDEMPOTENCY#${hex(fileId)}#${hex(key)}`;
}

/**
 * True when a write was rejected because its guard condition lost.
 *
 * Matched by `instanceof` AND by error name. `instanceof` alone is a real
 * hazard: if two copies of `@aws-sdk/client-dynamodb` are resolved, the thrown
 * exception is not an instance of the class this module imported, and a lost
 * guard would be misread as an unknown failure. On `abortAndReleaseQuota` that
 * turns an ordinary second abort into a 500; on `commitFile` it would strand
 * a healthy file in `uploading`. Structure is checked either way — a
 * cancellation only counts when a reason really is `ConditionalCheckFailed`.
 */
function isConditionFailure(error: unknown): boolean {
  if (error instanceof ConditionalCheckFailedException) return true;

  const name = (error as { name?: string } | undefined)?.name;
  if (name === "ConditionalCheckFailedException") return true;

  if (
    error instanceof TransactionCanceledException ||
    name === "TransactionCanceledException"
  ) {
    const reasons = (error as TransactionCanceledException).CancellationReasons ?? [];
    return reasons.some((reason) => reason.Code === "ConditionalCheckFailed");
  }
  return false;
}

/**
 * The DynamoDB implementation of the upload persistence port.
 *
 * Two disciplines run through all of it:
 *
 * **Parameterized expressions only** (invariant 4). Every attribute name goes
 * through `ExpressionAttributeNames` and every literal through
 * `ExpressionAttributeValues`. Nothing derived from a request is ever
 * concatenated into an expression string.
 *
 * **A lost guard is not an error.** Each conditional write returns `false`
 * when its condition fails and RETHROWS anything else. That distinction is
 * what lets `completeUpload` leave a file `uploading` when a write's outcome
 * is genuinely unknown (spec §5) instead of guessing it into `committed`.
 */
export class DynamoUploadRepository implements UploadRepository {
  constructor(
    private readonly doc: DynamoDBDocumentClient,
    private readonly tableName: string,
  ) {}

  async findFile(
    userId: string,
    fileId: string,
  ): Promise<UploadFileRecord | undefined> {
    const result = await this.doc.send(
      new GetCommand({
        TableName: this.tableName,
        // Invariant 5: another creator's file lives in another partition, so
        // a cross-tenant read finds nothing rather than being denied.
        Key: { pk: `USER#${userId}`, sk: `FILE#${fileId}` },
        // An eventually-consistent read here could show `uploading` for a file
        // that just committed, and re-complete it.
        ConsistentRead: true,
      }),
    );
    const item = result.Item as UploadFileRecord | undefined;
    if (item === undefined || item.entity !== "FILE") return undefined;
    return item;
  }

  async beginUpload(
    userId: string,
    fileId: string,
    uploadId: string,
  ): Promise<boolean> {
    return this.transition(userId, fileId, {
      from: "pending",
      to: "uploading",
      uploadId,
    });
  }

  async commitFile(userId: string, fileId: string): Promise<boolean> {
    // Rule 4: the sole path into `committed`, and only from `uploading`.
    return this.transition(userId, fileId, { from: "uploading", to: "committed" });
  }

  async failFile(userId: string, fileId: string): Promise<boolean> {
    return this.transition(userId, fileId, { from: "uploading", to: "failed" });
  }

  private async transition(
    userId: string,
    fileId: string,
    move: { from: FileState; to: FileState; uploadId?: string },
  ): Promise<boolean> {
    const names: Record<string, string> = { "#state": "state" };
    const values: Record<string, unknown> = {
      [`:${move.from}`]: move.from,
      [`:${move.to}`]: move.to,
    };
    let update = `SET #state = :${move.to}`;

    if (move.uploadId !== undefined) {
      names["#uploadId"] = "uploadId";
      values[":uploadId"] = move.uploadId;
      update += ", #uploadId = :uploadId";
    }

    try {
      await this.doc.send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: { pk: `USER#${userId}`, sk: `FILE#${fileId}` },
          UpdateExpression: update,
          ConditionExpression: `attribute_exists(pk) AND #state = :${move.from}`,
          ExpressionAttributeNames: names,
          ExpressionAttributeValues: values,
        }),
      );
      return true;
    } catch (error) {
      if (isConditionFailure(error)) return false;
      throw error;
    }
  }

  /**
   * One transaction: mark the file `failed` AND give its reserved bytes back.
   *
   * `attribute_not_exists(#quotaReleased)` is the once-only guard — a retried
   * abort loses it and refunds nothing, which is the difference between a
   * safe retry and free quota per retry. `#usedBytes >= :n` stops a stray
   * refund driving the creator's usage negative.
   */
  async abortAndReleaseQuota(
    userId: string,
    fileId: string,
    sizeBytes: number,
  ): Promise<boolean> {
    const pk = `USER#${userId}`;
    try {
      await this.doc.send(
        new TransactWriteCommand({
          TransactItems: [
            {
              Update: {
                TableName: this.tableName,
                Key: { pk, sk: `FILE#${fileId}` },
                UpdateExpression:
                  "SET #state = :failed, #quotaReleased = :released",
                ConditionExpression:
                  "attribute_exists(pk) AND #state <> :committed AND attribute_not_exists(#quotaReleased)",
                ExpressionAttributeNames: {
                  "#state": "state",
                  "#quotaReleased": "quotaReleased",
                },
                ExpressionAttributeValues: {
                  ":failed": "failed",
                  ":committed": "committed",
                  ":released": true,
                },
              },
            },
            {
              Update: {
                TableName: this.tableName,
                Key: { pk, sk: "PROFILE" },
                UpdateExpression: "SET #usedBytes = #usedBytes - :n",
                ConditionExpression:
                  "attribute_exists(pk) AND #usedBytes >= :n",
                ExpressionAttributeNames: { "#usedBytes": "usedBytes" },
                ExpressionAttributeValues: { ":n": sizeBytes },
              },
            },
          ] as never,
        }),
      );
      return true;
    } catch (error) {
      if (isConditionFailure(error)) return false;
      throw error;
    }
  }

  async getIdempotentResult(
    userId: string,
    fileId: string,
    key: string,
  ): Promise<IdempotentResult | undefined> {
    const result = await this.doc.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { pk: `USER#${userId}`, sk: idempotencySk(fileId, key) },
        ConsistentRead: true,
      }),
    );
    const item = result.Item;
    if (item === undefined) return undefined;
    const statusCode = item["statusCode"];
    const body = item["body"];
    // A half-written record replays as "no record": re-running the handler is
    // safe, replaying a malformed outcome is not.
    if (typeof statusCode !== "number" || typeof body !== "string") {
      return undefined;
    }
    return { statusCode, body };
  }

  async putIdempotentResult(
    userId: string,
    fileId: string,
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
                sk: idempotencySk(fileId, key),
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
