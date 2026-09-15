import { HttpError, badRequest } from "../../../shared/src/index.js";

export interface HandlerResult {
  statusCode: number;
  body: string;
}

export function parseBody(event: any): Record<string, unknown> {
  const raw = event?.body;
  if (raw === undefined || raw === null) throw badRequest("request body is required");
  if (typeof raw === "object") return raw as Record<string, unknown>;
  if (typeof raw !== "string") throw badRequest("request body is required");
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

/**
 * Reads `{id}` from the path.
 *
 * This is a resource NAME, never an identity: it is always paired with the
 * caller's JWT subject before anything is read or written (Rule 7).
 */
export function stashIdFromPath(event: any): string {
  const id = event?.pathParameters?.id;
  if (typeof id !== "string" || id.length === 0) {
    throw badRequest("stash id is required in the path");
  }
  return id;
}

/**
 * Rule 12 / invariant 6: the response body carries the typed code and the
 * creator-facing message only. An unexpected error is flattened to a bare 500
 * so no internal detail — table names, ARNs, stack frames — can leak out.
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

/** DynamoDB numbers are exact only inside the safe-integer range. */
export function requireByteCount(value: unknown, field: string): number {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 0 ||
    value > Number.MAX_SAFE_INTEGER
  ) {
    throw badRequest(`${field} must be a non-negative integer`);
  }
  return value;
}
