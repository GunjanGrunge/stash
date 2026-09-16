import { randomUUID } from "node:crypto";
import type { APIGatewayProxyEventV2WithJWTAuthorizer } from "aws-lambda";
import {
  HttpError,
  badRequest,
  conflict,
  idempotencyKeyFromEvent,
  logger,
  notFound,
  userIdFromEvent,
  validateRelativePath,
} from "../../../shared/src/index.js";
import { manifestHash } from "./manifest-hash.js";
import type { ManifestRepository } from "./repository.js";
import type { ManifestCheckResult, ManifestEntry, ManifestRecord } from "./types.js";

export interface HandlerResult {
  statusCode: number;
  body: string;
}

interface StashLookup {
  getStash(userId: string, stashId: string): Promise<{ state: string } | undefined>;
}

function stashIdFromPath(event: any): string {
  const id = event?.pathParameters?.id;
  if (typeof id !== "string" || id.length === 0) throw badRequest("stash id is required in the path");
  return id;
}

function parseBody(event: APIGatewayProxyEventV2WithJWTAuthorizer): Record<string, unknown> {
  const raw: unknown = event?.body;
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
 * Raw-UTF-8 identity for one (relativePath, sizeBytes, checksum) triple —
 * never normalized. `sizeBytes` is part of the key because `manifestHash` is
 * size-sensitive: without it the two notions of "the same file" inside this
 * one handler would disagree. A stored 2-byte file and a candidate 4 GB file
 * at the same path with the same checksum is a contradiction, and calling it
 * "already Stashed" would mean 4 GB never uploads. Every field is hex-framed
 * so none can forge the separator.
 */
function pairKey(entry: ManifestEntry): string {
  return [
    Buffer.from(entry.relativePath, "utf8").toString("hex"),
    Buffer.from(String(entry.sizeBytes), "utf8").toString("hex"),
    Buffer.from(entry.checksum, "utf8").toString("hex"),
  ].join("#");
}

const MAX_FOLDER_NAME_BYTES = 255;

/**
 * Validates `folderName` and returns it BYTE-IDENTICAL (Rule 1): never
 * normalized, trimmed or case-folded, so NFC and NFD stay DIFFERENT names.
 * It participates in matching AND in the manifest digest, so it gets the same
 * discipline a relativePath segment gets: non-empty, no control characters
 * (NUL included), and at most 255 bytes.
 */
function validateFolderName(raw: unknown): string {
  if (typeof raw !== "string" || raw.length === 0) {
    throw badRequest("folderName must be a non-empty string");
  }
  for (const ch of raw) {
    const cp = ch.codePointAt(0)!;
    if (cp <= 0x1f || cp === 0x7f) {
      throw badRequest("folderName contains a control character");
    }
  }
  if (Buffer.byteLength(raw, "utf8") > MAX_FOLDER_NAME_BYTES) {
    throw badRequest(`folderName exceeds ${MAX_FOLDER_NAME_BYTES} bytes`);
  }
  return raw;
}

/**
 * Validates the WHOLE manifest before anything is compared. One bad entry
 * rejects the whole request: a partially-validated manifest would produce a
 * hash for a folder the creator does not actually have.
 */
function validateEntries(raw: unknown): ManifestEntry[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw badRequest("entries must be a non-empty array");
  }
  const seenPaths = new Set<string>();
  return raw.map((entry: unknown) => {
    if (entry === null || typeof entry !== "object") {
      throw badRequest("each manifest entry must be an object");
    }
    const e = entry as Record<string, unknown>;
    const relativePath = validateRelativePath(e["relativePath"] as string);
    // A real filesystem cannot hold two files at one path, so a manifest
    // claiming it describes no folder that exists — reject the whole request.
    // Compared on raw UTF-8 bytes: NFC and NFD are DIFFERENT paths (Rule 1).
    const pathBytes = Buffer.from(relativePath, "utf8").toString("hex");
    if (seenPaths.has(pathBytes)) {
      throw badRequest(
        "entries contains the same relativePath twice; a folder cannot hold two entries with the same name",
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
}

/**
 * Diffs a candidate manifest against ONE stored manifest for the same folder
 * name. An entry counts as already Stashed only when the stored manifest holds
 * the SAME relativePath with the SAME checksum. A file at the same path with a
 * DIFFERENT checksum is therefore a NEW file — its content changed, and
 * claiming it is already Stashed would silently lose the creator's edit.
 */
function diff(
  entries: ManifestEntry[],
  stored: ManifestRecord,
): { existingCount: number; newFiles: ManifestEntry[]; newBytes: number } {
  const known = new Set(stored.entries.map(pairKey));
  const newFiles = entries.filter((entry) => !known.has(pairKey(entry)));
  return {
    existingCount: entries.length - newFiles.length,
    newFiles,
    newBytes: newFiles.reduce((sum, entry) => sum + entry.sizeBytes, 0),
  };
}

/**
 * POST /manifest/check — answers "do I already have this folder?" BEFORE a
 * single payload byte moves.
 *
 * Rule 7: userId comes from the verified JWT claim only, so one creator's
 * manifest is never reported to another. Rule 9: this handler makes NO S3
 * call — it never touches payload bytes. It also performs NO write of any
 * kind: `putManifest` is never invoked here, and nothing is deleted,
 * repointed, merged or deduped (Rule 3). It only reports.
 *
 * The failure mode that matters is a FALSE POSITIVE: telling a creator they
 * already have a folder they do not can make them cancel a Stash and lose
 * files that were never uploaded. So certainty is always under-reported:
 * `exact` requires the full manifest hash — folder NAME included — to match,
 * `partial` requires exactly ONE same-name candidate with at least one
 * (path, sizeBytes, checksum) triple genuinely in common, and anything less —
 * including a folder name that merely coincides, or several same-name folders
 * that each share files — is `none`.
 */
export function checkManifest(deps: { repo: ManifestRepository; stashes?: StashLookup }) {
  return async (
    event: APIGatewayProxyEventV2WithJWTAuthorizer,
  ): Promise<HandlerResult> => {
    try {
      const userId = userIdFromEvent(event);
      const log = logger(idempotencyKeyFromEvent(event) ?? randomUUID());
      if (deps.stashes !== undefined) {
        // The Lambda composition supplies this lookup, making the route
        // parameter authoritative in production. Direct handler tests do not
        // model an HTTP route, so they deliberately omit it.
        const stashId = stashIdFromPath(event);
        const stash = await deps.stashes.getStash(userId, stashId);
        if (stash === undefined) throw notFound("stash");
        if (stash.state !== "open") throw conflict("stash is not open");
      }
      const body = parseBody(event);

      const folderName = validateFolderName(body["folderName"]);
      const entries = validateEntries(body["entries"]);

      // The digest covers the folder NAME as well as the contents, so an
      // exact match is an identity match and not merely a content
      // fingerprint (Rule 3).
      const hash = manifestHash(folderName, entries);

      const exact = await deps.repo.findByHash(userId, hash);
      if (exact !== undefined) {
        const result: ManifestCheckResult = {
          match: "exact",
          folderId: exact.folderId,
          folderName: exact.folderName,
          fileCount: exact.fileCount,
          totalBytes: exact.totalBytes,
        };
        log.info("manifest_check_exact", { file_count: exact.fileCount });
        return { statusCode: 200, body: JSON.stringify(result) };
      }

      // No exact match. A folder of the same name MAY be an earlier version of
      // this one — compare contents to find out. Folder names are compared as
      // raw UTF-8 bytes (Rule 1), so an NFD name never matches an NFC one.
      const candidates = await deps.repo.findByFolderName(userId, folderName);
      let best:
        | { record: ManifestRecord; existingCount: number; newFiles: ManifestEntry[]; newBytes: number }
        | undefined;
      let overlapping = 0;
      for (const candidate of candidates) {
        const d = diff(entries, candidate);
        // Zero shared files means the name is the only thing in common — that
        // is a coincidence, not a duplicate, and reporting it would be a false
        // positive.
        if (d.existingCount === 0) continue;
        overlapping += 1;
        // Deterministic across calls: most overlap wins, ties broken by hash.
        if (
          best === undefined ||
          d.existingCount > best.existingCount ||
          (d.existingCount === best.existingCount &&
            candidate.manifestHash < best.record.manifestHash)
        ) {
          best = { record: candidate, ...d };
        }
      }

      // AMBIGUITY: two or more stored folders share this name AND share files
      // with the candidate. Naming one of them would put another folder's
      // folderId in front of the creator and withhold the shared files from
      // `newFiles`; a client acting on that merges distinct folders into one
      // (Rule 1). There is no way to tell from a manifest alone which folder
      // the creator means, and maximising overlap actively maximises how much
      // is suppressed, so we refuse to guess and report `none`: the creator
      // re-uploads and keeps three separate folders.
      //
      // CONSERVATIVE DEFAULT, pending user ratification. Two alternatives were
      // considered and deliberately NOT chosen: returning `partial` against the
      // best-overlap candidate (guesses an identity — the very false positive
      // this endpoint exists to avoid), and adding an `ambiguous` result that
      // lists the candidates (a new contract no client has agreed to, and it
      // still needs a rule for what the client may do with it). Under-reporting
      // wastes bandwidth; mis-identifying loses data.
      if (overlapping > 1) {
        log.info("manifest_check_ambiguous", { candidate_count: overlapping });
        const ambiguous: ManifestCheckResult = { match: "none" };
        return { statusCode: 200, body: JSON.stringify(ambiguous) };
      }

      if (best !== undefined) {
        const result: ManifestCheckResult = {
          match: "partial",
          folderId: best.record.folderId,
          folderName: best.record.folderName,
          existingCount: best.existingCount,
          newFiles: best.newFiles,
          newBytes: best.newBytes,
        };
        log.info("manifest_check_partial", {
          existing_count: best.existingCount,
          new_count: best.newFiles.length,
        });
        return { statusCode: 200, body: JSON.stringify(result) };
      }

      log.info("manifest_check_none", { file_count: entries.length });
      const none: ManifestCheckResult = { match: "none" };
      return { statusCode: 200, body: JSON.stringify(none) };
    } catch (err) {
      return errorResult(err);
    }
  };
}
