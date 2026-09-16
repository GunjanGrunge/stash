import {
  DynamoDBDocumentClient,
  GetCommand,
  QueryCommand,
} from "@aws-sdk/lib-dynamodb";
import type { ReadRepository } from "./repository.js";
import type { StashRecord, UsageRecord } from "./types.js";
import { readUsage } from "./usage.js";

/**
 * The DynamoDB implementation of the read-only port behind Recent Stashes
 * and the storage indicator.
 *
 * Both reads are addressed by `pk = USER#<user_id>`, where the user_id comes
 * from the verified JWT claim (Rule 7). Another creator's items live in
 * another partition, so a cross-tenant read is not merely denied — it is
 * unaddressable (Spec §3.2).
 */
export class DynamoReadRepository implements ReadRepository {
  constructor(
    private readonly doc: DynamoDBDocumentClient,
    private readonly tableName: string,
  ) {}

  async listStashes(userId: string): Promise<StashRecord[]> {
    const pk = `USER#${userId}`;
    const out: StashRecord[] = [];
    let cursor: Record<string, unknown> | undefined;

    // A creator with many Stashes spans several 1 MB pages. Returning only
    // the first would silently hide their own ingestion history, so follow
    // every page — exactly as `listChildren` does for folder contents.
    // An empty page is NOT a stop condition: DynamoDB may return one while
    // still carrying a LastEvaluatedKey.
    do {
      const page = await this.doc.send(
        new QueryCommand({
          TableName: this.tableName,
          // Rule 4 / invariant 4: parameterized only. No caller-supplied
          // value is ever concatenated into an expression.
          KeyConditionExpression: "pk = :pk AND begins_with(sk, :skPrefix)",
          ExpressionAttributeValues: { ":pk": pk, ":skPrefix": "STASH#" },
          ExclusiveStartKey: cursor as never,
        }),
      );
      for (const item of (page.Items ?? []) as Array<Record<string, unknown>>) {
        // Rule 2: only Stash records belong in Recent Stashes. A File or
        // Folder record must never be presented as an ingestion event.
        if (item["entity"] !== "STASH") continue;
        out.push(item as unknown as StashRecord);
      }
      cursor = page.LastEvaluatedKey as Record<string, unknown> | undefined;
    } while (cursor !== undefined);

    return out;
  }

  async getUsage(userId: string): Promise<UsageRecord | undefined> {
    const result = await this.doc.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { pk: `USER#${userId}`, sk: "PROFILE" },
        // The indicator must not lag a Stash that just completed.
        ConsistentRead: true,
      }),
    );
    return readUsage(result.Item as Record<string, unknown> | undefined);
  }
}
