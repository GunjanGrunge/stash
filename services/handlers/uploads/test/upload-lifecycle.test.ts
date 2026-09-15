import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  HeadObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import {
  DynamoDBDocumentClient,
  GetCommand,
  TransactWriteCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { abortUpload } from "../src/abort-upload.js";
import { completeUpload } from "../src/complete-upload.js";
import { DynamoUploadRepository } from "../src/dynamo-repository.js";
import { S3MultipartStore, multipartETag } from "../src/s3-multipart.js";
import { signParts } from "../src/sign-parts.js";
import type { UploadFileRecord } from "../src/types.js";

/**
 * The three handlers wired to the REAL DynamoDB and S3 adapters, with only
 * the AWS clients mocked. The memory fake can agree with a handler about a
 * contract that DynamoDB does not implement; this suite cannot.
 */

const TABLE = "StashTable";
const BUCKET = "stash-beta-payloads";
const ddb = mockClient(DynamoDBDocumentClient);
const s3mock = mockClient(S3Client);

const SIZE = 10_485_760;
const PART_ONE = createHash("md5").update("one").digest("hex");
const PART_TWO = createHash("md5").update("two").digest("hex");
const PARTS = [
  { partNumber: 1, etag: PART_ONE },
  { partNumber: 2, etag: PART_TWO },
];
const GOOD_ETAG = multipartETag(PARTS);

function deps() {
  return {
    repo: new DynamoUploadRepository(
      ddb as unknown as DynamoDBDocumentClient,
      TABLE,
    ),
    store: new S3MultipartStore(
      new S3Client({
        region: "ap-south-1",
        credentials: { accessKeyId: "AKIATEST", secretAccessKey: "test" },
      }),
      BUCKET,
    ),
  };
}

function storedFile(overrides: Partial<UploadFileRecord> = {}): UploadFileRecord {
  return {
    pk: "USER#u1",
    sk: "FILE#f1",
    entity: "FILE",
    fileId: "f1",
    stashId: "stash-1",
    objectKey: "users/u1/f1",
    sizeBytes: SIZE,
    checksum: "sum",
    state: "uploading",
    uploadId: "mpu-1",
    ...overrides,
  };
}

function event(body: unknown = {}, userId = "u1"): unknown {
  return {
    requestContext: { authorizer: { jwt: { claims: { sub: userId } } } },
    pathParameters: { file_id: "f1" },
    headers: {},
    body: JSON.stringify(body),
  };
}

/** Every UpdateCommand that would move a file into `committed`. */
function commitWrites(): unknown[] {
  return ddb
    .commandCalls(UpdateCommand)
    .filter((c) => c.args[0].input.ExpressionAttributeValues?.[":committed"] !== undefined)
    .filter((c) => (c.args[0].input.UpdateExpression ?? "").includes(":committed"));
}

beforeEach(() => {
  ddb.reset();
  s3mock.reset();
});

describe("full lifecycle against the real adapters", () => {
  it("sign -> complete commits once, through a conditional DynamoDB write", async () => {
    ddb.on(GetCommand).resolves({ Item: storedFile({ state: "pending", uploadId: undefined }) });
    ddb.on(UpdateCommand).resolves({});
    s3mock.on(CreateMultipartUploadCommand).resolves({ UploadId: "mpu-1" });

    const signed = await signParts(deps())(event({ partCount: 2 }));
    expect(signed.statusCode).toBe(200);

    ddb.reset();
    ddb.on(GetCommand).resolves({ Item: storedFile() });
    ddb.on(UpdateCommand).resolves({});
    s3mock.on(CompleteMultipartUploadCommand).resolves({ ETag: `"${GOOD_ETAG}"` });
    s3mock.on(HeadObjectCommand).resolves({ ContentLength: SIZE, ETag: `"${GOOD_ETAG}"` });

    const done = await completeUpload(deps())(event({ parts: PARTS }));
    expect(done.statusCode).toBe(200);
    expect(commitWrites()).toHaveLength(1);
  });

  it("a SIZE mismatch sends NO committed write to DynamoDB at all", async () => {
    ddb.on(GetCommand).resolves({ Item: storedFile() });
    ddb.on(UpdateCommand).resolves({});
    s3mock.on(CompleteMultipartUploadCommand).resolves({ ETag: `"${GOOD_ETAG}"` });
    s3mock.on(HeadObjectCommand).resolves({ ContentLength: SIZE - 1, ETag: `"${GOOD_ETAG}"` });

    const res = await completeUpload(deps())(event({ parts: PARTS }));

    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).mismatch).toBe("size");
    expect(commitWrites()).toHaveLength(0);

    const write = ddb.commandCalls(UpdateCommand)[0]!.args[0].input;
    expect(write.ExpressionAttributeValues![":failed"]).toBe("failed");
    expect(write.ConditionExpression).toContain("#state = :uploading");
  });

  it("an ETAG mismatch sends NO committed write to DynamoDB at all", async () => {
    const wrong = `${createHash("md5").update("other").digest("hex")}-2`;
    ddb.on(GetCommand).resolves({ Item: storedFile() });
    ddb.on(UpdateCommand).resolves({});
    s3mock.on(CompleteMultipartUploadCommand).resolves({ ETag: `"${wrong}"` });
    s3mock.on(HeadObjectCommand).resolves({ ContentLength: SIZE, ETag: `"${wrong}"` });

    const res = await completeUpload(deps())(event({ parts: PARTS }));

    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).mismatch).toBe("etag");
    expect(commitWrites()).toHaveLength(0);
  });

  it("catches a HeadObject that disagrees with CompleteMultipartUpload", async () => {
    ddb.on(GetCommand).resolves({ Item: storedFile() });
    ddb.on(UpdateCommand).resolves({});
    // S3 reported the right ETag on complete, but the stored object differs.
    s3mock.on(CompleteMultipartUploadCommand).resolves({ ETag: `"${GOOD_ETAG}"` });
    s3mock.on(HeadObjectCommand).resolves({
      ContentLength: SIZE,
      ETag: `"${createHash("md5").update("drift").digest("hex")}-2"`,
    });

    const res = await completeUpload(deps())(event({ parts: PARTS }));
    expect(res.statusCode).toBe(409);
    expect(commitWrites()).toHaveLength(0);
  });

  it("abort issues one transaction and a second abort refunds nothing", async () => {
    ddb.on(GetCommand).resolves({ Item: storedFile() });
    ddb.on(TransactWriteCommand).resolves({});
    s3mock.on(AbortMultipartUploadCommand).resolves({});

    const first = await abortUpload(deps())(event());
    expect(JSON.parse(first.body).quotaReleased).toBe(true);
    expect(ddb.commandCalls(TransactWriteCommand)).toHaveLength(1);

    // Second attempt: the once-only guard has been spent, so DynamoDB cancels.
    ddb.reset();
    ddb.on(GetCommand).resolves({
      Item: storedFile({ state: "failed", quotaReleased: true }),
    });
    ddb.on(TransactWriteCommand).rejects(
      Object.assign(new Error("cancelled"), {
        name: "TransactionCanceledException",
        CancellationReasons: [{ Code: "ConditionalCheckFailed" }],
      }),
    );

    const second = await abortUpload(deps())(event());
    expect(second.statusCode).toBe(200);
    expect(JSON.parse(second.body).quotaReleased).toBe(false);
  });

  it("a cross-tenant complete reads only the caller's own partition and writes nothing", async () => {
    ddb.on(GetCommand).resolves({});
    const res = await completeUpload(deps())(event({ parts: PARTS }, "u2"));

    expect(res.statusCode).toBe(404);
    expect(ddb.commandCalls(GetCommand)[0]!.args[0].input.Key).toEqual({
      pk: "USER#u2",
      sk: "FILE#f1",
    });
    expect(ddb.commandCalls(UpdateCommand)).toHaveLength(0);
    expect(s3mock.commandCalls(CompleteMultipartUploadCommand)).toHaveLength(0);
  });
});
