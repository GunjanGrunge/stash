import type { UsageRecord } from "./types.js";

/**
 * Shared by both repository implementations: a PROFILE item is only usable
 * when BOTH counters are real numbers. Anything else is reported as absent
 * rather than coerced — a fabricated quota would misreport the creator's
 * storage indicator, and a coerced `usedBytes` could understate what they
 * have already Stashed.
 */
export function readUsage(
  item: Record<string, unknown> | undefined,
): UsageRecord | undefined {
  if (item === undefined || item === null) return undefined;
  const usedBytes = item["usedBytes"];
  const quotaBytes = item["quotaBytes"];
  if (typeof usedBytes !== "number" || !Number.isFinite(usedBytes)) {
    return undefined;
  }
  if (typeof quotaBytes !== "number" || !Number.isFinite(quotaBytes)) {
    return undefined;
  }
  return { usedBytes, quotaBytes };
}
