import type { AuthOutcome, ChildItem, DeviceInfo, FileDetails, MountStatus, NativeDropNotice, Preferences, RestoreOutcome, SearchResponse, SourceSummary, StashSummary, StorageBreakdown, TransferStatus, Usage } from "../domain/types";

export type WindowAction = "minimize" | "toggle-maximize" | "close";
/** Folders the Stash it picker can open in; the native side allow-lists these. */
export type StashStart = "desktop" | "downloads" | "documents";

export type DesktopGateway = {
  readonly kind: "tauri" | "unavailable";
  window: { act(action: WindowAction): Promise<void>; startDragging(): Promise<void> };
  auth: {
    signIn(username: string, password: string, remember: boolean): Promise<AuthOutcome>;
    completeNewPassword(username: string, newPassword: string, remember: boolean): Promise<AuthOutcome>;
    clearPendingChallenge(): void;
    restoreSession(): Promise<RestoreOutcome>;
    signOut(): Promise<void>;
  };
  library: {
    listChildren(folderId: string): Promise<{ items?: ChildItem[] }>;
    createFolder(name: string, parentFolderId: string): Promise<ChildItem>;
    trashFolder(folderId: string): Promise<void>;
    trashFile(fileId: string): Promise<void>;
    getUsage(): Promise<Usage>;
    mountStatus(): Promise<MountStatus>;
    mountStash(): Promise<MountStatus>;
    unmountStash(): Promise<MountStatus>;
    /** The drive changed without this window asking (reconnected at launch, unmounted from the tray). */
    onMountChanged(listener: (status: MountStatus) => void): Promise<() => void>;
    /** Something in the creator's STASH changed (on S:, an upload landed, or in the app). */
    onLibraryChanged(listener: () => void): Promise<() => void>;
    /** Kind, tempo, key, size and checksum for the Asset details card. */
    describeFile(fileId: string): Promise<FileDetails>;
    /** Where the window streams a preview from; null when the type has no preview. */
    previewUrl(fileId: string, name: string, sizeBytes: number): string | null;
    /** Opens a file on S: in its usual Windows app; `path` is its place under S:. */
    openOnDrive(path: string): Promise<void>;
    /** Searches this device's index of the user's STASH; `refresh` re-reads the file list first. */
    search(query: string, refresh?: boolean): Promise<SearchResponse>;
    /** Cloud usage by media kind across the user's committed files. */
    storageBreakdown(refresh?: boolean): Promise<StorageBreakdown>;
    /** Recent Stashes, most recent first. */
    listStashes(): Promise<StashSummary[]>;
  };
  device: {
    info(): Promise<DeviceInfo>;
    /** Starting with Windows and reconnecting S:, saved on this workstation. */
    preferences(): Promise<Preferences>;
    setPreferences(choice: { launchAtLogin: boolean; mountAtLaunch: boolean }): Promise<Preferences>;
  };
  stash: {
    /** Opens the native picker, optionally starting in a known folder. */
    selectSource(kind: "file" | "folder", start?: StashStart): Promise<SourceSummary>;
    confirm(): Promise<TransferStatus>;
    status(): Promise<TransferStatus>;
    cancel(): Promise<TransferStatus>;
    onNativeDrop(listener: (notice: NativeDropNotice) => void): Promise<() => void>;
  };
  unavailable(capability: "home" | "search" | "stash-it" | "recent-stashes" | "offline" | "transfers" | "settings"): string;
};
