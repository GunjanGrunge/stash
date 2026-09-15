import { randomUUID } from "node:crypto";
import {
  conflict,
  idempotencyKeyFromEvent,
  logger,
  notFound,
  userIdFromEvent,
} from "../../../shared/src/index.js";
import { errorResult, stashIdFromPath, type HandlerResult } from "./http.js";
import type { StashRepository } from "./repository.js";

/**
 * POST /stashes/{id}/cancel — abandon an open Stash (spec §5).
 *
 * Without this handler, cancelling a 4.2 GB dedupe check strands 4.2 GB of the
 * creator's quota with no way to get it back. So it hands the reservation back
 * and closes the Stash as `cancelled`, deleting the `pending` file records the
 * Stash created.
 *
 * DOUBLE-CANCEL is the defect this guards against. The release and the state
 * flip happen in ONE write guarded on `state = "open"`: the second call loses
 * the guard, the whole write is cancelled, and nothing is released. A design
 * that released first and flipped afterwards would let two cancels of a 4.2 GB
 * Stash drive `usedBytes` to -4.2 GB — permanent free storage.
 *
 * Only the OUTSTANDING reservation is released (`reservedBytes -
 * committedBytes`). Committed bytes are real objects in S3; handing their
 * quota back would under-count storage the creator is actually using. In the
 * spec's scenario — cancel at the duplicate-folder dialog, before any upload —
 * `committedBytes` is 0, so this is the full reservation.
 *
 * Deletion runs BEFORE the close, so a failure mid-deletion leaves the Stash
 * `open` with its reservation intact and the retry is safe. Only `pending`
 * records are deleted: nothing that has bytes in S3 is ever removed here.
 */
export function cancelStash(deps: { repo: StashRepository }) {
  return async (event: any): Promise<HandlerResult> => {
    try {
      const userId = userIdFromEvent(event);
      const stashId = stashIdFromPath(event);
      const idempotencyKey = idempotencyKeyFromEvent(event);
      const log = logger(idempotencyKey ?? randomUUID());

      if (idempotencyKey !== undefined) {
        const replay = await deps.repo.getIdempotentResult(
          userId,
          stashId,
          idempotencyKey,
        );
        if (replay !== undefined) {
          log.info("stash_cancel_replayed", { stash_id: stashId });
          return { statusCode: replay.statusCode, body: replay.body };
        }
      }

      // Scoped by the JWT subject, so another creator's Stash is not merely
      // forbidden — it is unaddressable, and the answer is 404, never 403.
      const stash = await deps.repo.getStash(userId, stashId);
      if (stash === undefined) throw notFound("stash");
      // A cheap early exit so an already-closed Stash does not have its file
      // records touched. It is NOT the safety property — the conditional write
      // below is, because this read can be stale by the time the write lands.
      if (stash.state !== "open") throw conflict("stash is not open");

      const releaseBytes = Math.max(0, stash.reservedBytes - stash.committedBytes);

      const files = await deps.repo.listStashFiles(userId, stashId);
      const pending = files.filter((f) => f.state === "pending").map((f) => f.fileId);
      if (pending.length > 0) {
        await deps.repo.deleteFiles(userId, pending);
      }

      const result: HandlerResult = {
        statusCode: 200,
        body: JSON.stringify({
          stashId,
          state: "cancelled",
          releasedBytes: releaseBytes,
          deletedPendingFiles: pending.length,
        }),
      };

      await deps.repo.cancelStash({
        userId,
        stashId,
        releaseBytes,
        idempotency:
          idempotencyKey === undefined
            ? undefined
            : { key: idempotencyKey, result },
      });

      log.info("stash_cancelled", {
        stash_id: stashId,
        released_bytes: releaseBytes,
        deleted_pending_files: pending.length,
      });
      return result;
    } catch (err) {
      return errorResult(err);
    }
  };
}
