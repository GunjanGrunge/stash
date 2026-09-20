import { HttpError, userIdFromEvent } from "../../../shared/src/index.js";
import type { HandlerResult } from "./register-files.js";
import type { Repository } from "./repository.js";
import { trashView } from "./trash-file.js";
import { folderTrashView } from "./trash-folder.js";

/** GET /trash: caller-scoped recoverable files and folder roots, by deadline. */
export function listTrash(deps: { repo: Repository }) {
  return async (event: any): Promise<HandlerResult> => {
    try {
      const userId = userIdFromEvent(event);
      const [files, folders] = await Promise.all([deps.repo.listTrash(userId), deps.repo.listTrashedFolders(userId)]);
      const items = [...files.map(trashView), ...folders.map(folderTrashView)];
      items.sort((a, b) => String(a.purgeAfter ?? "").localeCompare(String(b.purgeAfter ?? "")));
      return { statusCode: 200, body: JSON.stringify({ items }) };
    } catch (err) {
      if (err instanceof HttpError) return { statusCode: err.status, body: JSON.stringify({ code: err.code, message: err.message }) };
      return { statusCode: 500, body: JSON.stringify({ code: "internal_error", message: "Unexpected error" }) };
    }
  };
}
