import { randomUUID } from "node:crypto";
import {
  badRequest,
  idempotencyKeyFromEvent,
  logger,
  userIdFromEvent,
} from "../../../shared/src/index.js";
import {
  errorResult,
  parseBody,
  requireByteCount,
  type HandlerResult,
} from "./http.js";
import { CREATE_SCOPE, type StashRepository } from "./repository.js";
import type { StashRecord } from "./types.js";

/**
 * POST /stashes — open a Stash and reserve its quota (spec §4 step 3).
 *
 * Two writes, one transaction: the Stash record in state `open`, and a
 * CONDITIONAL reservation of `usedBytes + manifestTotal` against the profile,
 * guarded by `usedBytes + :n <= quotaBytes`. Either both land or neither does.
 * A Stash without its reservation would let a creator open Stashes until the
 * bucket is full; a reservation without its Stash would strand quota nobody
 * can release. Both are prevented structurally rather than by ordering.
 *
 * The quota check is the SERVER's, not the client's (PRD §12). The handler
 * never reads usedBytes and decides; it states the intent and lets the
 * conditional write adjudicate, so two concurrent creates cannot both pass a
 * check that only one of them should.
 *
 * Rule 7: `user_id` comes from the verified JWT claim only. A `user_id` in the
 * body is inert — it is never read, so it can never redirect the reservation.
 */
export function createStash(deps: { repo: StashRepository }) {
  return async (event: any): Promise<HandlerResult> => {
    try {
      const userId = userIdFromEvent(event);
      const idempotencyKey = idempotencyKeyFromEvent(event);
      const log = logger(idempotencyKey ?? randomUUID());
      const body = parseBody(event);

      if (idempotencyKey !== undefined) {
        const replay = await deps.repo.getIdempotentResult(
          userId,
          CREATE_SCOPE,
          idempotencyKey,
        );
        if (replay !== undefined) {
          log.info("stash_create_replayed", {});
          return { statusCode: replay.statusCode, body: replay.body };
        }
      }

      const reserveBytes = requireByteCount(
        body["manifestTotalBytes"],
        "manifestTotalBytes",
      );
      const fileCount =
        body["manifestFileCount"] === undefined
          ? 0
          : requireByteCount(body["manifestFileCount"], "manifestFileCount");
      // A folder Stash names its folder; loose files omit it so each file
      // lands as itself. Either way the destination is an existing folder
      // (validated at registration) or the top level.
      const rawFolderName = body["manifestFolderName"];
      let manifestFolderName: string | undefined;
      if (rawFolderName !== undefined && rawFolderName !== null) {
        if (typeof rawFolderName !== "string" || rawFolderName.length === 0 || rawFolderName.length > 255 || /[\\/]/.test(rawFolderName) || rawFolderName === "." || rawFolderName === "..") {
          throw badRequest("manifestFolderName must be a single folder name");
        }
        manifestFolderName = rawFolderName;
      }
      const rawParent = body["parentFolderId"];
      let parentFolderId: string | undefined;
      if (rawParent !== undefined && rawParent !== null) {
        if (typeof rawParent !== "string" || rawParent.length === 0 || rawParent.length > 128) {
          throw badRequest("parentFolderId must be a folder id");
        }
        parentFolderId = rawParent;
      }

      const stashId = randomUUID();
      const now = new Date().toISOString();
      const stash: StashRecord = {
        pk: `USER#${userId}`,
        sk: `STASH#${stashId}`,
        entity: "STASH",
        stashId,
        state: "open",
        fileCount,
        committedCount: 0,
        reservedBytes: reserveBytes,
        committedBytes: 0,
        ...(manifestFolderName !== undefined ? { manifestFolderName } : {}),
        ...(parentFolderId !== undefined ? { parentFolderId } : {}),
        startedAt: now,
        updatedAt: now,
      };

      const result: HandlerResult = {
        statusCode: 201,
        body: JSON.stringify({ stashId, state: "open", reservedBytes: reserveBytes }),
      };

      // The replay record rides inside the SAME transaction as the
      // reservation, so there is no window in which quota is reserved but the
      // retry that would replay it is not yet recorded.
      await deps.repo.createStash({
        userId,
        stash,
        reserveBytes,
        idempotency:
          idempotencyKey === undefined
            ? undefined
            : { key: idempotencyKey, result },
      });

      log.info("stash_created", {
        stash_id: stashId,
        reserved_bytes: reserveBytes,
        file_count: fileCount,
      });
      return result;
    } catch (err) {
      return errorResult(err);
    }
  };
}
