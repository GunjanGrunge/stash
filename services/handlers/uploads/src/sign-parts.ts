import { randomUUID } from "node:crypto";
import {
  badRequest,
  conflict,
  idempotencyKeyFromEvent,
  logger,
  notFound,
  userIdFromEvent,
} from "../../../shared/src/index.js";
import { errorResult, fileIdFromEvent, parseBody } from "./http.js";
import type { UploadRepository } from "./repository.js";
import {
  MAX_PARTS,
  PART_URL_TTL_SECONDS,
  type MultipartStore,
} from "./s3-multipart.js";
import type { HandlerResult } from "./types.js";

/**
 * POST /uploads/{file_id}/parts
 *
 * Rule 9 in one handler: it signs, it does not carry bytes. The client PUTs
 * every part straight to S3 against these URLs; no payload ever transits
 * Lambda or API Gateway.
 *
 * Rule 6: the S3 key is read from the STORED File record. Nothing in the
 * request — not the path, not the body — contributes to it, which is what
 * makes key injection structurally impossible rather than merely filtered.
 *
 * Invariant 6: the returned URLs are bearer credentials for writing into the
 * creator's namespace. They are returned to the caller and NEVER logged; the
 * log line carries counts and the file id only.
 */
export function signParts(deps: {
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
          log.info("upload_parts_replayed", { file_id: fileId });
          return { statusCode: replay.statusCode, body: replay.body };
        }
      }

      const partCount = parsePartCount(parseBody(event)["partCount"]);

      const file = await deps.repo.findFile(userId, fileId);
      // Invariant 5: 404, not 403 — and S3 is never touched on this path, so
      // a cross-tenant probe cannot even be detected by upload timing.
      if (file === undefined) throw notFound("file");

      if (file.state === "committed") {
        // Rule 8: S3 versioning is off, so re-opening a committed key would
        // set up an unrecoverable overwrite. A new Stash gets a new file_id.
        throw conflict("this file is already committed");
      }
      if (file.state === "failed") {
        throw conflict("this file is marked failed and cannot be resumed");
      }

      const objectKey = file.objectKey;
      let uploadId: string;

      if (file.state === "uploading" && file.uploadId !== undefined) {
        // Spec §4 step 7: failed parts are retried against a RE-SIGNED URL.
        // Re-initiating here would orphan every part already uploaded and
        // leave a second multipart upload silently accruing storage.
        uploadId = file.uploadId;
      } else {
        uploadId = await deps.store.createMultipartUpload(objectKey);
        // The conditional pending -> uploading flip. A concurrent caller that
        // already moved the file loses here and gets 409 rather than a second
        // authorization against the same key.
        const began = await deps.repo.beginUpload(userId, fileId, uploadId);
        if (!began) {
          throw conflict("this file is no longer pending");
        }
      }

      const partNumbers = Array.from({ length: partCount }, (_, i) => i + 1);
      const parts = await deps.store.signParts(
        objectKey,
        uploadId,
        partNumbers,
        PART_URL_TTL_SECONDS,
      );

      // Counts only. Never a URL, a signature, a credential or the upload id.
      log.info("upload_parts_signed", {
        file_id: fileId,
        part_count: parts.length,
        ttl_seconds: PART_URL_TTL_SECONDS,
      });

      const result: HandlerResult = {
        statusCode: 200,
        body: JSON.stringify({
          fileId,
          parts,
          expiresInSeconds: PART_URL_TTL_SECONDS,
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

function parsePartCount(raw: unknown): number {
  if (
    typeof raw !== "number" ||
    !Number.isInteger(raw) ||
    raw < 1 ||
    raw > MAX_PARTS
  ) {
    throw badRequest(`partCount must be an integer between 1 and ${MAX_PARTS}`);
  }
  return raw;
}
