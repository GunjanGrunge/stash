import { HttpError, userIdFromEvent } from "../../../shared/src/index.js";
import type { HandlerResult } from "./register-files.js";
import type { Repository } from "./repository.js";
import { trashView } from "./trash-file.js";

/** GET /trash: caller-scoped recoverable files, ordered by purge deadline. */
export function listTrash(deps: { repo: Repository }) {
  return async (event: any): Promise<HandlerResult> => {
    try {
      const files = await deps.repo.listTrash(userIdFromEvent(event));
      files.sort((a, b) => (a.purgeAfter ?? "").localeCompare(b.purgeAfter ?? ""));
      return { statusCode: 200, body: JSON.stringify({ items: files.map(trashView) }) };
    } catch (err) {
      if (err instanceof HttpError) return { statusCode: err.status, body: JSON.stringify({ code: err.code, message: err.message }) };
      return { statusCode: 500, body: JSON.stringify({ code: "internal_error", message: "Unexpected error" }) };
    }
  };
}
