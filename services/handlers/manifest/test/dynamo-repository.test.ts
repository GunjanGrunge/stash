import { beforeEach, describe, expect, it } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
} from "@aws-sdk/lib-dynamodb";
import { DynamoManifestRepository } from "../src/dynamo-repository.js";
import { checkManifest } from "../src/check-manifest.js";
import type { ManifestRecord } from "../src/types.js";

const TABLE = "StashTable";
const ddb = mockClient(DynamoDBDocumentClient);

function repo(): DynamoManifestRepository {
  return new DynamoManifestRepository(ddb as unknown as DynamoDBDocumentClient, TABLE);
}

function record(overrides: Partial<ManifestRecord> = {}): ManifestRecord {
  return {
    pk: "USER#u1",
    sk: "MANIFEST#hash-1",
    entity: "MANIFEST",
    manifestHash: "hash-1",
    folderId: "folder-1",
    folderName: "Sample Pack",
    fileCount: 1,
    totalBytes: 42,
    entries: [{ relativePath: "kick.wav", sizeBytes: 42, checksum: "sum-1" }],
    ...overrides,
  };
}

beforeEach(() => ddb.reset());

describe("DynamoManifestRepository", () => {
  it("point-reads an exact manifest only from the caller's partition", async () => {
    ddb.on(GetCommand).resolves({ Item: record() });

    await expect(repo().findByHash("u1", "hash-1")).resolves.toMatchObject({ folderId: "folder-1" });
    expect(ddb.commandCalls(GetCommand)[0]!.args[0].input).toMatchObject({
      TableName: TABLE,
      Key: { pk: "USER#u1", sk: "MANIFEST#hash-1" },
      ConsistentRead: true,
    });
  });

  it("follows every folder-name query page before reporting candidates", async () => {
    ddb.on(QueryCommand)
      .resolvesOnce({ Items: [record()], LastEvaluatedKey: { pk: "next" } })
      .resolvesOnce({ Items: [record({ manifestHash: "hash-2", sk: "MANIFEST#hash-2" })] });

    const found = await repo().findByFolderName("u1", "Sample Pack");
    expect(found.map((item) => item.manifestHash)).toEqual(["hash-1", "hash-2"]);
    expect(ddb.commandCalls(QueryCommand)).toHaveLength(2);
    expect(ddb.commandCalls(QueryCommand)[0]!.args[0].input.ExpressionAttributeValues).toMatchObject({
      ":pk": "USER#u1", ":prefix": "MANIFEST#", ":name": "Sample Pack",
    });
  });

  it("creates a verified manifest without allowing an overwrite", async () => {
    ddb.on(PutCommand).resolves({});
    await repo().putManifest(record());
    expect(ddb.commandCalls(PutCommand)[0]!.args[0].input).toMatchObject({
      TableName: TABLE,
      Item: record(),
      ConditionExpression: "attribute_not_exists(pk)",
    });
  });

  it("serves exact and partial results through the production adapter", async () => {
    const stored = record({
      entries: [
        { relativePath: "kick.wav", sizeBytes: 42, checksum: "sum-1" },
        { relativePath: "snare.wav", sizeBytes: 8, checksum: "sum-2" },
      ],
      fileCount: 2,
      totalBytes: 50,
    });
    ddb.on(GetCommand).resolves({ Item: stored });
    const handler = checkManifest({ repo: repo() });
    const event = (entries: unknown) => ({
      requestContext: { authorizer: { jwt: { claims: { sub: "u1" } } } },
      body: JSON.stringify({ folderName: "Sample Pack", entries }),
    });

    const exact = await handler(event(stored.entries) as any);
    expect(JSON.parse(exact.body)).toMatchObject({ match: "exact", folderId: "folder-1" });

    ddb.reset();
    ddb.on(GetCommand).resolves({});
    ddb.on(QueryCommand).resolves({ Items: [stored] });
    const partial = await handler(event([...stored.entries, {
      relativePath: "hat.wav", sizeBytes: 5, checksum: "sum-3",
    }]) as any);
    expect(JSON.parse(partial.body)).toMatchObject({
      match: "partial", existingCount: 2, newBytes: 5,
    });
  });
});
