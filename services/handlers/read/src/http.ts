import { HttpError } from "../../../shared/src/index.js";
import type { HandlerResult } from "./types.js";

/**
 * Maps a thrown error onto an API Gateway response.
 *
 * Rule 12 / invariant 6: only typed `HttpError` messages reach the creator.
 * Anything else collapses to a flat 500 — an SDK error can carry endpoints,
 * ARNs or request metadata, none of which belong in a response body.
 */
export function toErrorResponse(err: unknown): HandlerResult {
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
