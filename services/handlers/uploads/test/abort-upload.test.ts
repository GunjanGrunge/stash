import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import {
  AbortMultipartUploadCommand,
  NoSuchUpload,
  S3Client,
} from "@aws-sdk/client-s3";
import { abortUpload } from "../src/abort-upload.js";
import { MemoryUploadRepository } from "../src/memory-repository.js";
import { S3MultipartStore } from "../src/s3-multipart.js";
import type { UploadFileRecord } from "../src/types.js";

const BUCKET = "stash-beta-payloads";
const s3mock = mockClient(S3Client);
const FILE_BYTES = 4_200_000_000;
const RESERVED = 10_000_000_000;

function store(): S3MultipartStore {
  return new S3MultipartStore(
    new S3Client({
      region: "ap-south-1",
      credentials: { accessKeyId: "AKIATEST", secretAccessKey: "test" },
    }),
    BUCKET,
  );
}

function seededFile(overrides: Partial<UploadFileRecord> = {}): UploadFileRecord {
  return {
    pk: "USER#u1",
    sk: "FILE#f1",
    entity: "FILE",
    fileId: "f1",
    stashId: "stash-1",
    objectKey: "users/u1/f1",
    sizeBytes: FILE_BYTES,
    checksum: "sha256-of-the-manifest-entry",
    state: "uploading",
    uploadId: "mpu-1",
    ...overrides,
  };
}

function repoWith(file: UploadFileRecord): MemoryUploadRepository {
  const repo = new MemoryUploadRepository();
  repo.seedProfile("u1", { quotaBytes: 1_000_000_000_000, usedBytes: RESERVED });
  repo.seedFile(file);
  return repo;
}

function event(opts: {
  userId?: string;
  fileId?: string;
  idempotencyKey?: string;
  noAuth?: boolean;
} = {}): unknown {
  return {
    requestContext: opts.noAuth
      ? {}
      : { authorizer: { jwt: { claims: { sub: opts.userId ?? "u1" } } } },
    pathParameters: { file_id: opts.fileId ?? "f1" },
    headers: opts.idempotencyKey ? { "idempotency-key": opts.idempotencyKey } : {},
    body: JSON.stringify({ user_id: "someone-else" }),
  };
}

beforeEach(() => {
  s3mock.reset();
  s3mock.on(AbortMultipartUploadCommand).resolves({});
});

describe("abortUpload — happy path", () => {
  it("aborts the multipart upload and releases exactly this file's reserved quota", async () => {
    const repo = repoWith(seededFile());
    const res = await abortUpload({ repo, store: store() })(event());

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toMatchObject({
      fileId: "f1",
      state: "failed",
      quotaReleased: true,
    });

    const call = s3mock.commandCalls(AbortMultipartUploadCommand)[0]!;
    // Rule 6: the key came from the stored record.
    expect(call.args[0].input.Key).toBe("users/u1/f1");
    expect(call.args[0].input.UploadId).toBe("mpu-1");

    expect(repo.file("u1", "f1")!.state).toBe("failed");
    expect(repo.profile("u1")!.usedBytes).toBe(RESERVED - FILE_BYTES);
  });

  it("aborts a file that never got a multipart upload, without calling S3", async () => {
    const repo = repoWith(seededFile({ state: "pending", uploadId: undefined }));
    const res = await abortUpload({ repo, store: store() })(event());

    expect(res.statusCode).toBe(200);
    expect(s3mock.commandCalls(AbortMultipartUploadCommand)).toHaveLength(0);
    expect(repo.profile("u1")!.usedBytes).toBe(RESERVED - FILE_BYTES);
  });
});

