import { HttpError, badRequest, notFound, userIdFromEvent } from "../../../shared/src/index.js";
import type { HandlerResult } from "./register-files.js";
import type { Repository } from "./repository.js";

function fileIdFromEvent(event: any): string {
  const id = event?.pathParameters?.id;
  if (typeof id !== "string" || id.length === 0) throw badRequest("file id is required in the path");
  return id;
}

/** POST /files/{id}/restore: restore only before the retention worker claims it. */
export function restoreFile(deps: { repo: Repository }) {
  return async (event: any): Promise<HandlerResult> => {
    try {
      const file = await deps.repo.restoreFile(userIdFromEvent(event), fileIdFromEvent(event));
      if (file === undefined) throw notFound("file");
      return { statusCode: 200, body: JSON.stringify({ id: file.fileId, state: "committed" }) };
    } catch (err) {
      if (err instanceof HttpError) return { statusCode: err.status, body: JSON.stringify({ code: err.code, message: err.message }) };
      return { statusCode: 500, body: JSON.stringify({ code: "internal_error", message: "Unexpected error" }) };
    }
  };
}
