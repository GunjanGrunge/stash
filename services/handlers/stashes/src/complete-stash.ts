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
import { manifestHash } from "../../manifest/src/manifest-hash.js";
import type { ManifestRepository } from "../../manifest/src/repository.js";

/**
 * POST /stashes/{id}/complete — finalize a Stash (spec §4 step 9).
 *
 * Re-counts the Stash's files through GSI2, corrects the reservation to the
 * ACTUAL committed total, and closes the Stash as `completed`.
 *
 * Rule 4 is the whole point of the re-count: this handler counts files that
 * are ALREADY in state `committed` and never promotes one. A file only reaches
 * `committed` through `completeUpload`'s verification against S3, so a failed
 * transfer cannot be swept into a "successful" Stash by finalizing it. Nothing
 * here writes a file state at all.
 *
 * Reconciliation is signed and runs in BOTH directions:
 *   - committed < reserved (files skipped, cancelled, or failed) hands the
 *     difference back — otherwise every partial Stash permanently leaks quota;
 *   - committed > reserved (the manifest under-declared) charges the
 *     difference — otherwise a creator stores bytes nobody accounts for.
 * The delta is applied unconditionally: the bytes are already in S3, so
 * refusing to record them would leave `usedBytes` lying about real storage.
 *
 * The count-then-write sequence is made safe by the same `state = "open"`
 * guard `cancelStash` uses — a second complete loses it and reconciles nothing.
 */
export function completeStash(deps: { repo: StashRepository; manifests?: ManifestRepository }) {
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
          log.info("stash_complete_replayed", { stash_id: stashId });
          return { statusCode: replay.statusCode, body: replay.body };
        }
      }

      // Scoped by the JWT subject: another creator's Stash is unaddressable,
      // so the honest answer is 404 and existence stays undisclosed.
      const stash = await deps.repo.getStash(userId, stashId);
      if (stash === undefined) throw notFound("stash");
      if (stash.state !== "open") throw conflict("stash is not open");

      const files = await deps.repo.listStashFiles(userId, stashId);
      const committed = files.filter((f) => f.state === "committed");
      const committedBytes = committed.reduce((sum, f) => sum + f.sizeBytes, 0);
      const committedCount = committed.length;
      const deltaBytes = committedBytes - stash.reservedBytes;

      const result: HandlerResult = {
        statusCode: 200,
        body: JSON.stringify({
          stashId,
          state: "completed",
          committedCount,
          committedBytes,
          reconciledBytes: deltaBytes,
        }),
      };

      let manifest: Record<string, unknown> | undefined;
      if (deps.manifests !== undefined && stash.manifestFolderName !== undefined) {
        const entries = committed.map((file) => ({ relativePath: file.originalRelativePath, sizeBytes: file.sizeBytes, checksum: file.checksum }));
        const rootIds = new Set(committed.map((file) => file.rootFolderId));
        if (entries.some((entry) => typeof entry.relativePath !== "string" || typeof entry.checksum !== "string") || rootIds.size !== 1 || rootIds.has(undefined)) {
          throw new Error("verified committed files lack selected-root manifest metadata");
        }
        const folderId = [...rootIds][0]!;
        const hash = manifestHash(stash.manifestFolderName, entries as any);
        manifest = { pk: `USER#${userId}`, sk: `MANIFEST#${hash}`, entity: "MANIFEST", manifestHash: hash,
          folderId, folderName: stash.manifestFolderName, fileCount: entries.length, totalBytes: committedBytes, entries };
      }

      await deps.repo.completeStash({
        userId,
        stashId,
        deltaBytes,
        committedCount,
        committedBytes,
        manifest,
        idempotency:
          idempotencyKey === undefined
            ? undefined
            : { key: idempotencyKey, result },
      });


      log.info("stash_completed", {
        stash_id: stashId,
        committed_count: committedCount,
        committed_bytes: committedBytes,
        reconciled_bytes: deltaBytes,
      });
      return result;
    } catch (err) {
      return errorResult(err);
    }
  };
}
