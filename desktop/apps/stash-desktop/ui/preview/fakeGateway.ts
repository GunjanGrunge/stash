// Dev-only preview gateway. Never imported by the shipped app (src/). It
// feeds the real screens deterministic sample data so each can be rendered
// and screenshotted against its Figma frame without a signed-in session.
import type { ChildItem, MountStatus, SearchResponse, SourceSummary, TransferStatus } from "../src/domain/types";
import type { DesktopGateway } from "../src/platform/contracts";

const folders: Record<string, ChildItem[]> = {
  ROOT: [
    { entity: "FOLDER", folderId: "kshmr5", name: "KSHMR Vol 5", state: "active" },
    { entity: "FOLDER", folderId: "nocturne", name: "Client Work", state: "active" },
    { entity: "FOLDER", folderId: "luts", name: "LUT Library", state: "active" },
    { entity: "FILE", fileId: "logo", name: "logo.svg", sizeBytes: 48_213, state: "committed", originalRelativePath: "logo.svg" },
  ],
  kshmr5: [
    { entity: "FOLDER", folderId: "kicks", name: "Kicks", state: "active" },
    { entity: "FOLDER", folderId: "snares", name: "Snares", state: "active" },
  ],
  kicks: [
    { entity: "FILE", fileId: "k1", name: "Kick_G#_128.wav", sizeBytes: 4_800_000, state: "committed", originalRelativePath: "KSHMR Vol 5/Kicks/Kick_G#_128.wav" },
    { entity: "FILE", fileId: "k2", name: "Kick_C_140.wav", sizeBytes: 3_900_000, state: "committed", originalRelativePath: "KSHMR Vol 5/Kicks/Kick_C_140.wav" },
  ],
};

const summary: SourceSummary = {
  sourceName: "Nocturne delivery masters",
  folderName: "Nocturne delivery masters",
  fileCount: 43,
  totalBytes: 28_400_000_000,
  entries: [
    { relativePath: "Masters/NOCTURNE_MASTER_07.wav", sizeBytes: 812_000_000 },
    { relativePath: "Stems/Drums.wav", sizeBytes: 402_000_000 },
  ],
};

let mounted = false;
let prefs = { launchAtLogin: true, mountAtLaunch: true, wasMounted: false };
const mount = (): MountStatus => ({ mounted, label: "STASH", ...(mounted ? { letter: "S" } : {}) });
const idle: TransferStatus = { phase: "Preparing", sourceName: null, fileCount: 0, completedFileCount: 0, totalBytes: 0, completedBytes: 0, manifestMatch: null, message: null };

const search = (query: string): SearchResponse => ({
  hits: query.trim()
    ? [
        { fileId: "k1", name: "Kick_G#_128.wav", path: "KSHMR Vol 5/Kicks/Kick_G#_128.wav", sizeBytes: 4_800_000, kind: "audio", extension: "wav", bpm: 128, key: "G#", resolution: null, fps: null },
        { fileId: "k4", name: "Kick_G#_128.wav", path: "KSHMR Vol 4/Kicks/Kick_G#_128.wav", sizeBytes: 4_700_000, kind: "audio", extension: "wav", bpm: 128, key: "G#", resolution: null, fps: null },
      ]
    : [],
  total: query.trim() ? 2 : 0,
  unsupported: [],
  understood: query.trim() ? ["Name: kick", "Key: G#", "Tempo: 120–130 BPM"] : [],
  indexedFiles: 38_412,
  truncated: false,
});

export function createPreviewGateway(): DesktopGateway {
  const ok = async () => undefined;
  return {
    kind: "tauri",
    window: { act: ok, startDragging: ok },
    auth: {
      signIn: async (username) => ({ outcome: "SignedIn", username }),
      completeNewPassword: async (username) => ({ outcome: "SignedIn", username }),
      clearPendingChallenge: () => undefined,
      restoreSession: async () => ({ outcome: "SignedOut" }),
      signOut: ok,
    },
    library: {
      listChildren: async (folderId) => ({ items: folders[folderId] ?? [] }),
      createFolder: async (name) => ({ entity: "FOLDER", folderId: `new-${name}`, name }),
      trashFolder: ok,
      trashFile: ok,
      getUsage: async () => ({ provisioned: true, usedBytes: 624 * 1024 ** 3, quotaBytes: 1024 ** 4 }),
      mountStatus: async () => mount(),
      mountStash: async () => { mounted = true; return mount(); },
      unmountStash: async () => { mounted = false; return mount(); },
      onMountChanged: async () => () => undefined,
      onLibraryChanged: async () => () => undefined,
      search: async (query) => search(query),
      storageBreakdown: async () => ({ kinds: [
        { kind: "video", bytes: 286 * 1024 ** 3, files: 2_104 },
        { kind: "audio", bytes: 174 * 1024 ** 3, files: 31_870 },
        { kind: "document", bytes: 82 * 1024 ** 3, files: 1_412 },
        { kind: "image", bytes: 48 * 1024 ** 3, files: 2_730 },
        { kind: "other", bytes: 34 * 1024 ** 3, files: 296 },
      ], indexedFiles: 38_412, truncated: false }),
      listStashes: async () => [
        { stashId: "st1", state: "completed", fileCount: 43, committedCount: 43, committedBytes: 28.4 * 1024 ** 3, startedAt: new Date(Date.now() - 42 * 60_000).toISOString(), updatedAt: new Date().toISOString(), name: "Nocturne delivery masters" },
        { stashId: "st2", state: "completed", fileCount: 1_847, committedCount: 1_847, committedBytes: 4.2 * 1024 ** 3, startedAt: new Date(Date.now() - 26 * 3_600_000).toISOString(), updatedAt: new Date().toISOString(), name: "KSHMR Vol 5" },
        { stashId: "st3", state: "cancelled", fileCount: 12, committedCount: 3, committedBytes: 90 * 1024 ** 2, startedAt: new Date(Date.now() - 3 * 86_400_000).toISOString(), updatedAt: new Date().toISOString(), name: null },
      ],
    },
    device: {
      info: async () => ({ name: "GUNJAN-PC", os: "Windows", appVersion: "0.1.0" }),
      preferences: async () => ({ ...prefs }),
      setPreferences: async (choice) => { prefs = { ...prefs, ...choice }; return { ...prefs }; },
    },
    stash: {
      selectSource: async () => summary,
      confirm: async () => ({ ...idle, phase: "Stashing", sourceName: summary.sourceName, fileCount: 43, completedFileCount: 18, totalBytes: summary.totalBytes, completedBytes: 11_900_000_000 }),
      status: async () => idle,
      cancel: async () => ({ ...idle, phase: "Canceled" }),
      onNativeDrop: async () => () => undefined,
    },
    unavailable: (capability) => `${capability} is not available in this build yet.`,
  } as DesktopGateway;
}
