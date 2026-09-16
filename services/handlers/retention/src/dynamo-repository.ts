import {
  DynamoDBDocumentClient,
  QueryCommand,
  TransactWriteCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import type { RetentionRepository } from "./repository.js";
import type { DueFile } from "./types.js";

function isConditionalFailure(error: unknown): boolean {
  const name = (error as { name?: string } | undefined)?.name;
  return name === "ConditionalCheckFailedException" || name === "TransactionCanceledException";
}

/** DynamoDB implementation. It never scans: the sparse gsi5 is the queue. */
export class DynamoRetentionRepository implements RetentionRepository {
  constructor(private readonly doc: DynamoDBDocumentClient, private readonly tableName: string) {}

  async listDue(now: string): Promise<DueFile[]> {
    const due: DueFile[] = [];
    let cursor: Record<string, unknown> | undefined;
    do {
      const page = await this.doc.send(new QueryCommand({
        TableName: this.tableName,
        IndexName: "gsi5",
        KeyConditionExpression: "gsi5pk = :queue AND gsi5sk <= :due",
        ExpressionAttributeValues: { ":queue": "PURGE", ":due": `AT#${now}#~` },
        ExclusiveStartKey: cursor as never,
      }));
      for (const item of page.Items ?? []) {
        if (item.entity !== "FILE" || (item.state !== "trashed" && item.state !== "purging")) continue;
        if (typeof item.pk !== "string" || typeof item.sk !== "string" || typeof item.fileId !== "string" || typeof item.objectKey !== "string" || typeof item.sizeBytes !== "number") continue;
        due.push(item as DueFile);
      }
      cursor = page.LastEvaluatedKey as Record<string, unknown> | undefined;
    } while (cursor !== undefined);
    return due;
  }

  async claim(file: DueFile): Promise<boolean> {
    if (file.state === "purging") return true; // resume a worker interrupted after its safe S3 delete.
    try {
      await this.doc.send(new UpdateCommand({
        TableName: this.tableName,
        Key: { pk: file.pk, sk: file.sk },
        ConditionExpression: "entity = :file AND #state = :trashed AND gsi5pk = :queue",
        UpdateExpression: "SET #state = :purging",
        ExpressionAttributeNames: { "#state": "state" },
        ExpressionAttributeValues: { ":file": "FILE", ":trashed": "trashed", ":purging": "purging", ":queue": "PURGE" },
      }));
      return true;
    } catch (error) {
      if (isConditionalFailure(error)) return false;
      throw error;
    }
  }

  async finalize(file: DueFile): Promise<void> {
    const userPk = file.pk;
    await this.doc.send(new TransactWriteCommand({
      TransactItems: [
        {
          Delete: {
            TableName: this.tableName,
            Key: { pk: file.pk, sk: file.sk },
            ConditionExpression: "entity = :file AND #state = :purging",
            ExpressionAttributeNames: { "#state": "state" },
            ExpressionAttributeValues: { ":file": "FILE", ":purging": "purging" },
          },
        },
        {
          Update: {
            TableName: this.tableName,
            Key: { pk: userPk, sk: "PROFILE" },
            ConditionExpression: "entity = :profile AND usedBytes >= :size",
            UpdateExpression: "SET usedBytes = usedBytes - :size",
            ExpressionAttributeValues: { ":profile": "PROFILE", ":size": file.sizeBytes },
          },
        },
      ],
    }));
  }
}
