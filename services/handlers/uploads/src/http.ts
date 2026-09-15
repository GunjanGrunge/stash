import { HttpError, badRequest } from "../../../shared/src/index.js";
import type { HandlerResult } from "./types.js";

/**
 * The request/response plumbing the three upload handlers share. Kept in one
 * place so an error-shaping fix cannot land in two handlers and miss the third.
 */

export function parseBody(event: any): Record<string, unknown> {
  const raw = event?.body;
  if (raw === undefined || raw === null) return {};
  if (typeof raw === "object") return raw as Record<string, unknown>;
  if (typeof raw !== "string") throw badRequest("request body must be a JSON object");
  if (raw.trim().length === 0) return {};
  try {
    const parsed = JSON.parse(raw);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw badRequest("request body must be a JSON object");
    }
    return parsed as Record<string, unknown>;
  } catch (err) {
    if (err instanceof HttpError) throw err;
    throw badRequest("request body must be valid JSON");
  }
}

const OPAQUE_ID = /^[A-Za-z0-9._-]+$/;

/**
 * Reads `{file_id}` from the path.
 *
 * It is validated as an opaque id purely so a malformed one is rejected
 * early — it is NEVER used to build an S3 key. The key always comes from the
 * stored File record (Rule 6), so a creative `file_id` cannot steer a write.
 */
export function fileIdFromEvent(event: any): string {
  const raw = event?.pathParameters?.["file_id"];
  if (typeof raw !== "string" || raw.length === 0) {
    throw badRequest("file_id is required");
  }
  if (!OPAQUE_ID.test(raw) || raw === "." || raw === "..") {
    throw badRequest("file_id must be an opaque id");
  }
  return raw;
}

/**
 * Maps a thrown error onto a response.
 *
 * An unexpected error becomes a flat 500 with a fixed message: an SDK error
 * string can carry a bucket name, a request id or a signed URL, and echoing it
 * to the caller would be exactly the leak invariant 6 forbids.
 */
export function errorResult(err: unknown): HandlerResult {
  if (err instanceof HttpError) {
    return {
      statusCode: err.status,
      body: JSON.stringify({ code: err.code, message: err.message }),
    };
  }
  return {
    statusCode: 500,
    body: JSON.stringify({ code: "internal_error", message: "Unexpected error" }),
  };
}
