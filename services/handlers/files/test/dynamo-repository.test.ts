import { beforeEach, describe, expect, it } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import {
  DynamoDBDocumentClient,
  GetCommand,
  QueryCommand,
  TransactWriteCommand,
} from "@aws-sdk/lib-dynamodb";
import {
  ConditionalCheckFailedException,
  TransactionCanceledException,
} from "@aws-sdk/client-dynamodb";
import {
  DynamoRepository,
  TRANSACT_ITEM_LIMIT,
} from "../src/dynamo-repository.js";
import type { EntityRecord, FileRecord, FolderRecord } from "../src/types.js";

const TABLE = "StashTable";
const ddb = mockClient(DynamoDBDocumentClient);

function repo(): DynamoRepository {
  return new DynamoRepository(ddb as unknown as DynamoDBDocumentClient, TABLE);
}

function folder(overrides: Partial<FolderRecord> = {}): FolderRecord {
  const folderId = overrides.folderId ?? "folder-1";
  return {
    pk: "USER#u1",
    sk: `FOLDER#${folderId}`,
    entity: "FOLDER",
    folderId,
    name: "Beats",
    parentFolderId: null,
    relativePath: "Beats",
    gsi1pk: "USER#u1#PARENT#ROOT",
    gsi1sk: "Beats",
    ...overrides,
  };
}

function file(overrides: Partial<FileRecord> = {}): FileRecord {
  const fileId = overrides.fileId ?? "file-1";
  return {
    pk: "USER#u1",
    sk: `FILE#${fileId}`,
    entity: "FILE",
    fileId,
    stashId: "stash-1",
    name: "kick.wav",
    parentFolderId: "folder-1",
    originalRelativePath: "Beats/kick.wav",
    sizeBytes: 10,
    checksum: "sum1",
    objectKey: `users/u1/${fileId}`,
    state: "pending",
    searchTokens: [],
    extractedMetadata: {},
    gsi1pk: "USER#u1#PARENT#folder-1",
    gsi1sk: "kick.wav",
    gsi2pk: "USER#u1#STASH#stash-1",
    gsi2sk: `FILE#${fileId}`,
    gsi3pk: "USER#u1#SUM#sum1",
    gsi3sk: `FILE#${fileId}`,
    ...overrides,
  };
}

beforeEach(() => ddb.reset());

describe("putEntities — folder identity", () => {
  it("writes the FOLDER item AND a guarded identity item in ONE transaction", async () => {
    ddb.on(TransactWriteCommand).resolves({});
    await repo().putEntities([folder()]);

    const calls = ddb.commandCalls(TransactWriteCommand);
    expect(calls).toHaveLength(1);
    const items = calls[0]!.args[0].input.TransactItems!;
    expect(items).toHaveLength(2);

    const folderPut = items.find(
      (i: any) => i.Put.Item.sk === "FOLDER#folder-1",
    );
    const identityPut = items.find((i: any) =>
      String(i.Put.Item.sk).startsWith("FOLDERID#"),
    );
    expect(folderPut).toBeDefined();
    expect(identityPut).toBeDefined();
    // The identity item is what makes concurrent creation safe.
    expect((identityPut as any).Put.ConditionExpression).toContain(
      "attribute_not_exists",
    );
    expect((identityPut as any).Put.Item.folderId).toBe("folder-1");
  });

  it("does not let a '#' in a folder name forge another folder's identity", async () => {
    ddb.on(TransactWriteCommand).resolves({});
    const r = repo();

    await r.putEntities([folder({ name: "a#b", folderId: "f1" })]);
    await r.putEntities([folder({ name: "a", folderId: "f2" })]);

    const sks = ddb
      .commandCalls(TransactWriteCommand)
      .flatMap((c) => c.args[0].input.TransactItems!)
      .map((i: any) => i.Put.Item.sk as string)
      .filter((sk: string) => sk.startsWith("FOLDERID#"));

    expect(new Set(sks).size).toBe(2);
  });

  it("rejects the WHOLE batch when one identity repeats inside it, writing nothing", async () => {
    ddb.on(TransactWriteCommand).resolves({});
    const dup = [folder({ folderId: "f1" }), folder({ folderId: "f2" }), file()];
    await expect(repo().putEntities(dup)).rejects.toMatchObject({
      status: 409,
    });
    expect(ddb.commandCalls(TransactWriteCommand)).toHaveLength(0);
  });

  it("maps a losing conditional write (concurrent creator) to 409, not 500", async () => {
    ddb
      .on(TransactWriteCommand)
      .rejects(
        new ConditionalCheckFailedException({ $metadata: {}, message: "boom" }),
      );
    await expect(repo().putEntities([folder()])).rejects.toMatchObject({
      status: 409,
    });
  });

  it("maps a cancelled TRANSACTION to 409 — the error DynamoDB really returns", async () => {
    // A transactional guard that loses surfaces as TransactionCanceledException
    // with a ConditionalCheckFailed reason, NOT as ConditionalCheckFailedException.
    // Handling only the latter would turn a routine race into a 500.
    ddb.on(TransactWriteCommand).rejects(
      new TransactionCanceledException({
        $metadata: {},
        message: "cancelled",
        CancellationReasons: [
          { Code: "None" },
          { Code: "ConditionalCheckFailed" },
        ],
      }),
    );
    await expect(repo().putEntities([folder()])).rejects.toMatchObject({
      status: 409,
    });
  });

  it("does NOT swallow an unrelated DynamoDB failure as a 409", async () => {
    ddb.on(TransactWriteCommand).rejects(new Error("throughput exceeded"));
    await expect(repo().putEntities([folder()])).rejects.toThrow(
      "throughput exceeded",
    );
  });

  it("refuses to overwrite an existing key (Rule 8: versioning is off)", async () => {
    ddb.on(TransactWriteCommand).resolves({});
    await repo().putEntities([file()]);
    const items = ddb.commandCalls(TransactWriteCommand)[0]!.args[0].input
      .TransactItems!;
    const filePut = items.find((i: any) => i.Put.Item.sk === "FILE#file-1");
    expect((filePut as any).Put.ConditionExpression).toContain(
      "attribute_not_exists",
    );
  });

  it("rejects a batch too large to stay atomic instead of silently splitting it", async () => {
    ddb.on(TransactWriteCommand).resolves({});
    const many: EntityRecord[] = Array.from(
      { length: TRANSACT_ITEM_LIMIT + 1 },
      (_, n) => file({ fileId: `f${n}`, sk: `FILE#f${n}` }),
    );
    await expect(repo().putEntities(many)).rejects.toMatchObject({
      status: 400,
    });
    expect(ddb.commandCalls(TransactWriteCommand)).toHaveLength(0);
  });

  it("writes nothing at all for an empty batch", async () => {
    await repo().putEntities([]);
    expect(ddb.commandCalls(TransactWriteCommand)).toHaveLength(0);
  });
});

