import { HttpError, notFound, userIdFromEvent } from "../../../shared/src/index.js";
import type { Repository } from "./repository.js";
import type { EntityRecord } from "./types.js";
import type { HandlerResult } from "./register-files.js";

/** Byte-order comparison: matches how DynamoDB orders gsi1sk. */
function byName(a: EntityRecord, b: EntityRecord): number {
  return Buffer.compare(
    Buffer.from(a.name, "utf8"),
    Buffer.from(b.name, "utf8"),
  );
}

function parentFromEvent(event: any): string | null {
  const params = (event?.pathParameters ?? {}) as Record<string, string | undefined>;
  const raw = params["folderId"] ?? params["parentFolderId"];
  if (raw === undefined || raw === null || raw === "" || raw === "ROOT") return null;
  return raw;
}

/**
 * GET /folders/{folderId}/children — list one folder's direct children.
 *
 * Rule 7: the creator is taken from the verified claim, so the pk is never
 * attacker-chosen and another user's items can never be reached.
 */
export function listChildren(deps: { repo: Repository }) {
  return async (event: any): Promise<HandlerResult> => {
    try {
      const userId = userIdFromEvent(event);
      const parentFolderId = parentFromEvent(event);
      // A folderId that does not belong to this caller must be
      // INDISTINGUISHABLE from one that does not exist: 404, never an empty
      // 200. An empty 200 discloses existence to a probing client. The
      // caller's OWN empty folder still returns 200 with an empty list.
      if (parentFolderId !== null) {
        const folder = await deps.repo.findFolderById(userId, parentFolderId);
        if (folder === undefined) throw notFound("folder");
      }
      const items = await deps.repo.listChildren(userId, parentFolderId);
      const sorted = [...items].sort(byName);
      return {
        statusCode: 200,
        body: JSON.stringify({
          parentFolderId: parentFolderId ?? "ROOT",
          items: sorted,
        }),
      };
    } catch (err) {
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
  };
}
