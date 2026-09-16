import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
} from "@aws-sdk/lib-dynamodb";
import type { ManifestRepository } from "./repository.js";
import type { ManifestRecord } from "./types.js";

/**
 * DynamoDB implementation of the manifest persistence port.
 *
 * Reads are addressed by the JWT-derived user partition. Folder-name discovery
 * follows every Query page: truncation would let checkManifest decide with
 * unseen candidates.
 */
export class DynamoManifestRepository implements ManifestRepository {
  constructor(
    private readonly doc: DynamoDBDocumentClient,
    private readonly tableName: string,
  ) {}

  async findByHash(userId: string, manifestHash: string): Promise<ManifestRecord | undefined> {
    const result = await this.doc.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { pk: `USER#${userId}`, sk: `MANIFEST#${manifestHash}` },
        ConsistentRead: true,
      }),
    );
    const item = result.Item as ManifestRecord | undefined;
    return item?.entity === "MANIFEST" ? item : undefined;
  }

  async findByFolderName(userId: string, folderName: string): Promise<ManifestRecord[]> {
    const pk = `USER#${userId}`;
    const records: ManifestRecord[] = [];
    let cursor: Record<string, unknown> | undefined;

    do {
      const page = await this.doc.send(
        new QueryCommand({
          TableName: this.tableName,
          KeyConditionExpression: "pk = :pk AND begins_with(sk, :prefix)",
          FilterExpression: "folderName = :name",
          ExpressionAttributeValues: { ":pk": pk, ":prefix": "MANIFEST#", ":name": folderName },
          ExclusiveStartKey: cursor as never,
        }),
      );
      for (const item of (page.Items ?? []) as ManifestRecord[]) {
        if (item.entity === "MANIFEST") records.push(item);
      }
      cursor = page.LastEvaluatedKey as Record<string, unknown> | undefined;
    } while (cursor !== undefined);

    return records;
  }

  async putManifest(record: ManifestRecord): Promise<void> {
    await this.doc.send(
      new PutCommand({
        TableName: this.tableName,
        Item: record,
        ConditionExpression: "attribute_not_exists(pk)",
      }),
    );
  }
}
