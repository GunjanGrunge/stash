import type { RetentionRepository } from "./repository.js";

export interface ObjectDeleter {
  deleteObject(objectKey: string): Promise<void>;
}

function isNoSuchKey(error: unknown): boolean {
  return (error as { name?: string } | undefined)?.name === "NoSuchKey";
}

/**
 * Runs one scheduled retention sweep. A claimed `purging` record is deliberately
 * resumable: DeleteObject/NoSuchKey are idempotent, while restore refuses that
 * state, so an invocation interrupted between S3 and Dynamo can safely retry.
 */
export async function purgeTrash(deps: {
  repo: RetentionRepository;
  objects: ObjectDeleter;
  now?: () => Date;
}): Promise<{ scanned: number; purged: number; skipped: number }> {
  const due = await deps.repo.listDue((deps.now?.() ?? new Date()).toISOString());
  let purged = 0;
  let skipped = 0;
  for (const file of due) {
    if (!(await deps.repo.claim(file))) {
      skipped += 1;
      continue;
    }
    try {
      await deps.objects.deleteObject(file.objectKey);
    } catch (error) {
      if (!isNoSuchKey(error)) throw error;
    }
    try {
      await deps.repo.finalize(file);
      purged += 1;
    } catch (error) {
      // A concurrent worker may have finalized the same resumable `purging`
      // item after S3 deletion. Treat only that lost conditional race as done.
      if ((error as { name?: string } | undefined)?.name !== "TransactionCanceledException") throw error;
      skipped += 1;
    }
  }
  return { scanned: due.length, purged, skipped };
}
