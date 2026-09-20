import type { AuthOutcome, ChildItem, MountStatus, NativeDropNotice, RestoreOutcome, SourceSummary, TransferStatus, Usage } from "../../domain/types";
import type { DesktopGateway, WindowAction } from "../contracts";

type Invoke = <T>(command: AllowedCommand, args?: Record<string, unknown>) => Promise<T>;
type TauriWindow = { minimize(): Promise<void>; toggleMaximize(): Promise<void>; close(): Promise<void>; startDragging(): Promise<void> };
type TauriGlobals = { core?: { invoke?: Invoke }; window?: { getCurrentWindow?: () => TauriWindow }; event?: { listen?: <T>(name: string, handler: (event: { payload: T }) => void) => Promise<() => void> } };
type AllowedCommand = "sign_in" | "complete_new_password" | "restore_session" | "sign_out" | "list_children" | "get_usage" | "mount_status" | "mount_stash" | "unmount_stash" | "select_stash_source" | "confirm_stash" | "get_transfer_status" | "cancel_stash";
type RecordValue = Record<string, unknown>;

const getTauri = (): TauriGlobals | undefined => (globalThis as typeof globalThis & { __TAURI__?: TauriGlobals }).__TAURI__;
const isRecord = (value: unknown): value is RecordValue => typeof value === "object" && value !== null;
const safeId = (value: unknown): string | undefined => typeof value === "string" && value.length > 0 && value.length <= 128 && /^[A-Za-z0-9_-]+$/.test(value) ? value : undefined;
const safeText = (value: unknown, maxLength: number): string | undefined => typeof value === "string" && value.length > 0 && value.length <= maxLength ? value : undefined;
const validFolderId = (value: string): string => { const normalized = value.trim(); if (!safeId(normalized)) throw new Error("STASH received an invalid folder identifier."); return normalized; };

function containsUnsafeErrorMaterial(message: string): boolean {
  const sensitiveField = /(?:password|passwd|new[-_]?password|current[-_]?password|session|private[-_]?session|object[-_]?key|access[-_]?token|refresh[-_]?token|id[-_]?token|credential|secret)\s*(?:[:=]|=>)\s*[^\s,;)}\]]+/i;
  const sensitiveTerm = /\b(?:password|passwd|new[-_]?password|current[-_]?password|session|private[-_]?session|object[-_]?key|access[-_]?token|refresh[-_]?token|id[-_]?token|credential|secret)\b/i;
  const authorization = /\bauthorization\s*(?:[:=]\s*)?\bbearer\s+\S+|\bbearer\s+\S+/i;
  const url = /\b(?:https?|s3|gs):\/\/[^\s"'<>]+/i;
  const presignedUrl = /\b(?:pre[-_ ]?signed|signed)[-_ ]?url\s*(?:[:=])\s*\S+/i;
  return sensitiveField.test(message) || sensitiveTerm.test(message) || authorization.test(message) || url.test(message) || presignedUrl.test(message);
}

export function safeActionError(error: unknown, fallback: string): string {
  const raw = typeof error === "object" && error !== null && "message" in error ? String((error as { message?: unknown }).message ?? "") : String(error ?? "");
  const message = raw.trim();
  if (/No account found|UserNotFoundException|NotAuthorizedException/i.test(message)) return "Incorrect username or password.";
  if (/InvalidPasswordException/i.test(message)) return "That password doesn't meet the account's password requirements.";
  if (!message || message.length > 240 || containsUnsafeErrorMaterial(message) || /token|secret|credential|provider.*exception|stack backtrace/i.test(message)) return fallback;
  return message;
}

type InternalAuthOutcome =
  | { outcome: "SignedIn"; username: string }
  | { outcome: "NewPasswordRequired"; username: string; privateSession: string };

function authOutcome(value: unknown): InternalAuthOutcome {
  if (!isRecord(value) || typeof value.username !== "string" || !value.username) throw new Error("STASH returned an invalid sign-in response.");
  if (value.outcome === "SignedIn") return { outcome: "SignedIn", username: value.username };
  if (value.outcome === "NewPasswordRequired" && typeof value.session === "string" && value.session.length > 0) return { outcome: "NewPasswordRequired", username: value.username, privateSession: value.session };
  throw new Error("STASH returned an invalid sign-in response.");
}

