import type { AuthOutcome, ChildItem, MountStatus, NativeDropNotice, RestoreOutcome, SourceSummary, TransferStatus, Usage } from "../domain/types";

export type WindowAction = "minimize" | "toggle-maximize" | "close";

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
    getUsage(): Promise<Usage>;
    mountStatus(): Promise<MountStatus>;
    mountStash(): Promise<MountStatus>;
    unmountStash(): Promise<MountStatus>;
  };
  stash: {
    selectSource(kind: "file" | "folder"): Promise<SourceSummary>;
    confirm(): Promise<TransferStatus>;
    status(): Promise<TransferStatus>;
    cancel(): Promise<TransferStatus>;
    onNativeDrop(listener: (notice: NativeDropNotice) => void): Promise<() => void>;
  };
  unavailable(capability: "home" | "search" | "stash-it" | "recent-stashes" | "offline" | "transfers" | "settings"): string;
};
