import { HttpError, badRequest, notFound, userIdFromEvent } from "../../../shared/src/index.js";
import type { HandlerResult } from "./register-files.js";
import type { Repository } from "./repository.js";
export const DOWNLOAD_LEASE_TTL_SECONDS = 5 * 60;
export interface DownloadPresigner { signGet(objectKey: string, ttlSeconds: number): Promise<string>; }
function fileIdFromEvent(event: any): string { const id = event?.pathParameters?.id; if (typeof id !== "string" || id.length === 0) throw badRequest("file id is required in the path"); return id; }
/** Issues an in-memory-only short-lived read lease for a committed caller-owned file. */
export function createDownloadLease(deps: { repo: Repository; presigner: DownloadPresigner }) {
  return async (event: any): Promise<HandlerResult> => { try {
    const file = await deps.repo.findFile(userIdFromEvent(event), fileIdFromEvent(event));
    if (file === undefined || file.state !== "committed") throw notFound("file");
    const url = await deps.presigner.signGet(file.objectKey, DOWNLOAD_LEASE_TTL_SECONDS);
    return { statusCode: 200, body: JSON.stringify({ url, expiresInSeconds: DOWNLOAD_LEASE_TTL_SECONDS }) };
  } catch (err) { if (err instanceof HttpError) return { statusCode: err.status, body: JSON.stringify({ code: err.code, message: err.message }) }; return { statusCode: 500, body: JSON.stringify({ code: "internal_error", message: "Unexpected error" }) }; } };
}
