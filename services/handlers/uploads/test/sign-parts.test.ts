import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import {
  CreateMultipartUploadCommand,
  S3Client,
  UploadPartCommand,
} from "@aws-sdk/client-s3";
import { MemoryUploadRepository } from "../src/memory-repository.js";
import { PART_URL_TTL_SECONDS, S3MultipartStore } from "../src/s3-multipart.js";
import { signParts } from "../src/sign-parts.js";
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

function seededFile(overrides: Partial<UploadFileRecord> = {}): UploadFileRecord {
  return {
    pk: "USER#u1",
    sk: "FILE#f1",
    entity: "FILE",
    fileId: "f1",
    stashId: "stash-1",
    objectKey: "users/u1/f1",
    sizeBytes: 10_485_760,
    checksum: "sha256-of-the-manifest-entry",
    state: "pending",
    ...overrides,
  };
}

function repoWith(file: UploadFileRecord): MemoryUploadRepository {
  const repo = new MemoryUploadRepository();
  repo.seedProfile("u1", { quotaBytes: 1_000_000_000_000, usedBytes: file.sizeBytes });
  repo.seedFile(file);
  return repo;
}

function event(opts: {
  userId?: string;
  fileId?: string;
  partCount?: unknown;
  idempotencyKey?: string;
  noAuth?: boolean;
} = {}): unknown {
  return {
    requestContext: opts.noAuth
      ? {}
      : { authorizer: { jwt: { claims: { sub: opts.userId ?? "u1" } } } },
    pathParameters: { file_id: opts.fileId ?? "f1" },
    headers: opts.idempotencyKey ? { "idempotency-key": opts.idempotencyKey } : {},
    body: JSON.stringify({
      partCount: opts.partCount ?? 2,
      // Rule 7 / Rule 6 bait: neither of these may influence the result.
      user_id: "someone-else",
      objectKey: "users/victim/secret",
    }),
  };
}

beforeEach(() => {
  s3mock.reset();
  s3mock.on(CreateMultipartUploadCommand).resolves({ UploadId: "mpu-1" });
});

describe("signParts — happy path", () => {
  it("initiates the multipart upload, flips pending -> uploading, and returns one URL per part", async () => {
    const repo = repoWith(seededFile());
    const res = await signParts({ repo, store: store() })(event({ partCount: 3 }));

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.fileId).toBe("f1");
    expect(body.parts).toHaveLength(3);
    expect(body.parts.map((p: { partNumber: number }) => p.partNumber)).toEqual([1, 2, 3]);
    for (const part of body.parts) {
      expect(part.url).toMatch(/^https:\/\//);
      expect(part.url).toContain("X-Amz-Signature");
    }

    expect(repo.file("u1", "f1")!.state).toBe("uploading");
    expect(repo.file("u1", "f1")!.uploadId).toBe("mpu-1");
  });

  it("signs the key held in the STORED record, never one supplied by the caller (Rule 6)", async () => {
    const repo = repoWith(seededFile());
    const res = await signParts({ repo, store: store() })(event());

    const created = s3mock.commandCalls(CreateMultipartUploadCommand)[0]!;
    expect(created.args[0].input.Key).toBe("users/u1/f1");
    expect(created.args[0].input.Bucket).toBe(BUCKET);

    for (const part of JSON.parse(res.body).parts) {
      expect(part.url).toContain("/users/u1/f1");
      expect(part.url).not.toContain("victim");
    }
  });

  it("issues URLs with a TTL measured in minutes, not hours (spec §3.5)", async () => {
    const repo = repoWith(seededFile());
    const res = await signParts({ repo, store: store() })(event());

    expect(PART_URL_TTL_SECONDS).toBeLessThanOrEqual(60 * 60);
    expect(PART_URL_TTL_SECONDS).toBeGreaterThanOrEqual(60);
    const url = new URL(JSON.parse(res.body).parts[0].url);
    expect(Number(url.searchParams.get("X-Amz-Expires"))).toBe(PART_URL_TTL_SECONDS);
    expect(JSON.parse(res.body).expiresInSeconds).toBe(PART_URL_TTL_SECONDS);
  });

  it("signs nothing but UploadPart — Rule 9: no payload byte reaches Lambda", async () => {
    const repo = repoWith(seededFile());
    await signParts({ repo, store: store() })(event());
    // The handler only ever sends CreateMultipartUpload to S3; parts are
    // presigned locally and transferred client -> S3 directly.
    expect(s3mock.commandCalls(UploadPartCommand)).toHaveLength(0);
  });
});