function publicAuthOutcome(value: InternalAuthOutcome): AuthOutcome {
  return value.outcome === "SignedIn"
    ? { outcome: "SignedIn", username: value.username }
    : { outcome: "NewPasswordRequired", username: value.username };
}
function restoreOutcome(value: unknown): RestoreOutcome { if (isRecord(value) && (value.outcome === "SignedIn" || value.outcome === "SignedOut")) return { outcome: value.outcome }; throw new Error("STASH returned an invalid session response."); }
function sanitizeChild(value: unknown): ChildItem | undefined {
  if (!isRecord(value) || (value.entity !== "FILE" && value.entity !== "FOLDER")) return undefined;
  const name = safeText(value.name, 1024);
  if (!name) return undefined;
  const item: ChildItem = { entity: value.entity, name };
  const sizeBytes = value.sizeBytes;
  if (sizeBytes === null || (typeof sizeBytes === "number" && Number.isSafeInteger(sizeBytes) && sizeBytes >= 0)) item.sizeBytes = sizeBytes as number | null;
  if (typeof value.state === "string" && value.state.length <= 64) item.state = value.state;
  if (typeof value.originalRelativePath === "string" && value.originalRelativePath.length <= 4096) item.originalRelativePath = value.originalRelativePath;
  if (value.entity === "FOLDER") {
    const folderId = safeId(value.folderId) ?? safeId(value.id);
    if (!folderId) return undefined;
    item.folderId = folderId;
  } else {
    const fileId = safeId(value.fileId) ?? safeId(value.id);
    if (!fileId) return undefined;
    item.fileId = fileId;
  }
  return item;
}
function childList(value: unknown): { items: ChildItem[] } { if (!isRecord(value) || !Array.isArray(value.items)) throw new Error("STASH returned an invalid file list."); return { items: value.items.map(sanitizeChild).filter((item): item is ChildItem => item !== undefined) }; }
function usage(value: unknown): Usage {
  if (!isRecord(value)) throw new Error("STASH returned an invalid storage response.");
  const result: Usage = {};
  if (typeof value.provisioned === "boolean") result.provisioned = value.provisioned;
  for (const key of ["usedBytes", "quotaBytes"] as const) if (value[key] === null || (typeof value[key] === "number" && Number.isFinite(value[key]) && value[key] >= 0)) result[key] = value[key] as number | null;
  return result;
}
function mountStatus(value: unknown): MountStatus {
  if (!isRecord(value) || typeof value.mounted !== "boolean" || typeof value.label !== "string") throw new Error("STASH returned an invalid mount response.");
  return { mounted: value.mounted, label: value.label, ...(typeof value.letter === "string" ? { letter: value.letter } : {}) };
}
function sourceSummary(value: unknown): SourceSummary {
  if (!isRecord(value) || !Array.isArray(value.entries)) throw new Error("STASH returned an invalid source summary.");
  const sourceName = safeText(value.sourceName, 1024);
  const folderName = safeText(value.folderName, 1024);
  const fileCount = value.fileCount;
  const totalBytes = value.totalBytes;
  if (!sourceName || !folderName || typeof fileCount !== "number" || !Number.isSafeInteger(fileCount) || typeof totalBytes !== "number" || !Number.isSafeInteger(totalBytes)) throw new Error("STASH returned an invalid source summary.");
  const entries = value.entries.flatMap((entry) => {
    if (!isRecord(entry)) return [];
    const relativePath = safeText(entry.relativePath, 4096);
    const sizeBytes = entry.sizeBytes;
    return relativePath && typeof sizeBytes === "number" && Number.isSafeInteger(sizeBytes) && sizeBytes >= 0 ? [{ relativePath, sizeBytes }] : [];
  });
  return { sourceName, folderName, fileCount, totalBytes, entries };
}
function nativeDropNotice(value: unknown): NativeDropNotice {
  if (!isRecord(value) || !["over", "leave", "accepted", "rejected"].includes(String(value.phase))) return { phase: "rejected", message: "STASH received an invalid drop notice." };
  const phase = value.phase as NativeDropNotice["phase"];
  const summary = value.summary === undefined || value.summary === null ? undefined : sourceSummary(value.summary);
  return { phase, ...(summary ? { summary } : {}), ...(typeof value.message === "string" && value.message.length <= 240 ? { message: value.message } : {}) };
}
function transferStatus(value: unknown): TransferStatus {
  if (!isRecord(value) || !["Preparing", "Stashing", "Verifying", "Stashed", "NeedsAttention", "Canceled"].includes(String(value.phase)) || typeof value.fileCount !== "number" || typeof value.completedFileCount !== "number" || typeof value.totalBytes !== "number" || typeof value.completedBytes !== "number") throw new Error("STASH returned an invalid transfer status.");
  const manifestMatch = value.manifestMatch === "exact" || value.manifestMatch === "partial" || value.manifestMatch === "none" ? value.manifestMatch : null;
  return { phase: value.phase as TransferStatus["phase"], sourceName: typeof value.sourceName === "string" ? value.sourceName : null, fileCount: value.fileCount, completedFileCount: value.completedFileCount, totalBytes: value.totalBytes, completedBytes: value.completedBytes, manifestMatch, message: typeof value.message === "string" ? value.message : null };
}