describe("listChildren", () => {
  it("follows every page — a large folder must not silently truncate", async () => {
    ddb
      .on(QueryCommand)
      .resolvesOnce({
        Items: [file({ fileId: "a" })],
        LastEvaluatedKey: { pk: "x" },
      })
      .resolvesOnce({ Items: [file({ fileId: "b" })] });

    const out = await repo().listChildren("u1", "folder-1");
    expect(out.map((i) => (i as FileRecord).fileId)).toEqual(["a", "b"]);
    expect(ddb.commandCalls(QueryCommand)).toHaveLength(2);
  });

  it("queries gsi1 scoped to the caller's own partition", async () => {
    ddb.on(QueryCommand).resolves({ Items: [] });
    await repo().listChildren("u1", null);
    const input = ddb.commandCalls(QueryCommand)[0]!.args[0].input;
    expect(input.IndexName).toBe("gsi1");
    expect(JSON.stringify(input.ExpressionAttributeValues)).toContain(
      "USER#u1#PARENT#ROOT",
    );
  });
});

describe("findFolder", () => {
  it("resolves identity -> folder record", async () => {
    ddb
      .on(GetCommand)
      .resolvesOnce({ Item: { folderId: "folder-1" } })
      .resolvesOnce({ Item: folder() });

    const found = await repo().findFolder("u1", null, "Beats");
    expect(found?.folderId).toBe("folder-1");
  });

  it("returns undefined when no identity exists, without a second read", async () => {
    ddb.on(GetCommand).resolves({});
    expect(await repo().findFolder("u1", null, "Nope")).toBeUndefined();
    expect(ddb.commandCalls(GetCommand)).toHaveLength(1);
  });
});

describe("findFolderById — tenant isolation", () => {
  it("returns undefined for a folder in another creator's partition", async () => {
    ddb.on(GetCommand).resolves({});
    expect(await repo().findFolderById("attacker", "folder-1")).toBeUndefined();
    const input = ddb.commandCalls(GetCommand)[0]!.args[0].input;
    expect(input.Key).toMatchObject({ pk: "USER#attacker" });
  });

  it("ignores an item that is not a FOLDER", async () => {
    ddb
      .on(GetCommand)
      .resolves({ Item: file() as unknown as Record<string, unknown> });
    expect(await repo().findFolderById("u1", "folder-1")).toBeUndefined();
  });
});

describe("idempotency", () => {
  it("round-trips a stored result", async () => {
    ddb.on(TransactWriteCommand).resolves({});
    await repo().putIdempotentResult("u1", "s1", "k1", {
      statusCode: 201,
      body: "{}",
    });
    ddb.on(GetCommand).resolves({ Item: { statusCode: 201, body: "{}" } });
    expect(await repo().getIdempotentResult("u1", "s1", "k1")).toEqual({
      statusCode: 201,
      body: "{}",
    });
  });

  it("returns undefined for an unseen key", async () => {
    ddb.on(GetCommand).resolves({});
    expect(await repo().getIdempotentResult("u1", "s1", "never")).toBeUndefined();
  });
});
