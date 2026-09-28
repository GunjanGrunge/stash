import { randomUUID } from "node:crypto";
import { HttpError, badRequest, userIdFromEvent, validateRelativePath } from "../../../shared/src/index.js";
import type { HandlerResult } from "./register-files.js";
import type { Repository } from "./repository.js";
import type { FolderRecord } from "./types.js";

function bodyFromEvent(event: any): Record<string, unknown> {
  if (typeof event?.body !== "string") throw badRequest("request body is required");
  try {
    const body = JSON.parse(event.body);
    if (body === null || typeof body !== "object" || Array.isArray(body)) {
      throw badRequest("request body must be a JSON object");
    }
    return body as Record<string, unknown>;
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw badRequest("request body must be valid JSON");
  }
}

function folderName(value: unknown): string {
  if (typeof value !== "string") throw badRequest("folder name is required");
  const name = validateRelativePath(value);
  if (name.includes("/")) throw badRequest("folder name must be one path segment");
  return name;
}

function parseParentFolderId(value: unknown): string | null {
  if (value === undefined || value === null || value === "" || value === "ROOT") return null;
  if (typeof value !== "string" || value.length > 128) throw badRequest("parent folder is invalid");
  return value;
}

/** POST /folders — creates one empty, persistent filesystem folder. */
export function createFolder(deps: { repo: Repository }) {
  return async (event: any): Promise<HandlerResult> => {
    try {
      const userId = userIdFromEvent(event);
      const body = bodyFromEvent(event);
      const name = folderName(body["name"]);
      const parentFolderId = parseParentFolderId(body["parentFolderId"]);
      const parent = parentFolderId === null ? undefined : await deps.repo.findFolderById(userId, parentFolderId);
      if (parentFolderId !== null && (parent === undefined || parent.state === "trashed" || parent.state === "purging")) {
        return { statusCode: 404, body: JSON.stringify({ code: "not_found", message: "Folder not found" }) };
      }
      const folderId = randomUUID();
      const pk = `USER#${userId}`;
      const folder: FolderRecord = {
        pk,
        sk: `FOLDER#${folderId}`,
        entity: "FOLDER",
        folderId,
        name,
        parentFolderId,
        relativePath: name,
        gsi1pk: `${pk}#PARENT#${parentFolderId ?? "ROOT"}`,
        gsi1sk: name,
      };
      await deps.repo.putEntities([folder]);
      return { statusCode: 201, body: JSON.stringify({ entity: "FOLDER", folderId, name, parentFolderId: parentFolderId ?? "ROOT" }) };
    } catch (error) {
      if (error instanceof HttpError) {
        return { statusCode: error.status, body: JSON.stringify({ code: error.code, message: error.message }) };
      }
      return { statusCode: 500, body: JSON.stringify({ code: "internal_error", message: "Unexpected error" }) };
    }
  };
}