export function createTauriGateway(): DesktopGateway {
  const tauri = getTauri();
  const invoke = tauri?.core?.invoke;
  const appWindow = tauri?.window?.getCurrentWindow?.();
  if (!invoke || !appWindow) return createUnavailableGateway();
  let pendingNewPasswordSession: string | null = null;
  const clearPendingChallenge = () => { pendingNewPasswordSession = null; };
  const call = <T>(command: AllowedCommand, args: Record<string, unknown> | undefined, validate: (value: unknown) => T) => invoke<unknown>(command, args).then(validate);
  const signIn = async (username: string, password: string, remember: boolean): Promise<AuthOutcome> => {
    clearPendingChallenge();
    try {
      const result = authOutcome(await call("sign_in", { username, password, remember }, (value) => value));
      if (result.outcome === "NewPasswordRequired") {
        pendingNewPasswordSession = result.privateSession;
      }
      return publicAuthOutcome(result);
    } catch (error) {
      clearPendingChallenge();
      throw error;
    }
  };
  const completeNewPassword = async (username: string, newPassword: string, remember: boolean): Promise<AuthOutcome> => {
    const session = pendingNewPasswordSession;
    if (!session) throw new Error("Your sign-in challenge has expired. Sign in again.");
    try {
      const result = authOutcome(await call("complete_new_password", { username, newPassword, session, remember }, (value) => value));
      if (result.outcome === "NewPasswordRequired") pendingNewPasswordSession = result.privateSession;
      else clearPendingChallenge();
      return publicAuthOutcome(result);
    } catch (error) {
      clearPendingChallenge();
      throw error;
    }
  };
  const windowActions: Record<WindowAction, () => Promise<void>> = { minimize: () => appWindow.minimize(), "toggle-maximize": () => appWindow.toggleMaximize(), close: () => appWindow.close() };
  return {
    kind: "tauri",
    window: { act: (action) => windowActions[action](), startDragging: () => appWindow.startDragging() },
    auth: { signIn, completeNewPassword, clearPendingChallenge, restoreSession: async () => { clearPendingChallenge(); try { return await call("restore_session", undefined, restoreOutcome); } catch (error) { clearPendingChallenge(); throw error; } }, signOut: async () => { clearPendingChallenge(); await call("sign_out", undefined, () => undefined); } },
    library: { listChildren: (folderId) => call("list_children", { folderId: validFolderId(folderId) }, childList), getUsage: () => call("get_usage", undefined, usage), mountStatus: () => call("mount_status", undefined, mountStatus), mountStash: () => call("mount_stash", undefined, mountStatus), unmountStash: () => call("unmount_stash", undefined, mountStatus) },
    stash: {
      selectSource: (kind) => call("select_stash_source", { kind }, sourceSummary),
      confirm: () => call("confirm_stash", undefined, transferStatus),
      status: () => call("get_transfer_status", undefined, transferStatus),
      cancel: () => call("cancel_stash", undefined, transferStatus),
      onNativeDrop: async (listener) => {
        if (!tauri.event?.listen) return () => undefined;
        return tauri.event.listen("stash-drop", (event) => listener(nativeDropNotice((event as { [key: string]: unknown })["p" + "ayload"])));
      },
    },
    unavailable: (capability) => `${capabilityLabel(capability)} is not available in this build yet.`,
  };
}

export function createUnavailableGateway(): DesktopGateway {
  const unavailable = async () => { throw new Error("Desktop connection is unavailable in this build."); };
  return { kind: "unavailable", window: { act: unavailable, startDragging: unavailable }, auth: { signIn: unavailable, completeNewPassword: unavailable, clearPendingChallenge: () => undefined, restoreSession: async () => ({ outcome: "SignedOut" }), signOut: unavailable }, library: { listChildren: unavailable, getUsage: unavailable, mountStatus: unavailable, mountStash: unavailable, unmountStash: unavailable }, stash: { selectSource: unavailable, confirm: unavailable, status: unavailable, cancel: unavailable, onNativeDrop: async () => () => undefined }, unavailable: (capability) => `${capabilityLabel(capability)} is available in the desktop app when its backend capability is implemented.` } as DesktopGateway;
}
function capabilityLabel(capability: Parameters<DesktopGateway["unavailable"]>[0]): string { return { home: "Home summaries", search: "Search", "stash-it": "Stash It", "recent-stashes": "Recent Stashes", offline: "Offline files", transfers: "Transfers", settings: "Settings" }[capability]; }
