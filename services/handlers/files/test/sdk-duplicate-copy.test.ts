import { beforeEach, describe, expect, it } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import {
  DynamoDBDocumentClient,
  TransactWriteCommand,
} from "@aws-sdk/lib-dynamodb";
import { DynamoRepository } from "../src/dynamo-repository.js";
import type { FolderRecord } from "../src/types.js";

/**
 * Regression: condition failures must be recognised even when the error does
 * not pass `instanceof`.
 *
 * Two copies of `@aws-sdk/client-dynamodb` in one dependency tree is ordinary
 * in a workspace — a package pinning its own SDK version is enough. The error
 * thrown by the copy the client uses is then NOT an instance of the class this
 * module imported, so an `instanceof`-only check silently returns false.
 *
 * The consequence is not cosmetic: a lost folder-identity guard is a routine
 * race that must surface as 409 "folder already exists". Misread, it becomes a
 * 500, and the caller retries a request that can never succeed.
 *
 * These errors are shaped exactly as the SDK shapes them, but built as plain
 * objects so they fail `instanceof` the way a second copy would.
 */
const ddb = mockClient(DynamoDBDocumentClient);

function foreignError(
  name: string,
  extra: Record<string, unknown> = {},
): Error {
  const error = new Error("from another copy of the SDK");
  error.name = name;
  Object.assign(error, extra);
  return error;
}

const folder: FolderRecord = {
  pk: "USER#u1",
  sk: "FOLDER#folder-1",
  entity: "FOLDER",
  folderId: "folder-1",
  name: "Beats",
  parentFolderId: null,
  relativePath: "Beats",
  gsi1pk: "USER#u1#PARENT#ROOT",
  gsi1sk: "Beats",
};

const repo = () =>
  new DynamoRepository(ddb as unknown as DynamoDBDocumentClient, "StashTable");

beforeEach(() => ddb.reset());

describe("condition failures from a second SDK copy", () => {
  it("reads a cancelled transaction as 409 even when instanceof fails", async () => {
    ddb.on(TransactWriteCommand).rejects(
      foreignError("TransactionCanceledException", {
        CancellationReasons: [
          { Code: "None" },
          { Code: "ConditionalCheckFailed" },
        ],
      }),
    );
    await expect(repo().putEntities([folder])).rejects.toMatchObject({
      status: 409,
    });
  });

  it("reads a bare conditional check failure as 409 even when instanceof fails", async () => {
    ddb
      .on(TransactWriteCommand)
      .rejects(foreignError("ConditionalCheckFailedException"));
    await expect(repo().putEntities([folder])).rejects.toMatchObject({
      status: 409,
    });
  });

  it("still does NOT swallow an unrelated failure that merely looks foreign", async () => {
    // The widened match must key on the SDK's error names only. A throughput
    // error reported as a 409 would tell the caller to stop retrying exactly
    // when retrying is the right thing to do.
    ddb
      .on(TransactWriteCommand)
      .rejects(foreignError("ProvisionedThroughputExceededException"));
    await expect(repo().putEntities([folder])).rejects.toThrow(
      "from another copy of the SDK",
    );
  });

  it("does not treat a cancelled transaction with no failed guard as a conflict", async () => {
    ddb.on(TransactWriteCommand).rejects(
      foreignError("TransactionCanceledException", {
        CancellationReasons: [{ Code: "None" }, { Code: "None" }],
      }),
    );
    await expect(repo().putEntities([folder])).rejects.toThrow(
      "from another copy of the SDK",
    );
  });
});
