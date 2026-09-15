import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { S3Client } from "@aws-sdk/client-s3";

/**
 * The production wiring every entry module shares.
 *
 * Everything here is MODULE scope on purpose: a Lambda execution environment
 * is reused across warm invocations, so building an SDK client per request
 * would re-resolve credentials and re-open connections on every call and pay
 * that cost on the creator's upload path.
 *
 * Nothing in this file contains business logic. It resolves configuration and
 * constructs clients; the rules live in the handler packages, which are
 * dependency-injected and stay testable without AWS.
 */

/**
 * Configuration comes from the environment ONLY — never from the request.
 * A table or bucket name taken from a request body would let a caller point a
 * handler at storage that is not theirs, which no amount of IAM scoping fixes
 * once the name is attacker-chosen.
 */
function requiredEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    // Failing at module load is deliberate: a misconfigured function should
    // never serve one request against the wrong table.
    throw new Error(`${name} is not set`);
  }
  return value;
}

/** The STASH single table (spec §3.2). */
export const TABLE_NAME = requiredEnv("STASH_TABLE_NAME");

/**
 * The object bucket. Only the upload entry modules read it; the others never
 * touch S3 at all, so they never resolve it.
 */
export function bucketName(): string {
  return requiredEnv("STASH_BUCKET_NAME");
}

/**
 * One document client for the whole execution environment. The region and
 * credentials come from the Lambda environment, so nothing is configured here
 * that could pin the function to the wrong account (Rule 12: no credential
 * ever appears in this repository).
 */
export const documentClient: DynamoDBDocumentClient = DynamoDBDocumentClient.from(
  new DynamoDBClient({}),
);

/** One S3 client, used for multipart control calls and presigning only (Rule 9). */
export const s3Client: S3Client = new S3Client({});
