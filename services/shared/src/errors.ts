/**
 * Typed HTTP errors shared by every STASH Lambda handler.
 *
 * Handlers throw these; the handler shell maps `status`/`code` onto the
 * API Gateway response. Messages are creator-facing, so they must never
 * carry credentials, internal identifiers or stack detail (Rule 12).
 */
export class HttpError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.code = code;
    Object.setPrototypeOf(this, HttpError.prototype);
  }
}

/** 404 — the requested resource does not exist for this caller. */
export const notFound = (what: string): HttpError =>
  new HttpError(404, "not_found", `${what} not found`);

/** 507 — the creator's storage quota would be exceeded by this operation. */
export const quotaExceeded = (): HttpError =>
  new HttpError(507, "quota_exceeded", "Storage quota exceeded");

/** 409 — the operation conflicts with the current state of the resource. */
export const conflict = (message: string): HttpError =>
  new HttpError(409, "conflict", message);

/** 400 — the request itself is malformed or violates an input invariant. */
export const badRequest = (message: string): HttpError =>
  new HttpError(400, "bad_request", message);
