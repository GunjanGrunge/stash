import { randomUUID } from "node:crypto";
import {
  HttpError,
  badRequest,
  idempotencyKeyFromEvent,
  logger,
  objectKey,
  userIdFromEvent,
  validateRelativePath,
} from "../../../shared/src/index.js";
import type { Repository } from "./repository.js";
import type { EntityRecord, FileRecord, FolderRecord, RegisterFileInput } from "./types.js";

export interface HandlerResult {
  statusCode: number;
  body: string;
}

function parseBody(event: any): Record<string, unknown> {
  const raw = event?.body;
  if (raw === undefined || raw === null) throw badRequest("request body is required");
  if (typeof raw === "object") return raw as Record<string, unknown>;
  if (typeof raw !== "string") throw badRequest("request body is required");
  try {
    const parsed = JSON.parse(raw);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw badRequest("request body must be a JSON object");
    }
    return parsed as Record<string, unknown>;
  } catch (err) {
    if (err instanceof HttpError) throw err;
    throw badRequest("request body must be valid JSON");
  }
}

function errorResult(err: unknown): HandlerResult {
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

/**
 * POST /files — register a batch of files and the folder chain they imply.
 *
 * Rule 7: user_id comes from the verified JWT claim only; any user_id in the
 * body is ignored. Rule 1: every relativePath is stored verbatim. Validation
 * of the WHOLE batch happens before anything is written, so a single bad path
 * rejects the batch with 400 and writes nothing — partial acceptance is
 * forbidden.
 *
 * Folder identity is stable per (userId, parentFolderId, name): an existing
 * folder is RESOLVED before a new one is minted, so a second call into the
 * same folder extends the creator's library instead of forking it (Rule 1).
 * Identity comes from lookup, never from hashing the path — a rename must
 * stay a metadata write, not a re-parenting of every descendant.
 *
 * A replay of the same (userId, stashId, Idempotency-Key) returns the ORIGINAL
 * response without writing again (PRD §13: retries are guaranteed).
 */
export function registerFiles(deps: { repo: Repository }) {
  return async (event: any): Promise<HandlerResult> => {
    try {
      const userId = userIdFromEvent(event);
      const idempotencyKey = idempotencyKeyFromEvent(event);
      const log = logger(idempotencyKey ?? randomUUID());
      const body = parseBody(event);

      const stashId = body["stashId"];
      if (typeof stashId !== "string" || stashId.length === 0) {
        throw badRequest("stashId must be a non-empty string");
      }

      if (idempotencyKey !== undefined) {
        const replay = await deps.repo.getIdempotentResult(
          userId,
          stashId,
          idempotencyKey,
        );
        if (replay !== undefined) {
          log.info("files_register_replayed", { stash_id: stashId });
          return { statusCode: replay.statusCode, body: replay.body };
        }
      }

      const rawFiles = body["files"];
      if (!Array.isArray(rawFiles) || rawFiles.length === 0) {
        throw badRequest("files must be a non-empty array");
      }

      // Phase 1 — validate everything. Nothing is written until this passes.
      // Two identical relativePath values inside ONE batch reject the whole
      // batch: a real filesystem cannot hold two `x.wav` in one folder, so
      // accepting both would materialize a structure that is not the
      // creator's (Rule 1). Comparison is on raw UTF-8 bytes — no
      // normalization, so NFC and NFD remain DIFFERENT paths. This uses no
      // content information, so Rule 3 is untouched.
      const seenPaths = new Set<string>();
      const inputs: RegisterFileInput[] = rawFiles.map((entry: unknown) => {
        if (entry === null || typeof entry !== "object") {
          throw badRequest("each file entry must be an object");
        }
        const e = entry as Record<string, unknown>;
        const relativePath = validateRelativePath(e["relativePath"] as string);
        const pathBytes = Buffer.from(relativePath, "utf8").toString("hex");
        if (seenPaths.has(pathBytes)) {
          throw badRequest(
            "files contains the same relativePath twice; a folder cannot hold two entries with the same name",
          );
        }
        seenPaths.add(pathBytes);
        const sizeBytes = e["sizeBytes"];
        if (typeof sizeBytes !== "number" || !Number.isFinite(sizeBytes) || sizeBytes < 0) {
          throw badRequest("sizeBytes must be a non-negative number");
        }
        const checksum = e["checksum"];
        if (typeof checksum !== "string" || checksum.length === 0) {
          throw badRequest("checksum must be a non-empty string");
        }
        return { relativePath, sizeBytes, checksum };
      });

      // Phase 2 — resolve existing folders, build the missing ones in memory.
      const pk = `USER#${userId}`;
      const resolved = new Map<string, string>(); // relative prefix -> folderId
      const newFolders: FolderRecord[] = [];
      const files: FileRecord[] = [];

      for (const input of inputs) {
        const segments = input.relativePath.split("/");
        const name = segments[segments.length - 1]!;
        const dirs = segments.slice(0, -1);

        let parentFolderId: string | null = null;
        let prefix = "";
        for (const dir of dirs) {
          prefix = prefix === "" ? dir : `${prefix}/${dir}`;
          const cached = resolved.get(prefix);
          if (cached !== undefined) {
            parentFolderId = cached;
            continue;
          }
          const existing = await deps.repo.findFolder(userId, parentFolderId, dir);
          if (existing !== undefined) {
            resolved.set(prefix, existing.folderId);
            parentFolderId = existing.folderId;
            continue;
          }
          const folderId = randomUUID();
          newFolders.push({
            pk,
            sk: `FOLDER#${folderId}`,
            entity: "FOLDER",
            folderId,
            name: dir,
            parentFolderId,
            relativePath: prefix,
            gsi1pk: `${pk}#PARENT#${parentFolderId ?? "ROOT"}`,
            gsi1sk: dir,
          });
          resolved.set(prefix, folderId);
          parentFolderId = folderId;
        }

        const fileId = randomUUID();
        files.push({
          pk,
          sk: `FILE#${fileId}`,
          entity: "FILE",
          fileId,
          stashId,
          name,
          parentFolderId: parentFolderId ?? "ROOT",
          originalRelativePath: input.relativePath,
          sizeBytes: input.sizeBytes,
          checksum: input.checksum,
          objectKey: objectKey(userId, fileId),
          state: "pending",
          searchTokens: [],
          extractedMetadata: {},
          gsi1pk: `${pk}#PARENT#${parentFolderId ?? "ROOT"}`,
          gsi1sk: name,
          gsi2pk: `${pk}#STASH#${stashId}`,
          gsi2sk: `FILE#${fileId}`,
          gsi3pk: `${pk}#SUM#${input.checksum}`,
          // Both gsi3 key attributes must be present or DynamoDB never
          // projects the item into the checksum index at all.
          gsi3sk: `FILE#${fileId}`,
        });
      }

      const items: EntityRecord[] = [...newFolders, ...files];
      await deps.repo.putEntities(items);
      log.info("files_registered", {
        file_count: files.length,
        folder_count: newFolders.length,
      });

      const result: HandlerResult = {
        statusCode: 201,
        body: JSON.stringify({ stashId, fileIds: files.map((f) => f.fileId) }),
      };
      if (idempotencyKey !== undefined) {
        await deps.repo.putIdempotentResult(userId, stashId, idempotencyKey, result);
      }
      return result;
    } catch (err) {
      return errorResult(err);
    }
  };
}
