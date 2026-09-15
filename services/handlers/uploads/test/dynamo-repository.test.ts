import { beforeEach, describe, expect, it } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import {
  DynamoDBDocumentClient,
  GetCommand,
  TransactWriteCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import {
  ConditionalCheckFailedException,
  TransactionCanceledException,
} from "@aws-sdk/client-dynamodb";
import { DynamoUploadRepository } from "../src/dynamo-repository.js";
import type { UploadFileRecord } from "../src/types.js";

const TABLE = "StashTable";
const ddb = mockClient(DynamoDBDocumentClient);

function repo(): DynamoUploadRepository {
  return new DynamoUploadRepository(
    ddb as unknown as DynamoDBDocumentClient,
    TABLE,
  );
}

const FILE: UploadFileRecord = {
  pk: "USER#u1",
  sk: "FILE#f1",
  entity: "FILE",
  fileId: "f1",
  stashId: "stash-1",
  objectKey: "users/u1/f1",
  sizeBytes: 4_200_000_000,
  checksum: "sum",
  state: "uploading",
  uploadId: "mpu-1",
};

function conditionFailure(): Error {
  return new ConditionalCheckFailedException({ message: "failed", $metadata: {} });
}

function transactionCancelled(): Error {
  return new TransactionCanceledException({
    message: "cancelled",
    $metadata: {},
    CancellationReasons: [{ Code: "ConditionalCheckFailed" }, { Code: "None" }],
  });
}

/** Every expression must be parameterized — invariant 4. */
function assertParameterized(input: Record<string, any>): void {
  const expressions = [
    input["ConditionExpression"],
    input["UpdateExpression"],
    input["KeyConditionExpression"],
    input["ProjectionExpression"],
  ].filter((e): e is string => typeof e === "string");

  expect(expressions.length).toBeGreaterThan(0);
  for (const expr of expressions) {
    // No literal from the record may appear inline; only #names and :values.
    expect(expr).not.toContain("u1");
    expect(expr).not.toContain("f1");
    expect(expr).not.toContain("users/");
    expect(expr).not.toContain("uploading'");
    expect(expr).not.toContain('"');
  }
}

beforeEach(() => ddb.reset());

describe("findFile", () => {
  it("reads a point key inside the caller's OWN partition", async () => {
    ddb.on(GetCommand).resolves({ Item: FILE });
    const found = await repo().findFile("u1", "f1");

    expect(found).toEqual(FILE);
    const input = ddb.commandCalls(GetCommand)[0]!.args[0].input;
    expect(input.Key).toEqual({ pk: "USER#u1", sk: "FILE#f1" });
    // A stale read here would let a file commit twice or abort after commit.
    expect(input.ConsistentRead).toBe(true);
  });

  it("returns undefined for another creator's file — unaddressable, not denied", async () => {
    ddb.on(GetCommand).resolves({});
    expect(await repo().findFile("u2", "f1")).toBeUndefined();
    expect(ddb.commandCalls(GetCommand)[0]!.args[0].input.Key).toEqual({
      pk: "USER#u2",
      sk: "FILE#f1",
    });
  });

  it("ignores an item that is not a FILE", async () => {
    ddb.on(GetCommand).resolves({ Item: { pk: "USER#u1", sk: "FILE#f1", entity: "FOLDER" } });
    expect(await repo().findFile("u1", "f1")).toBeUndefined();
  });
});

describe("beginUpload — conditional pending -> uploading", () => {
  it("guards on state = pending and records the upload id", async () => {
    ddb.on(UpdateCommand).resolves({});
    expect(await repo().beginUpload("u1", "f1", "mpu-1")).toBe(true);

    const input = ddb.commandCalls(UpdateCommand)[0]!.args[0].input;
    expect(input.Key).toEqual({ pk: "USER#u1", sk: "FILE#f1" });
    expect(input.ConditionExpression).toContain("#state = :pending");
    expect(input.ExpressionAttributeValues![":pending"]).toBe("pending");
    expect(input.ExpressionAttributeValues![":uploading"]).toBe("uploading");
    expect(input.ExpressionAttributeValues![":uploadId"]).toBe("mpu-1");
    assertParameterized(input as Record<string, any>);
  });

  it("returns false — not an error — when the guard loses", async () => {
    ddb.on(UpdateCommand).rejects(conditionFailure());
    expect(await repo().beginUpload("u1", "f1", "mpu-1")).toBe(false);
  });

  it("rethrows a non-condition failure so the caller does not assume an outcome", async () => {
    ddb.on(UpdateCommand).rejects(new Error("ProvisionedThroughputExceeded"));
    await expect(repo().beginUpload("u1", "f1", "mpu-1")).rejects.toThrow();
  });
});

describe("commitFile — Rule 4: the only transition into committed", () => {
  it("is conditional on state = uploading", async () => {
    ddb.on(UpdateCommand).resolves({});
    expect(await repo().commitFile("u1", "f1")).toBe(true);

    const input = ddb.commandCalls(UpdateCommand)[0]!.args[0].input;
    expect(input.ConditionExpression).toContain("#state = :uploading");
    expect(input.ExpressionAttributeValues![":uploading"]).toBe("uploading");
    expect(input.ExpressionAttributeValues![":committed"]).toBe("committed");
    assertParameterized(input as Record<string, any>);
  });

  it("returns false when the file is no longer uploading", async () => {
    ddb.on(UpdateCommand).rejects(conditionFailure());
    expect(await repo().commitFile("u1", "f1")).toBe(false);
  });

  it("rethrows a transient failure — the file must stay uploading (spec §5)", async () => {
    ddb.on(UpdateCommand).rejects(new Error("InternalServerError"));
    await expect(repo().commitFile("u1", "f1")).rejects.toThrow();
  });
});

describe("failFile", () => {
  it("is conditional on state = uploading", async () => {
    ddb.on(UpdateCommand).resolves({});
    expect(await repo().failFile("u1", "f1")).toBe(true);
    const input = ddb.commandCalls(UpdateCommand)[0]!.args[0].input;
    expect(input.ConditionExpression).toContain("#state = :uploading");
    expect(input.ExpressionAttributeValues![":failed"]).toBe("failed");
    assertParameterized(input as Record<string, any>);
  });
});

describe("abortAndReleaseQuota — atomic, at most once", () => {
  it("flips the file and decrements usedBytes in ONE transaction", async () => {
    ddb.on(TransactWriteCommand).resolves({});
    expect(await repo().abortAndReleaseQuota("u1", "f1", 4_200_000_000)).toBe(true);

    const items = ddb.commandCalls(TransactWriteCommand)[0]!.args[0].input
      .TransactItems! as any[];
    expect(items).toHaveLength(2);

    const fileUpdate = items[0].Update;
    expect(fileUpdate.Key).toEqual({ pk: "USER#u1", sk: "FILE#f1" });
    // The once-only guard: a second abort finds quotaReleased set and loses.
    expect(fileUpdate.ConditionExpression).toContain("attribute_not_exists(#quotaReleased)");
    expect(fileUpdate.ConditionExpression).toContain("#state <> :committed");
    assertParameterized(fileUpdate);

    const profileUpdate = items[1].Update;
    expect(profileUpdate.Key).toEqual({ pk: "USER#u1", sk: "PROFILE" });
    expect(profileUpdate.UpdateExpression).toContain("#usedBytes - :n");
    // usedBytes must never be driven negative by a stray refund.
    expect(profileUpdate.ConditionExpression).toContain("#usedBytes >= :n");
    expect(profileUpdate.ExpressionAttributeValues[":n"]).toBe(4_200_000_000);
    assertParameterized(profileUpdate);
  });

  it("returns false when the once-only guard has already been spent", async () => {
    ddb.on(TransactWriteCommand).rejects(transactionCancelled());
    expect(await repo().abortAndReleaseQuota("u1", "f1", 1)).toBe(false);
  });

  it("rethrows a non-condition transaction failure", async () => {
    ddb.on(TransactWriteCommand).rejects(new Error("ThrottlingException"));
    await expect(repo().abortAndReleaseQuota("u1", "f1", 1)).rejects.toThrow();
  });
});

describe("idempotency records", () => {
  it("keys on hex-encoded (fileId, key) so no component can forge another", async () => {
    ddb.on(TransactWriteCommand).resolves({});
    await repo().putIdempotentResult("u1", "f#1", "k", { statusCode: 200, body: "{}" });

    const items = ddb.commandCalls(TransactWriteCommand)[0]!.args[0].input
      .TransactItems! as any[];
    const sk: string = items[0].Put.Item.sk;
    expect(sk.startsWith("IDEMPOTENCY#")).toBe(true);
    // Raw `f#1` would collide with fileId `f` + key `1`.
    expect(sk).not.toContain("f#1");
    expect(sk).toContain(Buffer.from("f#1", "utf8").toString("hex"));
  });

  it("reads back a stored result", async () => {
    ddb.on(GetCommand).resolves({
      Item: { statusCode: 200, body: '{"ok":true}' },
    });
    expect(await repo().getIdempotentResult("u1", "f1", "k")).toEqual({
      statusCode: 200,
      body: '{"ok":true}',
    });
  });

  it("treats a malformed stored result as absent rather than replaying garbage", async () => {
    ddb.on(GetCommand).resolves({ Item: { statusCode: "200", body: 7 } });
    expect(await repo().getIdempotentResult("u1", "f1", "k")).toBeUndefined();
  });
});
