import { HttpError, badRequest, conflict, notFound, userIdFromEvent } from "../../../shared/src/index.js";
import type { HandlerResult } from "./register-files.js";
import type { FolderRecord } from "./types.js";
import type { Repository } from "./repository.js";

const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

function folderIdFromEvent(event: any): string {
  const id = event?.pathParameters?.id;
  if (typeof id !== "string" || id.length === 0) throw badRequest("folder id is required in the path");
  return id;
}

export function folderTrashView(folder: FolderRecord): Record<string, unknown> {
  return { id: folder.folderId, entity: "FOLDER", state: "trashed", purgeAfter: folder.purgeAfter };
}

/** DELETE /folders/{id}: hide a whole folder tree for 30 days, recoverably. */
export function trashFolder(deps: { repo: Repository; now?: () => Date }) {
  return async (event: any): Promise<HandlerResult> => {
    try {
      const userId = userIdFromEvent(event);
      const folderId = folderIdFromEvent(event);
      const existing = await deps.repo.findFolderById(userId, folderId);
      if (existing === undefined) throw notFound("folder");
      if (existing.state === "purging") throw conflict("folder is being permanently purged");
      const deletedAt = (deps.now?.() ?? new Date()).toISOString();
      const purgeAfter = new Date(Date.parse(deletedAt) + RETENTION_MS).toISOString();
      const folder = await deps.repo.trashFolder(userId, folderId, deletedAt, purgeAfter);
      if (folder === undefined) throw notFound("folder");
      return { statusCode: 200, body: JSON.stringify(folderTrashView(folder)) };
    } catch (err) {
      if (err instanceof HttpError) return { statusCode: err.status, body: JSON.stringify({ code: err.code, message: err.message }) };
      return { statusCode: 500, body: JSON.stringify({ code: "internal_error", message: "Unexpected error" }) };
    }
  };
}
