export type AuthView = "restoring" | "welcome" | "signIn" | "newPassword" | "signedIn";

export type AuthOutcome =
  | { outcome: "SignedIn"; username: string }
  | { outcome: "NewPasswordRequired"; username: string };

export type RestoreOutcome = { outcome: "SignedIn" } | { outcome: "SignedOut" };

export type EntityKind = "FILE" | "FOLDER";

export type ChildItem = {
  entity: EntityKind;
  folderId?: string;
  fileId?: string;
  name: string;
  sizeBytes?: number | null;
  state?: string | null;
  originalRelativePath?: string | null;
};

export type CapabilityStatus = "loading" | "ready" | "offline" | "stale" | "unavailable";
export type CapabilityState<T> =
  | { status: "loading" }
  | { status: "ready"; data: T }
  | { status: "stale"; data: T; message: string }
  | { status: "offline" | "unavailable"; message: string; data?: T };

export type Usage = {
  provisioned?: boolean;
  usedBytes?: number | null;
  quotaBytes?: number | null;
};

export type MountStatus = {
  mounted: boolean;
  letter?: string | null;
  label: string;
};

export type FolderLocation = { id: string; name: string };

export type SortKey = "name" | "kind" | "size";
export type SortDirection = "ascending" | "descending";

export type SourceEntry = { relativePath: string; sizeBytes: number };

export type SourceSummary = {
  sourceName: string;
  folderName: string;
  fileCount: number;
  totalBytes: number;
  entries: SourceEntry[];
};

export type NativeDropNotice = {
  phase: "over" | "leave" | "accepted" | "rejected";
  summary?: SourceSummary;
  message?: string;
};

export type TransferPhase = "Preparing" | "Stashing" | "Verifying" | "Stashed" | "NeedsAttention" | "Canceled";
export type TransferStatus = {
  phase: TransferPhase;
  sourceName?: string | null;
  fileCount: number;
  completedFileCount: number;
  totalBytes: number;
  completedBytes: number;
  manifestMatch?: "exact" | "partial" | "none" | null;
  message?: string | null;
};


export type SearchKind = "audio" | "midi" | "video" | "image" | "document" | "other";

export type SearchHit = {
  fileId: string;
  name: string;
  path: string;
  sizeBytes: number;
  kind: SearchKind;
  extension?: string | null;
  bpm?: number | null;
  key?: string | null;
  resolution?: number | null;
  fps?: number | null;
};

export type SearchResponse = {
  hits: SearchHit[];
  total: number;
  unsupported: string[];
  indexedFiles: number;
  truncated: boolean;
};
