/** A due retention candidate read from the sparse gsi5 queue. */
export interface DueFile {
  readonly entity: "FILE";
  readonly pk: string;
  readonly sk: string;
  readonly fileId: string;
  readonly objectKey: string;
  readonly sizeBytes: number;
  readonly state: "trashed" | "purging";
}

/** A trashed folder root. Descendants remain in gsi1 until this root is due. */
export interface DueFolder {
  readonly entity: "FOLDER";
  readonly pk: string;
  readonly sk: string;
  readonly folderId: string;
  readonly parentFolderId: string | null;
  readonly name: string;
  readonly state: "trashed" | "purging";
}

export type DueItem = DueFile | DueFolder;

/** A live descendant of a claimed folder root, read through gsi1. */
export type FolderDescendant = DueFile | DueFolder;
