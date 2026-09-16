import { HttpError, badRequest, conflict, notFound, userIdFromEvent } from "../../../shared/src/index.js";
import type { HandlerResult } from "./register-files.js";
import type { FileRecord } from "./types.js";
import type { Repository } from "./repository.js";

const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

function fileIdFromEvent(event: any): string {
  const id = event?.pathParameters?.id;
  if (typeof id !== "string" || id.length === 0) throw badRequest("file id is required in the path");
  return id;
}

export function trashView(file: FileRecord): Record<string, unknown> {
  return { id: file.fileId, state: "trashed", purgeAfter: file.purgeAfter };
}

/** DELETE /files/{id}: recoverable, caller-scoped soft deletion only. */
export function trashFile(deps: { repo: Repository; now?: () => Date }) {
  return async (event: any): Promise<HandlerResult> => {
    try {
      const userId = userIdFromEvent(event);
      const fileId = fileIdFromEvent(event);
      const existing = await deps.repo.findFile(userId, fileId);
      if (existing === undefined) throw notFound("file");
      if (existing.state !== "committed" && existing.state !== "trashed") {
        throw conflict("only committed files can be moved to Trash");
      }
      const deletedAt = (deps.now?.() ?? new Date()).toISOString();
      const purgeAfter = new Date(Date.parse(deletedAt) + RETENTION_MS).toISOString();
      const file = await deps.repo.trashFile(userId, fileId, deletedAt, purgeAfter);
      if (file === undefined) throw notFound("file");
      return { statusCode: 200, body: JSON.stringify(trashView(file)) };
    } catch (err) {
      if (err instanceof HttpError) return { statusCode: err.status, body: JSON.stringify({ code: err.code, message: err.message }) };
      return { statusCode: 500, body: JSON.stringify({ code: "internal_error", message: "Unexpected error" }) };
    }
  };
}