describe("signParts — auth and tenancy", () => {
  it("rejects a request with no verified subject claim (401)", async () => {
    const repo = repoWith(seededFile());
    const res = await signParts({ repo, store: store() })(event({ noAuth: true }));
    expect(res.statusCode).toBe(401);
    expect(s3mock.commandCalls(CreateMultipartUploadCommand)).toHaveLength(0);
  });

  it("returns 404 — never 403 — for another creator's file", async () => {
    const repo = repoWith(seededFile());
    const res = await signParts({ repo, store: store() })(event({ userId: "u2" }));

    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body).code).toBe("not_found");
    expect(res.body).not.toContain("403");
    expect(s3mock.commandCalls(CreateMultipartUploadCommand)).toHaveLength(0);
    expect(repo.file("u1", "f1")!.state).toBe("pending");
  });

  it("returns 404 for a file that does not exist at all — same answer as cross-tenant", async () => {
    const repo = repoWith(seededFile());
    const res = await signParts({ repo, store: store() })(event({ fileId: "nope" }));
    expect(res.statusCode).toBe(404);
  });
});

describe("signParts — state and idempotency", () => {
  it("replays the original result for a repeated Idempotency-Key without re-initiating in S3", async () => {
    const repo = repoWith(seededFile());
    const handler = signParts({ repo, store: store() });

    const first = await handler(event({ idempotencyKey: "k-1" }));
    const second = await handler(event({ idempotencyKey: "k-1" }));

    expect(second).toEqual(first);
    expect(s3mock.commandCalls(CreateMultipartUploadCommand)).toHaveLength(1);
  });

  it("re-signs against the EXISTING upload id when the file is already uploading (spec §4 step 7 retries)", async () => {
    const repo = repoWith(seededFile({ state: "uploading", uploadId: "mpu-existing" }));
    const res = await signParts({ repo, store: store() })(event());

    expect(res.statusCode).toBe(200);
    // Re-initiating would orphan the already-uploaded parts and silently
    // double the storage charge for this file.
    expect(s3mock.commandCalls(CreateMultipartUploadCommand)).toHaveLength(0);
    expect(JSON.parse(res.body).parts[0].url).toContain("mpu-existing");
  });

  it("refuses to re-open a committed file (409) — Rule 8: an overwrite is unrecoverable", async () => {
    const repo = repoWith(seededFile({ state: "committed" }));
    const res = await signParts({ repo, store: store() })(event());
    expect(res.statusCode).toBe(409);
    expect(s3mock.commandCalls(CreateMultipartUploadCommand)).toHaveLength(0);
  });

  it("refuses a file already marked failed (409)", async () => {
    const repo = repoWith(seededFile({ state: "failed" }));
    const res = await signParts({ repo, store: store() })(event());
    expect(res.statusCode).toBe(409);
  });

  it("returns 409 when the pending -> uploading guard is lost to a concurrent caller", async () => {
    const repo = repoWith(seededFile());
    vi.spyOn(repo, "beginUpload").mockResolvedValue(false);
    const res = await signParts({ repo, store: store() })(event());
    expect(res.statusCode).toBe(409);
  });

  it("rejects an out-of-range partCount (400) without touching S3", async () => {
    const repo = repoWith(seededFile());
    const s = store();
    expect((await signParts({ repo, store: s })(event({ partCount: 0 }))).statusCode).toBe(400);
    expect((await signParts({ repo, store: s })(event({ partCount: 10_001 }))).statusCode).toBe(400);
    expect((await signParts({ repo, store: s })(event({ partCount: 1.5 }))).statusCode).toBe(400);
    expect((await signParts({ repo, store: s })(event({ partCount: "2" }))).statusCode).toBe(400);
    expect(s3mock.commandCalls(CreateMultipartUploadCommand)).toHaveLength(0);
  });
});

describe("signParts — invariant 6: presigned URLs are redacted in logs", () => {
  it("writes no URL, signature or credential into any log line", async () => {
    const lines: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((l: string) => lines.push(l));

    const repo = repoWith(seededFile());
    const res = await signParts({ repo, store: store() })(event({ partCount: 2 }));
    spy.mockRestore();

    // The handler did log — this test would otherwise pass vacuously.
    expect(lines.length).toBeGreaterThan(0);
    const signed: string = JSON.parse(res.body).parts[0].url;
    for (const line of lines) {
      expect(line).not.toContain(signed);
      expect(line).not.toMatch(/https?:\/\//);
      expect(line).not.toMatch(/X-Amz-Signature/i);
      expect(line).not.toMatch(/X-Amz-Credential/i);
      expect(line).not.toContain("AKIATEST");
    }
    // It logged something useful instead: counts, not credentials.
    expect(lines.some((l) => l.includes("upload_parts_signed"))).toBe(true);
    expect(lines.some((l) => l.includes('"part_count":2'))).toBe(true);
  });

  it("never returns a presigned URL inside an error body", async () => {
    const repo = repoWith(seededFile({ state: "committed" }));
    const res = await signParts({ repo, store: store() })(event());
    expect(res.body).not.toMatch(/https?:\/\//);
  });
});
