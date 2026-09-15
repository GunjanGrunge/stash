import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import {
  CompleteMultipartUploadCommand,
  HeadObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { completeUpload } from "../src/complete-upload.js";
import { MemoryUploadRepository } from "../src/memory-repository.js";
import { S3MultipartStore, multipartETag } from "../src/s3-multipart.js";
import type { UploadFileRecord } from "../src/types.js";

const BUCKET = "stash-beta-payloads";
const s3mock = mockClient(S3Client);

function store(): S3MultipartStore {
  return new S3MultipartStore(
    new S3Client({
      region: "ap-south-1",
      credentials: { accessKeyId: "AKIATEST", secretAccessKey: "test" },
    }),
    BUCKET,
  );
}

/** Two 5 MiB parts whose ETags are real MD5s, so the derived ETag is real. */
const PART_ONE = createHash("md5").update("part-one").digest("hex");
const PART_TWO = createHash("md5").update("part-two").digest("hex");
const PARTS = [
  { partNumber: 1, etag: PART_ONE },
  { partNumber: 2, etag: PART_TWO },
];
const GOOD_ETAG = multipartETag(PARTS);
const REGISTERED_SIZE = 10_485_760;

function seededFile(overrides: Partial<UploadFileRecord> = {}): UploadFileRecord {
  return {
    pk: "USER#u1",
    sk: "FILE#f1",
    entity: "FILE",
    fileId: "f1",
    stashId: "stash-1",
    objectKey: "users/u1/f1",
    sizeBytes: REGISTERED_SIZE,
    checksum: "sha256-of-the-manifest-entry",
    state: "uploading",
    uploadId: "mpu-1",
    ...overrides,
  };
}

function repoWith(file: UploadFileRecord): MemoryUploadRepository {
  const repo = new MemoryUploadRepository();
  repo.seedProfile("u1", { quotaBytes: 1_000_000_000_000, usedBytes: REGISTERED_SIZE });
  repo.seedFile(file);
  return repo;
}

function event(opts: {
  userId?: string;
  fileId?: string;
  parts?: unknown;
  idempotencyKey?: string;
  noAuth?: boolean;
}): unknown {
  return {
    requestContext: opts.noAuth
      ? {}
      : { authorizer: { jwt: { claims: { sub: opts.userId ?? "u1" } } } },
    pathParameters: { file_id: opts.fileId ?? "f1" },
    headers: opts.idempotencyKey ? { "idempotency-key": opts.idempotencyKey } : {},
    body: JSON.stringify({
      parts: opts.parts ?? PARTS,
      // Rule 7: a user_id in the body is attacker-controlled and ignored.
      user_id: "someone-else",
    }),
  };
}

beforeEach(() => s3mock.reset());

describe("completeUpload — Rule 4: never mark Stashed what is not verified committed", () => {
  it("leaves the file FAILED and NOT committed when the S3 object size differs from the registered manifest entry", async () => {
    s3mock.on(CompleteMultipartUploadCommand).resolves({ ETag: `"${GOOD_ETAG}"` });
    s3mock.on(HeadObjectCommand).resolves({
      // One byte short: a truncated transfer that S3 happily assembled.
      ContentLength: REGISTERED_SIZE - 1,
      ETag: `"${GOOD_ETAG}"`,
    });

    const repo = repoWith(seededFile());
    const res = await completeUpload({ repo, store: store() })(event({}));

    expect(repo.file("u1", "f1")!.state).toBe("failed");
    expect(repo.file("u1", "f1")!.state).not.toBe("committed");
    expect(res.statusCode).toBe(409);
    const body = JSON.parse(res.body);
    expect(body.code).toBe("upload_verification_failed");
    expect(body.mismatch).toBe("size");
  });

  it("leaves the file FAILED and NOT committed when the S3 object ETag differs from the ETag the submitted parts imply", async () => {
    const wrong = `${createHash("md5").update("not-the-object").digest("hex")}-2`;
    s3mock.on(CompleteMultipartUploadCommand).resolves({ ETag: `"${wrong}"` });
    s3mock.on(HeadObjectCommand).resolves({
      ContentLength: REGISTERED_SIZE,
      ETag: `"${wrong}"`,
    });

    const repo = repoWith(seededFile());
    const res = await completeUpload({ repo, store: store() })(event({}));

    expect(repo.file("u1", "f1")!.state).toBe("failed");
    expect(repo.file("u1", "f1")!.state).not.toBe("committed");
    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).mismatch).toBe("etag");
  });

  it("commits only after BOTH checks pass", async () => {
    s3mock.on(CompleteMultipartUploadCommand).resolves({ ETag: `"${GOOD_ETAG}"` });
    s3mock.on(HeadObjectCommand).resolves({
      ContentLength: REGISTERED_SIZE,
      ETag: `"${GOOD_ETAG}"`,
    });

    const repo = repoWith(seededFile());
    const res = await completeUpload({ repo, store: store() })(event({}));

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toMatchObject({ fileId: "f1", state: "committed" });
    expect(repo.file("u1", "f1")!.state).toBe("committed");
  });

  it("verifies BEFORE writing: no commit is attempted when verification fails", async () => {
    s3mock.on(CompleteMultipartUploadCommand).resolves({ ETag: `"${GOOD_ETAG}"` });
    s3mock.on(HeadObjectCommand).resolves({
      ContentLength: REGISTERED_SIZE + 4096,
      ETag: `"${GOOD_ETAG}"`,
    });

    const repo = repoWith(seededFile());
    const spy = vi.spyOn(repo, "commitFile");
    await completeUpload({ repo, store: store() })(event({}));

    expect(spy).not.toHaveBeenCalled();
  });
});

