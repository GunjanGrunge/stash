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
  /** How the query was read, e.g. "Name: kick", "Key: G#", "Tempo: 120–130 BPM". */
  understood: string[];
  indexedFiles: number;
  truncated: boolean;
};

/** One ingestion event in Recent Stashes. */
export type StashSummary = {
  stashId: string;
  state: "open" | "completed" | "cancelled";
  fileCount: number;
  committedCount: number;
  committedBytes: number;
  startedAt: string;
  updatedAt: string;
  /** Folder name, when the backend reports it. */
  name: string | null;
};

/** What the Asset details card shows about one file; all read from STASH or the name. */
export type FileDetails = {
  name: string;
  path?: string | null;
  sizeBytes?: number | null;
  checksum?: string | null;
  kind: SearchKind;
  extension?: string | null;
  bpm?: number | null;
  key?: string | null;
  resolution?: number | null;
  fps?: number | null;
};

/** How a file can be previewed in the app, by type. */
export type PreviewKind = "image" | "audio" | "video" | "pdf" | "text";

/** Workstation preferences the native side saves. */
export type Preferences = {
  /** Start STASH in the tray when signing in to Windows. */
  launchAtLogin: boolean;
  /** When STASH starts, mount S: again if it was mounted last time. */
  mountAtLaunch: boolean;
  /** Whether S: was mounted when STASH last ran (recorded, not edited). */
  wasMounted: boolean;
};

/** This workstation, as the native side reports it. */
export type DeviceInfo = { name: string; os: string; appVersion: string };

export type KindTotal = { kind: SearchKind; bytes: number; files: number };
/** Cloud usage by media kind, from the on-device index. */
export type StorageBreakdown = { kinds: KindTotal[]; indexedFiles: number; truncated: boolean };
