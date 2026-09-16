import { randomUUID } from "node:crypto";
import {
  conflict,
  idempotencyKeyFromEvent,
  logger,
  notFound,
  userIdFromEvent,
} from "../../../shared/src/index.js";
import { errorResult, fileIdFromEvent, parseBody } from "./http.js";
import type { UploadRepository } from "./repository.js";
import { multipartETag, parseParts, type MultipartStore } from "./s3-multipart.js";
import type { HandlerResult } from "./types.js";

/** Which check rejected the object. Never carries a key, URL or credential. */
export type MismatchKind = "size" | "etag";

/**
 * Creator-facing text for each rejection. Deliberately says what disagreed and
 * nothing more — no key, no URL, no bucket, no S3 error string (invariant 6).
 */
const MISMATCH_MESSAGE: Record<MismatchKind, string> = {
  size: "The stored object's size does not match the registered manifest entry",
  etag: "The stored object's ETag does not match the parts that were uploaded",
};

/**
 * POST /uploads/{file_id}/complete
 *
 * The most correctness-critical handler in STASH, and the one Rule 4 names:
 * **never mark something Stashed that is not verified committed.**
 *
 * Order is the whole design:
 *
 *   1. resolve the file from the caller's OWN partition (cross-tenant → 404),
 *   2. CompleteMultipartUpload,
 *   3. HeadObject, and compare the assembled object's size against the
 *      registered manifest entry and its ETag against the ETag the submitted
 *      parts imply,
 *   4. only then a CONDITIONAL flip to `committed` guarded on `uploading`.
 *
 * A mismatch of either kind takes the file to `failed` and answers 409. It
 * never becomes `committed` — a truncated or reassembled-wrong object is
 * exactly what PRD §13 forbids presenting as Stashed.
 *
 * Spec §5, the subtle case: if step 2 succeeds and step 4 THROWS, the file is
 * deliberately left `uploading`. The write's outcome is unknown, so guessing
 * either way is wrong; `completeStash` reconciliation re-verifies it against
 * S3 later. The caller gets a 500, never a success.
 */
export function completeUpload(deps: {
  repo: UploadRepository;
  store: MultipartStore;
}) {
  return async (event: any): Promise<HandlerResult> => {
    try {
      // Rule 7: the subject claim, verified by the JWT authorizer. A user_id
      // in the body or path is attacker-controlled and never consulted.
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
          log.info("upload_complete_replayed", { file_id: fileId });
          return { statusCode: replay.statusCode, body: replay.body };
        }
      }

      const parts = parseParts(parseBody(event)["parts"]);

      const file = await deps.repo.findFile(userId, fileId);
      // Invariant 5: another creator's file is 404, not 403. Existence is not
      // disclosed, and S3 is not touched on the way to finding that out.
      if (file === undefined) throw notFound("file");

      if (file.state === "committed") {
        // Already verified and committed. Report the settled truth rather
        // than re-completing; this is a retry, not a new outcome.
        return persist(
          { statusCode: 200, body: JSON.stringify({ fileId, state: "committed" }) },
          deps,
          userId,
          fileId,
          idempotencyKey,
        );
      }
      if (file.state !== "uploading" || file.uploadId === undefined) {
        throw conflict("this file has no multipart upload in progress");
      }

      // Rule 6: the key is the one STORED at registration. Nothing in this
      // request contributes a single character of it.
      const objectKey = file.objectKey;
      const uploadId = file.uploadId;

      const completed = await deps.store.completeMultipartUpload(
        objectKey,
        uploadId,
        parts,
      );

      // --- Verification. Nothing below may write `committed` before this. ---
      const expectedETag = multipartETag(parts);
      const facts = await deps.store.headObject(objectKey);

      let mismatch: MismatchKind | undefined;
      if (facts.sizeBytes !== file.sizeBytes) {
        mismatch = "size";
      } else if (facts.etag !== expectedETag || completed.etag !== expectedETag) {
        mismatch = "etag";
      }

      if (mismatch !== undefined) {
        log.info("upload_verification_failed", {
          file_id: fileId,
          mismatch,
          expected_size: file.sizeBytes,
          actual_size: facts.sizeBytes,
        });
        // `failed` is terminal for this file. Quota stays reserved until
        // abortUpload or completeStash reconciliation releases it — releasing
        // it here would double-refund a client that then calls abort.
        await deps.repo.failFile(userId, fileId);
        const result: HandlerResult = {
          statusCode: 409,
          body: JSON.stringify({
            code: "upload_verification_failed",
            message: MISMATCH_MESSAGE[mismatch],
            mismatch,
          }),
        };
        return persist(result, deps, userId, fileId, idempotencyKey);
      }

      // --- Verified. Only now may the file become Stashed (Rule 4). ---
      const committed = await deps.repo.commitFile(userId, fileId);
      if (!committed) {
        // The guard lost: something else moved the file out of `uploading`.
        // Reporting success here would be the exact Rule 4 violation.
        throw conflict("this file is no longer in an uploading state");
      }

      log.info("upload_committed", { file_id: fileId, size_bytes: file.sizeBytes });
      return persist(
        { statusCode: 200, body: JSON.stringify({ fileId, state: "committed" }) },
        deps,
        userId,
        fileId,
        idempotencyKey,
      );
    } catch (err) {
      return errorResult(err);
    }
  };
}

async function persist(
  result: HandlerResult,
  deps: { repo: UploadRepository },
  userId: string,
  fileId: string,
  idempotencyKey: string | undefined,
): Promise<HandlerResult> {
  if (idempotencyKey !== undefined) {
    await deps.repo.putIdempotentResult(userId, fileId, idempotencyKey, result);
  }
  return result;
}
