import { badRequest } from "./errors.js";

const MAX_PATH_BYTES = 1024;
const MAX_SEGMENT_BYTES = 255;

/**
 * Rule 1: never reorganize a creator's library.
 *
 * This function VALIDATES and returns its input byte-identical. It must not
 * normalize, trim, lower-case, re-encode or otherwise rewrite the path — a
 * "helpful" normalization here would silently corrupt every creator's
 * library. Rejects anything that could escape the creator's namespace or
 * break downstream storage.
 */
export function validateRelativePath(p: string): string {
  if (typeof p !== "string" || p.length === 0) {
    throw badRequest("original_relative_path must be a non-empty string");
  }

  // Reject control characters, including the NUL byte.
  for (const ch of p) {
    const cp = ch.codePointAt(0)!;
    if (cp <= 0x1f || cp === 0x7f) {
      throw badRequest("original_relative_path contains a control character");
    }
  }

  if (Buffer.byteLength(p, "utf8") > MAX_PATH_BYTES || p.length > MAX_PATH_BYTES) {
    throw badRequest(
      `original_relative_path exceeds ${MAX_PATH_BYTES} characters`,
    );
  }

  // Absolute paths (POSIX or Windows) escape the creator's namespace.
  if (p.startsWith("/") || p.startsWith("\\") || /^[A-Za-z]:[\\/]/.test(p)) {
    throw badRequest("original_relative_path must be relative");
  }

  if (p.includes("\\")) {
    throw badRequest("original_relative_path must use / as the separator");
  }

  const segments = p.split("/");
  for (const segment of segments) {
    if (segment.length === 0) {
      throw badRequest("original_relative_path contains an empty segment");
    }
    if (segment === "." || segment === "..") {
      throw badRequest("original_relative_path contains a traversal segment");
    }
    if (
      segment.length > MAX_SEGMENT_BYTES ||
      Buffer.byteLength(segment, "utf8") > MAX_SEGMENT_BYTES
    ) {
      throw badRequest(
        `original_relative_path segment exceeds ${MAX_SEGMENT_BYTES} characters`,
      );
    }
  }

  // Byte-identical passthrough (Rule 1).
  return p;
}
