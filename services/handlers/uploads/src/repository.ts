import type { UploadFileRecord } from "./types.js";

/** A previously-returned handler outcome, replayed verbatim on retry. */
export interface IdempotentResult {
  statusCode: number;
  body: string;
}

/**
 * The narrow persistence port the upload handlers depend on.
 *
 * Every state transition below is a CONDITIONAL write, and every method
 * returns `false` — rather than throwing — when its guard loses. That
 * distinction is load-bearing: a lost guard means someone else already moved
 * the file and the caller must not proceed, whereas a thrown error means the
 * write's outcome is UNKNOWN and the file must be left where it is for
 * reconciliation (spec §5). Collapsing the two would let a failed DynamoDB
 * write present as a completed Stash.
 */
export interface UploadRepository {
  /**
   * Point read scoped to the caller's own partition. A file belonging to
   * another creator is not "denied", it is unaddressable — so this returns
   * undefined and the handler answers 404, never 403 (invariant 5).
   */
  findFile(userId: string, fileId: string): Promise<UploadFileRecord | undefined>;

  /**
   * `pending` -> `uploading`, recording the S3 multipart upload id.
   * Conditional on the file still being `pending`; false if it is not.
   */
  beginUpload(userId: string, fileId: string, uploadId: string): Promise<boolean>;

  /**
   * `uploading` -> `committed`. Rule 4: the ONLY transition into `committed`,
   * conditional on `state = "uploading"`, and callers must have verified the
   * S3 object before invoking it.
   */
  commitFile(userId: string, fileId: string): Promise<boolean>;

  /** `uploading` -> `failed`. Used when verification rejects the object. */
  failFile(userId: string, fileId: string): Promise<boolean>;

  /**
   * Marks the file `failed` AND releases its reserved quota, atomically and
   * AT MOST ONCE. Returns false when the release already happened, so a
   * second abort is a no-op rather than a second refund.
   */
  abortAndReleaseQuota(
    userId: string,
    fileId: string,
    sizeBytes: number,
  ): Promise<boolean>;

  /** Replay support: the stored outcome of a previous (user, file, key) call. */
  getIdempotentResult(
    userId: string,
    fileId: string,
    key: string,
  ): Promise<IdempotentResult | undefined>;

  putIdempotentResult(
    userId: string,
    fileId: string,
    key: string,
    result: IdempotentResult,
  ): Promise<void>;
}