describe("completeUpload — spec §5: S3 complete succeeds, DynamoDB write fails", () => {
  it("leaves the file UPLOADING for reconciliation and never reports success", async () => {
    s3mock.on(CompleteMultipartUploadCommand).resolves({ ETag: `"${GOOD_ETAG}"` });
    s3mock.on(HeadObjectCommand).resolves({
      ContentLength: REGISTERED_SIZE,
      ETag: `"${GOOD_ETAG}"`,
    });

    const repo = repoWith(seededFile());
    vi.spyOn(repo, "commitFile").mockRejectedValue(new Error("ProvisionedThroughputExceeded"));

    const res = await completeUpload({ repo, store: store() })(event({}));

    expect(res.statusCode).toBe(500);
    expect(repo.file("u1", "f1")!.state).toBe("uploading");
    expect(res.body).not.toContain("committed");
  });

  it("returns 409 rather than success when the conditional commit loses its guard", async () => {
    s3mock.on(CompleteMultipartUploadCommand).resolves({ ETag: `"${GOOD_ETAG}"` });
    s3mock.on(HeadObjectCommand).resolves({
      ContentLength: REGISTERED_SIZE,
      ETag: `"${GOOD_ETAG}"`,
    });

    const repo = repoWith(seededFile());
    vi.spyOn(repo, "commitFile").mockResolvedValue(false);

    const res = await completeUpload({ repo, store: store() })(event({}));
    expect(res.statusCode).toBe(409);
    expect(repo.file("u1", "f1")!.state).not.toBe("committed");
  });
});

describe("completeUpload — auth and tenancy", () => {
  it("rejects a request with no verified subject claim (401)", async () => {
    const repo = repoWith(seededFile());
    const res = await completeUpload({ repo, store: store() })(event({ noAuth: true }));
    expect(res.statusCode).toBe(401);
    expect(s3mock.commandCalls(CompleteMultipartUploadCommand)).toHaveLength(0);
  });

  it("returns 404 — never 403 — for another creator's file, and touches S3 not at all", async () => {
    const repo = repoWith(seededFile());
    const res = await completeUpload({ repo, store: store() })(event({ userId: "u2" }));

    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body).code).toBe("not_found");
    expect(s3mock.commandCalls(CompleteMultipartUploadCommand)).toHaveLength(0);
    expect(repo.file("u1", "f1")!.state).toBe("uploading");
  });

  it("ignores a user_id in the body (Rule 7)", async () => {
    s3mock.on(CompleteMultipartUploadCommand).resolves({ ETag: `"${GOOD_ETAG}"` });
    s3mock.on(HeadObjectCommand).resolves({
      ContentLength: REGISTERED_SIZE,
      ETag: `"${GOOD_ETAG}"`,
    });
    const repo = repoWith(seededFile());
    const res = await completeUpload({ repo, store: store() })(event({}));

    expect(res.statusCode).toBe(200);
    // The key came from the STORED record, never from request input (Rule 6).
    const call = s3mock.commandCalls(CompleteMultipartUploadCommand)[0]!;
    expect(call.args[0].input.Key).toBe("users/u1/f1");
  });
});

