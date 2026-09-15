import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
} from "@aws-sdk/lib-dynamodb";
import type { ManifestRepository } from "../../handlers/manifest/src/repository.js";
import type { ManifestRecord } from "../../handlers/manifest/src/types.js";

/**
 * PROVISIONAL — flagged for review, not a silent decision.
 *
 * Every other handler package ships its own `Dynamo*Repository`; the manifest
 * package ships only `MemoryManifestRepository`, so `POST
 * /stashes/{id}/manifest-check` had no production persistence to construct.
 * Rather than leave the approved Addendum A2 route unwired, this adapter
 * implements the port EXACTLY as `manifest/src/repository.ts` documents it:
 *
 *   "`findByHash` is a point read on (pk = USER#<userId>, sk =
 *    MANIFEST#<hash>); `findByFolderName` is a per-user lookup by folder name."
 *
 * Two consequences the owning team should decide on, deliberately not decided
 * here:
 *
 * 1. This belongs in `services/handlers/manifest/`, beside its siblings and its
 *    own tests. It lives here only because this task may not edit that package.
 * 2. NOTHING in the control plane ever calls `putManifest`, so no MANIFEST
 *    record is ever written today. The endpoint is therefore wired and correct
 *    but will answer `match: "none"` for every real request until a writer
 *    exists. That is a product gap in the slice, not a defect in this adapter.
 *
 * Reads are scoped by `userId` from the verified claim (Rule 7): one creator's
 * manifest can never be reported to another, because it lives in another
 * partition entirely.
 */
export class DynamoManifestRepository implements ManifestRepository {
  constructor(
    private readonly doc: DynamoDBDocumentClient,
    private readonly tableName: string,
  ) {}

  async findByHash(
    userId: string,
    manifestHash: string,
  ): Promise<ManifestRecord | undefined> {
    const result = await this.doc.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { pk: `USER#${userId}`, sk: `MANIFEST#${manifestHash}` },
        ConsistentRead: true,
      }),
    );
    const item = result.Item as ManifestRecord | undefined;
    if (item === undefined || item.entity !== "MANIFEST") return undefined;
    return item;
  }

  async findByFolderName(
    userId: string,
    folderName: string,
  ): Promise<ManifestRecord[]> {
    const pk = `USER#${userId}`;
    const out: ManifestRecord[] = [];
    let cursor: Record<string, unknown> | undefined;

    // Every page is followed. Stopping at the first would hide a candidate
    // folder, and a missed candidate makes `checkManifest` under-report — the
    // safe direction, but still a wrong answer to the creator.
    do {
      const page = await this.doc.send(
        new QueryCommand({
          TableName: this.tableName,
          // Parameterized only: no caller value is concatenated into an
          // expression, matching the discipline of the sibling repositories.
          KeyConditionExpression: "pk = :pk AND begins_with(sk, :prefix)",
          // Folder names are compared as stored, byte for byte — DynamoDB does
          // not normalize, so NFC and NFD stay different names (Rule 1).
          FilterExpression: "folderName = :name",
          ExpressionAttributeValues: {
            ":pk": pk,
            ":prefix": "MANIFEST#",
            ":name": folderName,
          },
          ExclusiveStartKey: cursor as never,
        }),
      );
      for (const item of (page.Items ?? []) as ManifestRecord[]) {
        if (item.entity === "MANIFEST") out.push(item);
      }
      cursor = page.LastEvaluatedKey as Record<string, unknown> | undefined;
    } while (cursor !== undefined);

    return out;
  }

  async putManifest(record: ManifestRecord): Promise<void> {
    // Rule 8 discipline: create-only. A repeated manifest hash is the same
    // manifest, so overwriting it would be a no-op at best and a silent
    // rewrite of a creator's ingestion record at worst.
    await this.doc.send(
      new PutCommand({
        TableName: this.tableName,
        Item: record,
        ConditionExpression: "attribute_not_exists(pk)",
      }),
    );
  }
}
