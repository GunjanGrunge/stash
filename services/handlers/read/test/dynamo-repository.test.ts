import { beforeEach, describe, expect, it } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import {
  DynamoDBDocumentClient,
  GetCommand,
  QueryCommand,
} from "@aws-sdk/lib-dynamodb";
import { DynamoReadRepository } from "../src/dynamo-repository.js";
import type { StashRecord } from "../src/types.js";

const TABLE = "StashTable";
const ddb = mockClient(DynamoDBDocumentClient);

function repo(): DynamoReadRepository {
  return new DynamoReadRepository(
    ddb as unknown as DynamoDBDocumentClient,
    TABLE,
  );
}

function stash(userId: string, stashId: string): StashRecord {
  return {
    pk: `USER#${userId}`,
    sk: `STASH#${stashId}`,
    entity: "STASH",
    stashId,
    state: "completed",
    fileCount: 1,
    committedCount: 1,
    reservedBytes: 10,
    committedBytes: 10,
    startedAt: "2026-09-14T10:00:00.000Z",
    updatedAt: "2026-09-14T10:00:00.000Z",
  };
}

beforeEach(() => {
  ddb.reset();
});

describe("DynamoReadRepository.listStashes", () => {
  it("queries the caller's partition for STASH items only, parameterized", async () => {
    ddb.on(QueryCommand).resolves({ Items: [stash("u1", "s-1")] });

    const items = await repo().listStashes("u1");

    expect(items.map((s) => s.stashId)).toEqual(["s-1"]);
    const input = ddb.commandCalls(QueryCommand)[0]!.args[0]!.input;
    expect(input.TableName).toBe(TABLE);
    expect(input.KeyConditionExpression).toBe(
      "pk = :pk AND begins_with(sk, :skPrefix)",
    );
    expect(input.ExpressionAttributeValues).toEqual({
      ":pk": "USER#u1",
      ":skPrefix": "STASH#",
    });
    // Rule 4: no caller-derived value is ever concatenated into an expression.
    expect(input.KeyConditionExpression).not.toContain("u1");
  });

  it("follows EVERY page and never silently truncates", async () => {
    const page = (ids: string[], last: string | undefined) => ({
      Items: ids.map((id) => stash("u1", id)),
      LastEvaluatedKey:
        last === undefined
          ? undefined
          : { pk: "USER#u1", sk: `STASH#${last}` },
    });
    ddb
      .on(QueryCommand)
      .resolvesOnce(page(["s-1", "s-2"], "s-2"))
      .resolvesOnce(page(["s-3", "s-4"], "s-4"))
      .resolvesOnce(page(["s-5"], undefined));

    const items = await repo().listStashes("u1");

    expect(items.map((s) => s.stashId)).toEqual([
      "s-1",
      "s-2",
      "s-3",
      "s-4",
      "s-5",
    ]);
    const calls = ddb.commandCalls(QueryCommand);
    expect(calls).toHaveLength(3);
    expect(calls[0]!.args[0]!.input.ExclusiveStartKey).toBeUndefined();
    expect(calls[1]!.args[0]!.input.ExclusiveStartKey).toEqual({
      pk: "USER#u1",
      sk: "STASH#s-2",
    });
    expect(calls[2]!.args[0]!.input.ExclusiveStartKey).toEqual({
      pk: "USER#u1",
      sk: "STASH#s-4",
    });
  });

  it("tolerates a page that is empty but still has more pages behind it", async () => {
    ddb
      .on(QueryCommand)
      .resolvesOnce({
        Items: [],
        LastEvaluatedKey: { pk: "USER#u1", sk: "STASH#s-0" },
      })
      .resolvesOnce({ Items: [stash("u1", "s-1")] });

    const items = await repo().listStashes("u1");

    expect(items.map((s) => s.stashId)).toEqual(["s-1"]);
    expect(ddb.commandCalls(QueryCommand)).toHaveLength(2);
  });

  it("returns an empty list when the creator has no Stashes", async () => {
    ddb.on(QueryCommand).resolves({ Items: [] });
    expect(await repo().listStashes("u1")).toEqual([]);
  });

  it("cannot address another creator's partition", async () => {
    ddb.on(QueryCommand).resolves({ Items: [] });
    await repo().listStashes("u2");
    const input = ddb.commandCalls(QueryCommand)[0]!.args[0]!.input;
    expect(input.ExpressionAttributeValues![":pk"]).toBe("USER#u2");
  });

  it("ignores a non-STASH item that somehow shares the sk prefix", async () => {
    ddb.on(QueryCommand).resolves({
      Items: [
        stash("u1", "s-1"),
        { pk: "USER#u1", sk: "STASH#x", entity: "FILE" },
      ],
    });
    const items = await repo().listStashes("u1");
    expect(items.map((s) => s.stashId)).toEqual(["s-1"]);
  });
});

describe("DynamoReadRepository.getUsage", () => {
  it("reads the caller's PROFILE item", async () => {
    ddb.on(GetCommand).resolves({
      Item: { pk: "USER#u1", sk: "PROFILE", usedBytes: 12, quotaBytes: 34 },
    });

    expect(await repo().getUsage("u1")).toEqual({
      usedBytes: 12,
      quotaBytes: 34,
    });
    const input = ddb.commandCalls(GetCommand)[0]!.args[0]!.input;
    expect(input.TableName).toBe(TABLE);
    expect(input.Key).toEqual({ pk: "USER#u1", sk: "PROFILE" });
    expect(input.ConsistentRead).toBe(true);
  });

  it("returns undefined when the creator has no PROFILE item yet", async () => {
    ddb.on(GetCommand).resolves({});
    expect(await repo().getUsage("u1")).toBeUndefined();
  });

  it("returns undefined for a PROFILE with malformed counters", async () => {
    ddb.on(GetCommand).resolves({
      Item: { pk: "USER#u1", sk: "PROFILE", usedBytes: "lots" },
    });
    expect(await repo().getUsage("u1")).toBeUndefined();
  });
});