describe("completeUpload — state guards and idempotency", () => {
  it("replays the original result for a repeated Idempotency-Key without re-completing in S3", async () => {
    s3mock.on(CompleteMultipartUploadCommand).resolves({ ETag: `"${GOOD_ETAG}"` });
    s3mock.on(HeadObjectCommand).resolves({
      ContentLength: REGISTERED_SIZE,
      ETag: `"${GOOD_ETAG}"`,
    });

    const repo = repoWith(seededFile());
    const handler = completeUpload({ repo, store: store() });

    const first = await handler(event({ idempotencyKey: "k-1" }));
    const second = await handler(event({ idempotencyKey: "k-1" }));

    expect(second).toEqual(first);
    expect(s3mock.commandCalls(CompleteMultipartUploadCommand)).toHaveLength(1);
  });

  it("rejects completing a file that never started uploading (409)", async () => {
    const repo = repoWith(seededFile({ state: "pending", uploadId: undefined }));
    const res = await completeUpload({ repo, store: store() })(event({}));
    expect(res.statusCode).toBe(409);
    expect(s3mock.commandCalls(CompleteMultipartUploadCommand)).toHaveLength(0);
  });

  it("rejects completing a file already marked failed (409)", async () => {
    const repo = repoWith(seededFile({ state: "failed" }));
    const res = await completeUpload({ repo, store: store() })(event({}));
    expect(res.statusCode).toBe(409);
  });

  it("rejects a malformed parts list (400) without calling S3", async () => {
    const repo = repoWith(seededFile());
    const res = await completeUpload({ repo, store: store() })(
      event({ parts: [{ partNumber: 0, etag: "" }] }),
    );
    expect(res.statusCode).toBe(400);
    expect(s3mock.commandCalls(CompleteMultipartUploadCommand)).toHaveLength(0);
  });
});

describe("completeUpload — logging", () => {
  it("never writes an object key query string, credential or URL into a log line", async () => {
    s3mock.on(CompleteMultipartUploadCommand).resolves({ ETag: `"${GOOD_ETAG}"` });
    s3mock.on(HeadObjectCommand).resolves({
      ContentLength: REGISTERED_SIZE,
      ETag: `"${GOOD_ETAG}"`,
    });
    const lines: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((l: string) => lines.push(l));

    const repo = repoWith(seededFile());
    await completeUpload({ repo, store: store() })(event({}));
    spy.mockRestore();

    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(line).not.toMatch(/https?:\/\//);
      expect(line).not.toMatch(/X-Amz-Signature/i);
    }
  });
});

// Guards against the ETag algorithm silently drifting.
describe("multipartETag", () => {
  it("is md5(concat(binary part md5s)) + '-' + part count", () => {
    const expected =
      createHash("md5")
        .update(Buffer.concat([Buffer.from(PART_ONE, "hex"), Buffer.from(PART_TWO, "hex")]))
        .digest("hex") + "-2";
    expect(GOOD_ETAG).toBe(expected);
  });

  it("orders parts by partNumber, not by submission order", () => {
    expect(multipartETag([PARTS[1]!, PARTS[0]!])).toBe(GOOD_ETAG);
  });

  it("ignores surrounding quotes and case on part etags", () => {
    expect(
      multipartETag([
        { partNumber: 1, etag: `"${PART_ONE.toUpperCase()}"` },
        { partNumber: 2, etag: PART_TWO },
      ]),
    ).toBe(GOOD_ETAG);
  });

  it("treats a HeadObject with no ContentLength as a size mismatch, not as zero", async () => {
    s3mock.on(CompleteMultipartUploadCommand).resolves({ ETag: `"${GOOD_ETAG}"` });
    s3mock.on(HeadObjectCommand).resolves({ ETag: `"${GOOD_ETAG}"` });
    const repo = repoWith(seededFile({ sizeBytes: 0 }));
    const res = await completeUpload({ repo, store: store() })(event({}));
    expect(res.statusCode).toBe(409);
    expect(repo.file("u1", "f1")!.state).toBe("failed");
  });
});