describe("abortUpload — must be safe to call twice", () => {
  it("does NOT release quota a second time on a repeated abort", async () => {
    const repo = repoWith(seededFile());
    const handler = abortUpload({ repo, store: store() });

    const first = await handler(event());
    const second = await handler(event());

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(JSON.parse(first.body).quotaReleased).toBe(true);
    // The second call is a no-op refund-wise: reporting it as a release too
    // would hand the creator FILE_BYTES of free quota per retry.
    expect(JSON.parse(second.body).quotaReleased).toBe(false);

    expect(repo.profile("u1")!.usedBytes).toBe(RESERVED - FILE_BYTES);
    expect(repo.file("u1", "f1")!.state).toBe("failed");
  });

  it("stays safe across three aborts", async () => {
    const repo = repoWith(seededFile());
    const handler = abortUpload({ repo, store: store() });
    await handler(event());
    await handler(event());
    await handler(event());
    expect(repo.profile("u1")!.usedBytes).toBe(RESERVED - FILE_BYTES);
  });

  it("does not double-release when the SAME Idempotency-Key is replayed", async () => {
    const repo = repoWith(seededFile());
    const handler = abortUpload({ repo, store: store() });

    const first = await handler(event({ idempotencyKey: "k-1" }));
    const second = await handler(event({ idempotencyKey: "k-1" }));

    expect(second).toEqual(first);
    expect(repo.profile("u1")!.usedBytes).toBe(RESERVED - FILE_BYTES);
    expect(s3mock.commandCalls(AbortMultipartUploadCommand)).toHaveLength(1);
  });

  it("succeeds when S3 has already forgotten the upload (lifecycle abort, or a prior abort)", async () => {
    s3mock.on(AbortMultipartUploadCommand).rejects(
      new NoSuchUpload({ message: "no such upload", $metadata: {} }),
    );
    const repo = repoWith(seededFile());
    const res = await abortUpload({ repo, store: store() })(event());

    // The S3 side is already in the desired state; the quota release is what
    // still has to happen, and must not be blocked by that.
    expect(res.statusCode).toBe(200);
    expect(repo.profile("u1")!.usedBytes).toBe(RESERVED - FILE_BYTES);
  });
});

describe("abortUpload — auth, tenancy and guards", () => {
  it("rejects a request with no verified subject claim (401)", async () => {
    const repo = repoWith(seededFile());
    const res = await abortUpload({ repo, store: store() })(event({ noAuth: true }));
    expect(res.statusCode).toBe(401);
    expect(s3mock.commandCalls(AbortMultipartUploadCommand)).toHaveLength(0);
  });

  it("returns 404 — never 403 — for another creator's file, and releases nothing", async () => {
    const repo = repoWith(seededFile());
    const res = await abortUpload({ repo, store: store() })(event({ userId: "u2" }));

    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body).code).toBe("not_found");
    expect(s3mock.commandCalls(AbortMultipartUploadCommand)).toHaveLength(0);
    expect(repo.profile("u1")!.usedBytes).toBe(RESERVED);
    expect(repo.file("u1", "f1")!.state).toBe("uploading");
  });

  it("refuses to abort a committed file (409) — its bytes are really stored", async () => {
    const repo = repoWith(seededFile({ state: "committed" }));
    const res = await abortUpload({ repo, store: store() })(event());

    expect(res.statusCode).toBe(409);
    expect(repo.profile("u1")!.usedBytes).toBe(RESERVED);
    expect(repo.file("u1", "f1")!.state).toBe("committed");
    expect(s3mock.commandCalls(AbortMultipartUploadCommand)).toHaveLength(0);
  });

  it("surfaces a real S3 failure as 500 and releases no quota", async () => {
    s3mock.on(AbortMultipartUploadCommand).rejects(new Error("ServiceUnavailable"));
    const repo = repoWith(seededFile());
    const res = await abortUpload({ repo, store: store() })(event());

    expect(res.statusCode).toBe(500);
    expect(repo.profile("u1")!.usedBytes).toBe(RESERVED);
    expect(res.body).not.toContain("ServiceUnavailable");
  });

  it("leaves quota untouched when the release write itself throws", async () => {
    const repo = repoWith(seededFile());
    vi.spyOn(repo, "abortAndReleaseQuota").mockRejectedValue(new Error("throughput"));
    const res = await abortUpload({ repo, store: store() })(event());
    expect(res.statusCode).toBe(500);
    expect(repo.profile("u1")!.usedBytes).toBe(RESERVED);
  });
});

describe("abortUpload — logging", () => {
  it("logs no URL, signature or credential", async () => {
    const lines: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((l: string) => lines.push(l));
    const repo = repoWith(seededFile());
    await abortUpload({ repo, store: store() })(event());
    spy.mockRestore();

    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(line).not.toMatch(/https?:\/\//);
      expect(line).not.toMatch(/X-Amz-/i);
      expect(line).not.toContain("AKIATEST");
    }
  });
});
