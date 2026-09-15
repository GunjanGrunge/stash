import { beforeEach, describe, expect, it } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  QueryCommand,
  TransactWriteCommand,
} from "@aws-sdk/lib-dynamodb";
import { TransactionCanceledException } from "@aws-sdk/client-dynamodb";
import { DynamoStashRepository } from "../src/dynamo-repository.js";
import type { StashRecord } from "../src/types.js";

const TABLE = "StashTable";
const USER = "u1";
const ddb = mockClient(DynamoDBDocumentClient);

function repo(): DynamoStashRepository {
  return new DynamoStashRepository(
    ddb as unknown as DynamoDBDocumentClient,
    TABLE,
  );
}

function stash(overrides: Partial<StashRecord> = {}): StashRecord {
  const stashId = overrides.stashId ?? "s1";
  return {
    pk: `USER#${USER}`,
    sk: `STASH#${stashId}`,
    entity: "STASH",
    stashId,
    state: "open",
    fileCount: 3,
    committedCount: 0,
    reservedBytes: 400,
    committedBytes: 0,
    startedAt: "2026-09-15T00:00:00.000Z",
    updatedAt: "2026-09-15T00:00:00.000Z",
    ...overrides,
  };
}

function cancelled(reasons: ("None" | "ConditionalCheckFailed")[]) {
  return new TransactionCanceledException({
    message: "Transaction cancelled",
    $metadata: {},
    CancellationReasons: reasons.map((Code) => ({ Code })),
  });
}

function profileItem(quotaBytes: number, usedBytes: number) {
  return { Item: { pk: `USER#${USER}`, sk: "PROFILE", quotaBytes, usedBytes } };
}

/** Every value referenced by an expression must arrive as a parameter. */
function assertParameterized(expr: string | undefined, values: Record<string, unknown>): void {
  if (expr === undefined) return;
  for (const name of expr.match(/:[A-Za-z0-9_]+/g) ?? []) {
    expect(Object.keys(values)).toContain(name);
  }
}

beforeEach(() => ddb.reset());

