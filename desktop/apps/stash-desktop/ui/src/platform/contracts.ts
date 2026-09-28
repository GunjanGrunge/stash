import type { AuthOutcome, ChildItem, MountStatus, NativeDropNotice, RestoreOutcome, SearchResponse, SourceSummary, TransferStatus, Usage } from "../domain/types";

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
    getUsage(): Promise<Usage>;
    mountStatus(): Promise<MountStatus>;
    mountStash(): Promise<MountStatus>;
    unmountStash(): Promise<MountStatus>;
    /** Searches this device's index of the user's STASH; `refresh` re-reads the file list first. */
    search(query: string, refresh?: boolean): Promise<SearchResponse>;
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
