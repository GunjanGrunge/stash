import type { RetentionRepository } from "./repository.js";
import type { DueFile, DueFolder, FolderDescendant } from "./types.js";

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
  for (const item of due) {
    if (!(await deps.repo.claim(item))) {
      skipped += 1;
      continue;
    }
    if (item.entity === "FOLDER") {
      if (await purgeFolder(deps, item)) purged += 1;
      continue;
    }
    const file = item;
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

/**
 * Permanently removes a folder tree leaves-first. A folder record is never
 * removed while it is needed to discover descendants, and each metadata batch
 * is transactional with the quota decrement. The root remains queued in its
 * `purging` state until the next retry or this loop completes the whole tree.
 */
async function purgeFolder(
  deps: { repo: RetentionRepository; objects: ObjectDeleter },
  root: DueFolder,
): Promise<boolean> {
  for (;;) {
    const tree = await readTree(deps.repo, root);
    if (tree.items.length === 0) {
      await deps.repo.finalizeFolderRoot(root);
      return true;
    }

    const files = tree.items.filter((item): item is DueFile => item.entity === "FILE");
    if (files.length > 0) {
      // ConditionCheck(root) + files + PROFILE update = at most 100 actions.
      const batch = files.slice(0, 98);
      for (const file of batch) await deleteObject(deps.objects, file.objectKey);
      await deps.repo.finalizeFolderBatch(root, batch, []);
      continue;
    }

    const leaves = tree.folders.filter((folder) => !tree.parentsWithChildren.has(folder.folderId));
    if (leaves.length === 0) throw new Error("folder retention tree contains no removable leaf");
    // ConditionCheck(root) + identity/record deletes = at most 100 actions.
    await deps.repo.finalizeFolderBatch(root, [], leaves.slice(0, 49));
  }
}

async function readTree(repo: RetentionRepository, root: DueFolder): Promise<{
  items: FolderDescendant[];
  folders: DueFolder[];
  parentsWithChildren: Set<string>;
}> {
  const items: FolderDescendant[] = [];
  const folders: DueFolder[] = [];
  const parentsWithChildren = new Set<string>();
  const queue = [root];
  while (queue.length > 0) {
    const parent = queue.shift()!;
    const children = await repo.listFolderChildren(parent);
    if (children.length > 0) parentsWithChildren.add(parent.folderId);
    for (const child of children) {
      items.push(child);
      if (child.entity === "FOLDER") {
        folders.push(child);
        queue.push(child);
      }
    }
  }
  return { items, folders, parentsWithChildren };
}

async function deleteObject(objects: ObjectDeleter, objectKey: string): Promise<void> {
  try {
    await objects.deleteObject(objectKey);
  } catch (error) {
    if (!isNoSuchKey(error)) throw error;
  }
}
