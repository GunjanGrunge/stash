import { badRequest } from "./errors.js";

/**
 * Rule 6: S3 object keys are `users/<user_id>/<file_id>` and contain opaque
 * IDs only. Creator-supplied paths and filenames NEVER enter a key — the
 * original relative path lives in DynamoDB, not in storage layout.
 */
export function objectKey(userId: string, fileId: string): string {
  assertOpaqueId(userId, "user_id");
  assertOpaqueId(fileId, "file_id");
  return `users/${userId}/${fileId}`;
}

const OPAQUE_ID = /^[A-Za-z0-9._-]+$/;

function assertOpaqueId(value: string, label: string): void {
  if (typeof value !== "string" || value.length === 0) {
    throw badRequest(`${label} must be a non-empty opaque id`);
  }
  if (!OPAQUE_ID.test(value) || value === "." || value === "..") {
    throw badRequest(`${label} must be an opaque id`);
  }
}