describe("DynamoStashRepository.createStash", () => {
  it("writes the Stash and the reservation in ONE transaction", async () => {
    ddb.on(GetCommand).resolves(profileItem(1_000, 100));
    ddb.on(TransactWriteCommand).resolves({});

    await repo().createStash({
      userId: USER,
      stash: stash(),
      reserveBytes: 400,
    });

    const calls = ddb.commandCalls(TransactWriteCommand);
    expect(calls).toHaveLength(1);
    const items = calls[0]!.args[0].input.TransactItems as any[];
    expect(items).toHaveLength(2);

    // 1. the Stash record, create-only.
    expect(items[0].Put.TableName).toBe(TABLE);
    expect(items[0].Put.Item).toMatchObject({
      pk: `USER#${USER}`,
      sk: "STASH#s1",
      state: "open",
      reservedBytes: 400,
    });
    expect(items[0].Put.ConditionExpression).toBe("attribute_not_exists(pk)");

    // 2. the conditional reservation on the profile.
    const update = items[1].Update;
    expect(update.Key).toEqual({ pk: `USER#${USER}`, sk: "PROFILE" });
    expect(update.UpdateExpression).toBe("SET usedBytes = usedBytes + :n");
    expect(update.ConditionExpression).toContain("attribute_exists(pk)");
    // The server decides, from the profile's own attributes.
    expect(update.ConditionExpression).toContain("usedBytes <= :maxUsed");
    expect(update.ConditionExpression).toContain("quotaBytes = :quota");
    expect(update.ExpressionAttributeValues).toEqual({
      ":n": 400,
      ":maxUsed": 600,
      ":quota": 1_000,
    });
    assertParameterized(update.ConditionExpression, update.ExpressionAttributeValues);
    assertParameterized(update.UpdateExpression, update.ExpressionAttributeValues);
  });

  it("carries the replay record inside the SAME transaction", async () => {
    ddb.on(GetCommand).resolves(profileItem(1_000, 0));
    ddb.on(TransactWriteCommand).resolves({});

    await repo().createStash({
      userId: USER,
      stash: stash(),
      reserveBytes: 400,
      idempotency: { key: "k1", result: { statusCode: 201, body: "{}" } },
    });

    const items = ddb.commandCalls(TransactWriteCommand)[0]!.args[0].input
      .TransactItems as any[];
    expect(items).toHaveLength(3);
    expect(items[2].Put.Item).toMatchObject({
      pk: `USER#${USER}`,
      entity: "IDEMPOTENCY",
      statusCode: 201,
      body: "{}",
    });
    // Hex-encoded components, so no creator-supplied string can forge a key.
    expect(items[2].Put.Item.sk).toMatch(/^IDEMPOTENCY#[0-9a-f]+#[0-9a-f]+$/);
  });

  it("maps a lost reservation condition to 507 and writes nothing", async () => {
    ddb.on(GetCommand).resolves(profileItem(1_000, 900));
    ddb.on(TransactWriteCommand).rejects(cancelled(["None", "ConditionalCheckFailed"]));

    await expect(
      repo().createStash({ userId: USER, stash: stash(), reserveBytes: 400 }),
    ).rejects.toMatchObject({ status: 507, code: "quota_exceeded" });
  });

  it("maps a lost Stash-uniqueness condition to 409", async () => {
    ddb.on(GetCommand).resolves(profileItem(1_000, 0));
    ddb.on(TransactWriteCommand).rejects(cancelled(["ConditionalCheckFailed", "None"]));

    await expect(
      repo().createStash({ userId: USER, stash: stash(), reserveBytes: 400 }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it("fails closed with 507 when the caller has no profile — no transaction is attempted", async () => {
    ddb.on(GetCommand).resolves({});

    await expect(
      repo().createStash({ userId: USER, stash: stash(), reserveBytes: 1 }),
    ).rejects.toMatchObject({ status: 507 });
    expect(ddb.commandCalls(TransactWriteCommand)).toHaveLength(0);
  });

  it("refuses a reservation that already exceeds quota without a round trip", async () => {
    ddb.on(GetCommand).resolves(profileItem(1_000, 900));

    await expect(
      repo().createStash({ userId: USER, stash: stash(), reserveBytes: 101 }),
    ).rejects.toMatchObject({ status: 507 });
    expect(ddb.commandCalls(TransactWriteCommand)).toHaveLength(0);
  });
});

describe("DynamoStashRepository.cancelStash", () => {
  it("guards the state flip and the release in ONE transaction", async () => {
    ddb.on(TransactWriteCommand).resolves({});

    await repo().cancelStash({ userId: USER, stashId: "s1", releaseBytes: 400 });

    const items = ddb.commandCalls(TransactWriteCommand)[0]!.args[0].input
      .TransactItems as any[];
    expect(items).toHaveLength(2);

    const flip = items[0].Update;
    expect(flip.Key).toEqual({ pk: `USER#${USER}`, sk: "STASH#s1" });
    // `state` is a DynamoDB reserved word, so it can only appear as a name ref.
    expect(flip.ExpressionAttributeNames).toMatchObject({ "#state": "state" });
    expect(flip.UpdateExpression).toContain("#state = :cancelled");
    // THE guard: without it a second cancel releases the same bytes again.
    expect(flip.ConditionExpression).toContain("#state = :open");
    expect(flip.ExpressionAttributeValues[":open"]).toBe("open");
    expect(flip.ExpressionAttributeValues[":cancelled"]).toBe("cancelled");
    assertParameterized(flip.ConditionExpression, flip.ExpressionAttributeValues);

    const release = items[1].Update;
    expect(release.Key).toEqual({ pk: `USER#${USER}`, sk: "PROFILE" });
    expect(release.UpdateExpression).toBe("SET usedBytes = usedBytes - :n");
    // usedBytes must never go negative.
    expect(release.ConditionExpression).toContain("usedBytes >= :n");
    expect(release.ExpressionAttributeValues).toEqual({ ":n": 400 });
  });

  it("maps a lost guard to 409 — the double-cancel outcome", async () => {
    ddb.on(TransactWriteCommand).rejects(cancelled(["ConditionalCheckFailed", "None"]));

    await expect(
      repo().cancelStash({ userId: USER, stashId: "s1", releaseBytes: 400 }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it("skips the profile write entirely when there is nothing to release", async () => {
    ddb.on(TransactWriteCommand).resolves({});

    await repo().cancelStash({ userId: USER, stashId: "s1", releaseBytes: 0 });

    const items = ddb.commandCalls(TransactWriteCommand)[0]!.args[0].input
      .TransactItems as any[];
    expect(items).toHaveLength(1);
  });
});

describe("DynamoStashRepository.completeStash", () => {
  it("reconciles downward with a subtraction guarded by the same open check", async () => {
    ddb.on(TransactWriteCommand).resolves({});

    await repo().completeStash({
      userId: USER,
      stashId: "s1",
      deltaBytes: -400,
      committedCount: 2,
      committedBytes: 600,
    });

    const items = ddb.commandCalls(TransactWriteCommand)[0]!.args[0].input
      .TransactItems as any[];
    const flip = items[0].Update;
    expect(flip.UpdateExpression).toContain("#state = :completed");
    expect(flip.UpdateExpression).toContain("committedCount = :cc");
    expect(flip.UpdateExpression).toContain("committedBytes = :cb");
    expect(flip.ConditionExpression).toContain("#state = :open");
    expect(flip.ExpressionAttributeValues).toMatchObject({ ":cc": 2, ":cb": 600 });

    const reconcile = items[1].Update;
    expect(reconcile.UpdateExpression).toBe("SET usedBytes = usedBytes - :n");
    expect(reconcile.ExpressionAttributeValues).toEqual({ ":n": 400 });
    expect(reconcile.ConditionExpression).toContain("usedBytes >= :n");
  });

  it("reconciles upward with an addition and no quota veto", async () => {
    ddb.on(TransactWriteCommand).resolves({});

    await repo().completeStash({
      userId: USER,
      stashId: "s1",
      deltaBytes: 400,
      committedCount: 1,
      committedBytes: 1_000,
    });

    const items = ddb.commandCalls(TransactWriteCommand)[0]!.args[0].input
      .TransactItems as any[];
    const reconcile = items[1].Update;
    expect(reconcile.UpdateExpression).toBe("SET usedBytes = usedBytes + :n");
    expect(reconcile.ExpressionAttributeValues).toEqual({ ":n": 400 });
    // The bytes are already in S3; refusing to record them would make
    // usedBytes lie about real storage.
    expect(reconcile.ConditionExpression).toBeUndefined();
  });

  it("writes only the Stash when the reservation was already exact", async () => {
    ddb.on(TransactWriteCommand).resolves({});

    await repo().completeStash({
      userId: USER,
      stashId: "s1",
      deltaBytes: 0,
      committedCount: 1,
      committedBytes: 500,
    });

    const items = ddb.commandCalls(TransactWriteCommand)[0]!.args[0].input
      .TransactItems as any[];
    expect(items).toHaveLength(1);
  });

  it("maps a lost guard to 409", async () => {
    ddb.on(TransactWriteCommand).rejects(cancelled(["ConditionalCheckFailed"]));

    await expect(
      repo().completeStash({
        userId: USER,
        stashId: "s1",
        deltaBytes: 0,
        committedCount: 0,
        committedBytes: 0,
      }),
    ).rejects.toMatchObject({ status: 409 });
  });
});

describe("DynamoStashRepository reads", () => {
  it("reads a Stash from the caller's own partition only", async () => {
    ddb.on(GetCommand).resolves({ Item: stash() });

    const found = await repo().getStash(USER, "s1");

    expect(found?.stashId).toBe("s1");
    expect(ddb.commandCalls(GetCommand)[0]!.args[0].input.Key).toEqual({
      pk: `USER#${USER}`,
      sk: "STASH#s1",
    });
  });

  it("returns undefined for an item that is not a Stash", async () => {
    ddb.on(GetCommand).resolves({ Item: { pk: `USER#${USER}`, sk: "STASH#s1", entity: "FILE" } });
    expect(await repo().getStash(USER, "s1")).toBeUndefined();
  });

  it("returns undefined when the Stash belongs to someone else (404 upstream)", async () => {
    ddb.on(GetCommand).resolves({});
    expect(await repo().getStash("intruder", "s1")).toBeUndefined();
    expect(ddb.commandCalls(GetCommand)[0]!.args[0].input.Key).toEqual({
      pk: "USER#intruder",
      sk: "STASH#s1",
    });
  });

  it("lists a Stash's files through GSI2, following every page", async () => {
    ddb
      .on(QueryCommand)
      .resolvesOnce({
        Items: [{ fileId: "a", state: "committed", sizeBytes: 10 }],
        LastEvaluatedKey: { pk: "x" },
      })
      .resolvesOnce({
        Items: [{ fileId: "b", state: "pending", sizeBytes: 20 }],
      });

    const files = await repo().listStashFiles(USER, "s1");

    expect(files.map((f) => f.fileId)).toEqual(["a", "b"]);
    const input = ddb.commandCalls(QueryCommand)[0]!.args[0].input as any;
    expect(input.IndexName).toBe("gsi2");
    expect(input.KeyConditionExpression).toBe("gsi2pk = :gsi2pk");
    expect(input.ExpressionAttributeValues).toEqual({
      ":gsi2pk": `USER#${USER}#STASH#s1`,
      ":pk": `USER#${USER}`,
    });
    // Defence in depth: gsi2pk already embeds the caller.
    expect(input.FilterExpression).toBe("pk = :pk");
    assertParameterized(input.KeyConditionExpression, input.ExpressionAttributeValues);
  });

  it("reads an idempotency record scoped to the caller", async () => {
    ddb.on(GetCommand).resolves({ Item: { statusCode: 200, body: "{}" } });
    expect(await repo().getIdempotentResult(USER, "s1", "k1")).toEqual({
      statusCode: 200,
      body: "{}",
    });
    const key = ddb.commandCalls(GetCommand)[0]!.args[0].input.Key as any;
    expect(key.pk).toBe(`USER#${USER}`);
    expect(key.sk).toMatch(/^IDEMPOTENCY#[0-9a-f]+#[0-9a-f]+$/);
  });

  it("ignores a malformed idempotency record rather than replaying nonsense", async () => {
    ddb.on(GetCommand).resolves({ Item: { statusCode: "200", body: 7 } });
    expect(await repo().getIdempotentResult(USER, "s1", "k1")).toBeUndefined();
  });
});

describe("DynamoStashRepository.deleteFiles", () => {
  it("deletes each pending file from the caller's partition", async () => {
    ddb.on(DeleteCommand).resolves({});

    await repo().deleteFiles(USER, ["f1", "f2"]);

    const keys = ddb
      .commandCalls(DeleteCommand)
      .map((c) => (c.args[0].input as any).Key);
    expect(keys).toEqual([
      { pk: `USER#${USER}`, sk: "FILE#f1" },
      { pk: `USER#${USER}`, sk: "FILE#f2" },
    ]);
  });

  it("is a no-op for an empty list", async () => {
    await repo().deleteFiles(USER, []);
    expect(ddb.commandCalls(DeleteCommand)).toHaveLength(0);
  });
});
