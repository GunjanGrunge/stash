import type { ChildItem, FolderLocation, SortDirection, SortKey } from "../domain/types";

export const FOUNDATION_SEEDS = [0x1a2b3c4d, 0x5eed1234, 0x7f4a7c15, 0x13579bdf] as const;

export type GeneratedNode = {
  item: ChildItem;
  parentId: string;
};

export type GeneratedFolder = {
  id: string;
  name: string;
  parentId: string | null;
  children: GeneratedNode[];
};

export type GeneratedTree = {
  folders: GeneratedFolder[];
  root: GeneratedFolder;
};

export class SeededGenerator {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  next(): number {
    let value = this.state;
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    this.state = value >>> 0;
    return this.state;
  }

  integer(maxExclusive: number): number {
    if (!Number.isInteger(maxExclusive) || maxExclusive <= 0) throw new Error("Generator bound must be positive.");
    return this.next() % maxExclusive;
  }
}

export function generateFolderTree(seed: number, depth = 3, breadth = 3): GeneratedTree {
  const random = new SeededGenerator(seed);
  let folderNumber = 0;
  let fileNumber = 0;
  const folders: GeneratedFolder[] = [];

  const makeFolder = (level: number, parentId: string | null, name: string): GeneratedFolder => {
    const id = parentId === null ? "ROOT" : `folder-${seed.toString(16)}-${folderNumber++}`;
    const folder: GeneratedFolder = { id, name, parentId, children: [] };
    folders.push(folder);
    const folderCount = level < depth ? 1 + random.integer(Math.max(1, breadth)) : 0;
    const fileCount = 1 + random.integer(Math.max(1, breadth));
    for (let index = 0; index < folderCount; index += 1) {
      const child = makeFolder(level + 1, id, `Folder ${level + 1}-${index % 2}`);
      folder.children.push({ parentId: id, item: { entity: "FOLDER", folderId: child.id, name: child.name } });
    }
    for (let index = 0; index < fileCount; index += 1) {
      const fileId = `file-${seed.toString(16)}-${fileNumber++}`;
      folder.children.push({
        parentId: id,
        item: {
          entity: "FILE",
          fileId,
          name: `Take ${index % 2}.wav`,
          sizeBytes: random.integer(100000),
          originalRelativePath: `${name}/Take ${index % 2}.wav`,
        },
      });
    }
    return folder;
  };

  return { folders, root: makeFolder(0, null, "STASH") };
}

export function sortForPresentation(items: ChildItem[], key: SortKey, direction: SortDirection): ChildItem[] {
  return [...items].sort((left, right) => {
    const leftValue = key === "size" ? left.sizeBytes ?? 0 : key === "kind" ? (left.entity === "FOLDER" ? "Folder" : "File") : left.name;
    const rightValue = key === "size" ? right.sizeBytes ?? 0 : key === "kind" ? (right.entity === "FOLDER" ? "Folder" : "File") : right.name;
    const result = leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0;
    return direction === "ascending" ? result : -result;
  });
}

export function appendFolderLocation(path: FolderLocation[], item: ChildItem): FolderLocation[] {
  return item.entity === "FOLDER" && item.folderId ? [...path, { id: item.folderId, name: item.name }] : path;
}

export function navigateToKnownAncestor(path: FolderLocation[], index: number): FolderLocation[] {
  return index < 0 ? [] : path.slice(0, index + 1);
}

export function allGeneratedNodes(tree: GeneratedTree): GeneratedNode[] {
  return tree.folders.flatMap((folder) => folder.children);
}
