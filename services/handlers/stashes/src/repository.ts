import type { StashFileRef, StashRecord, UserProfileRecord } from "./types.js";

/** A previously-returned handler outcome, replayed verbatim on retry. */
export interface IdempotentResult {
  statusCode: number;
  body: string;
}

/**
 * The idempotency namespace a replay record lives in. `createStash` has no
 * stashId yet when the key is first seen, so the scope is a constant; the
 * per-Stash operations scope by stashId, matching the files package's
 * `IDEMPOTENCY#<hex(scope)>#<hex(key)>` sort key.
 */
export const CREATE_SCOPE = "CREATE_STASH";

export interface CreateStashInput {
  userId: string;
  stash: StashRecord;
  /** Manifest total to reserve. The reservation and the Stash write are ATOMIC. */
  reserveBytes: number;
  idempotency?: { key: string; result: IdempotentResult };
}

export interface CancelStashInput {
  userId: string;
  stashId: string;
  /**
   * The still-outstanding reservation to hand back. Must be applied only if
   * the Stash is still `open`, or a second cancel releases the same bytes
   * twice and gifts the creator unlimited storage.
   */
  releaseBytes: number;
  idempotency?: { key: string; result: IdempotentResult };
}

export interface CompleteStashInput {
  userId: string;
  stashId: string;
  /**
   * Signed reconciliation: `committedBytes - reservedBytes`. Negative hands
   * back an over-reservation, positive records an under-reservation. Both
   * directions occur in practice, so neither may be clamped away.
   */
  deltaBytes: number;
  committedCount: number;
  committedBytes: number;
  idempotency?: { key: string; result: IdempotentResult };
}

/**
 * The narrow persistence port the Stash handlers depend on. Implemented in
 * memory for handler tests and by DynamoDB in production.
 *
 * Every method takes `userId` from the caller's verified JWT claim and scopes
 * its keys by it, so a cross-tenant read is unaddressable rather than merely
 * denied — which is what makes a cross-tenant request a 404 and not a 403.
 */
export interface StashRepository {
  getProfile(userId: string): Promise<UserProfileRecord | undefined>;

  getStash(userId: string, stashId: string): Promise<StashRecord | undefined>;

  /**
   * Writes the Stash record AND the quota reservation in ONE transaction.
   * Throws `quotaExceeded()` (507) when `usedBytes + reserveBytes` would pass
   * `quotaBytes`, having written nothing: a Stash must never exist without its
   * reservation, nor a reservation without its Stash.
   */
  createStash(input: CreateStashInput): Promise<void>;

  /**
   * Flips the Stash to `cancelled` and releases `releaseBytes` in ONE
   * transaction, guarded on the Stash still being `open`. Throws
   * `conflict()` (409) when the guard loses — that guard is the whole
   * defence against a double release.
   */
  cancelStash(input: CancelStashInput): Promise<void>;

  /**
   * Flips the Stash to `completed`, writes the verified counts and applies the
   * signed reconciliation delta, in ONE transaction guarded on `open`.
   * Throws `conflict()` (409) when the guard loses.
   */
  completeStash(input: CompleteStashInput): Promise<void>;

  /** Every FILE registered against this Stash, read through GSI2. */
  listStashFiles(userId: string, stashId: string): Promise<StashFileRef[]>;

  /**
   * Deletes FILE records by id. Callers pass only `pending` ids: nothing that
   * has bytes in S3 is ever removed by a Stash operation.
   */
  deleteFiles(userId: string, fileIds: string[]): Promise<void>;

  /** Replay support: the stored outcome of a previous (user, scope, key) call. */
  getIdempotentResult(
    userId: string,
    scope: string,
    key: string,
  ): Promise<IdempotentResult | undefined>;
}
