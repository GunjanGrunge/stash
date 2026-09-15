import { createHash } from "node:crypto";
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  HeadObjectCommand,
  S3Client,
  UploadPartCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { badRequest } from "../../../shared/src/index.js";
import type { CompletedPart, ObjectFacts, PartAuthorization } from "./types.js";

/**
 * Spec §3.5: presigned URLs are issued with a TTL measured in MINUTES. A part
 * URL is a bearer credential for writing into the creator's namespace; the
 * window only has to outlive one part transfer plus a retry.
 */
export const PART_URL_TTL_SECONDS = 15 * 60;

/** S3's hard limit on parts in one multipart upload. */
export const MAX_PARTS = 10_000;

/**
 * An ETag as an MD5 hex digest, with S3's surrounding quotes stripped.
 * S3 returns `"d41d8c..."` — quotes included — and comparing the raw strings
 * is how an ETag check silently never matches and therefore never protects.
 */
export function normalizeETag(etag: string): string {
  return etag.trim().replace(/^"|"$/g, "").toLowerCase();
}

/**
 * The ETag S3 must produce for a multipart object assembled from these parts:
 * `md5(concat(binary md5 of each part)) + "-" + <part count>`.
 *
 * Each part ETag is the MD5 S3 itself computed when the part was uploaded, and
 * S3 rejects CompleteMultipartUpload if a submitted part ETag does not match
 * what it holds. So this derivation is not "trusting the client" — it is the
 * independent expectation the assembled object has to satisfy.
 *
 * Caveat recorded deliberately: this identity holds for SSE-S3 (spec §3.3's
 * minimum). Under SSE-KMS an ETag is not an MD5, and this check would have to
 * be replaced by a checksum-based one rather than quietly relaxed.
 */
export function multipartETag(parts: CompletedPart[]): string {
  const ordered = [...parts].sort((a, b) => a.partNumber - b.partNumber);
  const digests = ordered.map((p) => Buffer.from(normalizeETag(p.etag), "hex"));
  const combined = createHash("md5").update(Buffer.concat(digests)).digest("hex");
  return `${combined}-${ordered.length}`;
}

/**
 * The S3 multipart port. Rule 9: nothing here reads or writes payload bytes —
 * it initiates, signs, completes, inspects and aborts. The transfer itself
 * happens directly between the client and S3.
 */
export interface MultipartStore {
  createMultipartUpload(objectKey: string): Promise<string>;
  signParts(
    objectKey: string,
    uploadId: string,
    partNumbers: number[],
    ttlSeconds?: number,
  ): Promise<PartAuthorization[]>;
  completeMultipartUpload(
    objectKey: string,
    uploadId: string,
    parts: CompletedPart[],
  ): Promise<{ etag: string }>;
  headObject(objectKey: string): Promise<ObjectFacts>;
  abortMultipartUpload(objectKey: string, uploadId: string): Promise<void>;
}

export class S3MultipartStore implements MultipartStore {
  constructor(
    private readonly s3: S3Client,
    private readonly bucket: string,
  ) {}

  async createMultipartUpload(objectKey: string): Promise<string> {
    const out = await this.s3.send(
      new CreateMultipartUploadCommand({ Bucket: this.bucket, Key: objectKey }),
    );
    if (typeof out.UploadId !== "string" || out.UploadId.length === 0) {
      throw new Error("S3 did not return an upload id");
    }
    return out.UploadId;
  }

  async signParts(
    objectKey: string,
    uploadId: string,
    partNumbers: number[],
    ttlSeconds: number = PART_URL_TTL_SECONDS,
  ): Promise<PartAuthorization[]> {
    return Promise.all(
      partNumbers.map(async (partNumber) => ({
        partNumber,
        url: await getSignedUrl(
          this.s3,
          new UploadPartCommand({
            Bucket: this.bucket,
            Key: objectKey,
            UploadId: uploadId,
            PartNumber: partNumber,
          }),
          { expiresIn: ttlSeconds },
        ),
      })),
    );
  }

  async completeMultipartUpload(
    objectKey: string,
    uploadId: string,
    parts: CompletedPart[],
  ): Promise<{ etag: string }> {
    const out = await this.s3.send(
      new CompleteMultipartUploadCommand({
        Bucket: this.bucket,
        Key: objectKey,
        UploadId: uploadId,
        MultipartUpload: {
          Parts: [...parts]
            .sort((a, b) => a.partNumber - b.partNumber)
            .map((p) => ({ PartNumber: p.partNumber, ETag: p.etag })),
        },
      }),
    );
    return { etag: normalizeETag(out.ETag ?? "") };
  }

  async headObject(objectKey: string): Promise<ObjectFacts> {
    const out = await this.s3.send(
      new HeadObjectCommand({ Bucket: this.bucket, Key: objectKey }),
    );
    return {
      // A missing ContentLength must NOT read as zero: it would then "match"
      // a zero-byte registration and let an unverified object commit.
      sizeBytes: typeof out.ContentLength === "number" ? out.ContentLength : -1,
      etag: normalizeETag(out.ETag ?? ""),
    };
  }

  async abortMultipartUpload(objectKey: string, uploadId: string): Promise<void> {
    await this.s3.send(
      new AbortMultipartUploadCommand({
        Bucket: this.bucket,
        Key: objectKey,
        UploadId: uploadId,
      }),
    );
  }
}

/** Validates a client-submitted part list before any of it reaches S3. */
export function parseParts(raw: unknown): CompletedPart[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw badRequest("parts must be a non-empty array");
  }
  if (raw.length > MAX_PARTS) {
    throw badRequest(`parts may not exceed ${MAX_PARTS} entries`);
  }
  const seen = new Set<number>();
  return raw.map((entry: unknown) => {
    if (entry === null || typeof entry !== "object") {
      throw badRequest("each part must be an object");
    }
    const e = entry as Record<string, unknown>;
    const partNumber = e["partNumber"];
    if (
      typeof partNumber !== "number" ||
      !Number.isInteger(partNumber) ||
      partNumber < 1 ||
      partNumber > MAX_PARTS
    ) {
      throw badRequest(`partNumber must be an integer between 1 and ${MAX_PARTS}`);
    }
    if (seen.has(partNumber)) {
      throw badRequest("parts contains the same partNumber twice");
    }
    seen.add(partNumber);
    const etag = e["etag"];
    // An MD5 hex digest, quotes optional. Anything else cannot be an S3 part
    // ETag, and would make the derived object ETag meaningless.
    if (typeof etag !== "string" || !/^"?[0-9a-fA-F]{32}"?$/.test(etag.trim())) {
      throw badRequest("each part etag must be an MD5 hex digest");
    }
    return { partNumber, etag: normalizeETag(etag) };
  });
}
