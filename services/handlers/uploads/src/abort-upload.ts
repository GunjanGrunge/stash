import { randomUUID } from "node:crypto";
import { NoSuchUpload } from "@aws-sdk/client-s3";
import {
  conflict,
  idempotencyKeyFromEvent,
  logger,
  notFound,
  userIdFromEvent,
} from "../../../shared/src/index.js";
import { errorResult, fileIdFromEvent } from "./http.js";
import type { UploadRepository } from "./repository.js";
import type { MultipartStore } from "./s3-multipart.js";
import type { HandlerResult } from "./types.js";

/**
 * True when S3 says the multipart upload is already gone — a prior abort, or
 * the 7-day lifecycle rule (spec §3.3) got there first. That is the outcome
 * this handler wants, so it must not block the quota release behind it.
 */
function isAlreadyGone(error: unknown): boolean {
  if (error instanceof NoSuchUpload) return true;
  const name = (error as { name?: string } | undefined)?.name;
  return name === "NoSuchUpload";
}

/**
 * POST /uploads/{file_id}/abort
 *
 * Abandons one file's transfer and hands its reserved quota back.
 *
 * The whole design constraint is that this is **safe to call twice**. A client
 * that loses its connection mid-abort will retry, and a naive implementation
 * would decrement `usedBytes` once per call — quietly gifting the creator the
 * file's size in free quota on every retry. So the state flip and the refund
 * happen in ONE conditional write guarded by a once-only flag: the second
 * abort finds the guard already lost, refunds nothing, and still answers 200
 * because the file really is aborted.
 *
 * `quotaReleased` in the response says which call did the releasing, so a
 * caller can tell a real abort from a no-op replay without either being an
 * error.
 */
export function abortUpload(deps: {
  repo: UploadRepository;
  store: MultipartStore;
}) {
  return async (event: any): Promise<HandlerResult> => {
    try {
      // Rule 7: verified JWT claim only.
      const userId = userIdFromEvent(event);
      const fileId = fileIdFromEvent(event);
      const idempotencyKey = idempotencyKeyFromEvent(event);
      const log = logger(idempotencyKey ?? randomUUID());

      if (idempotencyKey !== undefined) {
        const replay = await deps.repo.getIdempotentResult(
          userId,
          fileId,
          idempotencyKey,
        );
        if (replay !== undefined) {
          log.info("upload_abort_replayed", { file_id: fileId });
          return { statusCode: replay.statusCode, body: replay.body };
        }
      }

      const file = await deps.repo.findFile(userId, fileId);
      // Invariant 5: 404, not 403.
      if (file === undefined) throw notFound("file");

      if (file.state === "committed") {
        // Its bytes are genuinely stored and verified. Releasing quota here
        // would under-count real usage against the creator's 1 TB.
        throw conflict("this file is already committed and cannot be aborted");
      }

      if (file.uploadId !== undefined) {
        try {
          // Rule 6: key from the stored record.
          await deps.store.abortMultipartUpload(file.objectKey, file.uploadId);
        } catch (err) {
          if (!isAlreadyGone(err)) throw err;
          log.info("upload_abort_already_gone", { file_id: fileId });
        }
      }

      // Atomic: mark failed AND refund, at most once. `false` means a previous
      // abort already did it — not an error, just nothing left to refund.
      const released = await deps.repo.abortAndReleaseQuota(
        userId,
        fileId,
        file.sizeBytes,
      );

      log.info("upload_aborted", {
        file_id: fileId,
        quota_released: released,
        released_bytes: released ? file.sizeBytes : 0,
      });

      const result: HandlerResult = {
        statusCode: 200,
        body: JSON.stringify({
          fileId,
          state: "failed",
          quotaReleased: released,
        }),
      };
      if (idempotencyKey !== undefined) {
        await deps.repo.putIdempotentResult(userId, fileId, idempotencyKey, result);
      }
      return result;
    } catch (err) {
      return errorResult(err);
    }
  };
}
