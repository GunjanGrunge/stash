import { HttpError, badRequest, notFound, userIdFromEvent } from "../../../shared/src/index.js";
import type { HandlerResult } from "./register-files.js";
import type { Repository } from "./repository.js";

function folderIdFromEvent(event: any): string {
  const id = event?.pathParameters?.id;
  if (typeof id !== "string" || id.length === 0) throw badRequest("folder id is required in the path");
  return id;
}

/** POST /folders/{id}/restore: restores the original parent and hierarchy. */
export function restoreFolder(deps: { repo: Repository }) {
  return async (event: any): Promise<HandlerResult> => {
    try {
      const folder = await deps.repo.restoreFolder(userIdFromEvent(event), folderIdFromEvent(event));
      if (folder === undefined) throw notFound("folder");
      return { statusCode: 200, body: JSON.stringify({ id: folder.folderId, entity: "FOLDER", state: "active" }) };
    } catch (err) {
      if (err instanceof HttpError) return { statusCode: err.status, body: JSON.stringify({ code: err.code, message: err.message }) };
      return { statusCode: 500, body: JSON.stringify({ code: "internal_error", message: "Unexpected error" }) };
    }
  };
}
