import { HttpError, badRequest, notFound, userIdFromEvent } from "../../../shared/src/index.js";
import type { HandlerResult } from "./register-files.js";
import type { Repository } from "./repository.js";

function fileIdFromEvent(event: any): string {
  const id = event?.pathParameters?.id;
  if (typeof id !== "string" || id.length === 0) {
    throw badRequest("file id is required in the path");
  }
  return id;
}

/** Storage-neutral view: deliberately excludes opaque S3 objectKey. */
export function getFile(deps: { repo: Repository }) {
  return async (event: any): Promise<HandlerResult> => {
    try {
      const file = await deps.repo.findFile(userIdFromEvent(event), fileIdFromEvent(event));
      if (file === undefined || file.state === "trashed" || file.state === "purging") throw notFound("file");
      return {
        statusCode: 200,
        body: JSON.stringify({
          id: file.fileId,
          stashId: file.stashId,
          name: file.name,
          parentFolderId: file.parentFolderId,
          rootFolderId: file.rootFolderId,
          originalRelativePath: file.originalRelativePath,
          sizeBytes: file.sizeBytes,
          checksum: file.checksum,
          state: file.state,
          searchTokens: file.searchTokens,
          extractedMetadata: file.extractedMetadata,
        }),
      };
    } catch (err) {
      if (err instanceof HttpError) {
        return { statusCode: err.status, body: JSON.stringify({ code: err.code, message: err.message }) };
      }
      return { statusCode: 500, body: JSON.stringify({ code: "internal_error", message: "Unexpected error" }) };
    }
  };
}
