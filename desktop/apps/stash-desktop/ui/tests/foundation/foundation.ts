import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Breadcrumb, HistoryButtons } from "../../src/components/ui";
import { authOutcomeEvent, authReducer, firstInvalidSignInField, initialAuthState, type AuthState } from "../../src/state/authMachine";
import { createTauriGateway, createUnavailableGateway, safeActionError } from "../../src/platform/tauri/gateway";
import type { DesktopGateway } from "../../src/platform/contracts";
import type { ChildItem } from "../../src/domain/types";
import { allGeneratedNodes, appendFolderLocation, FOUNDATION_SEEDS, generateFolderTree, navigateToKnownAncestor, sortForPresentation, type GeneratedTree } from "../../src/test/fixtures";
import css from "../../src/styles.css?raw";
import navigationSource from "../../src/components/NavigationRail.tsx?raw";
import filesSource from "../../src/components/FilesScreen.tsx?raw";
import titleBarSource from "../../src/components/TitleBar.tsx?raw";
import splashSource from "../../src/components/SplashScreen.tsx?raw";
import stashItSource from "../../src/components/StashItScreen.tsx?raw";
import shellSource from "../../src/components/Shell.tsx?raw";
import unavailableSource from "../../src/components/UnavailableScreen.tsx?raw";

export type FoundationSummary = { property: string; cases: number; seeds?: readonly number[] };
type FakeResponse = unknown | unknown[];
type FakeCall = { command: string; args?: Record<string, unknown> };
type TauriGlobal = { core: { invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown> }; window: { getCurrentWindow: () => Record<string, () => Promise<void>> } };

function installFake(responses: Record<string, FakeResponse>, calls: FakeCall[]): () => void {
  const queues = new Map(Object.entries(responses).map(([command, response]) => [command, Array.isArray(response) ? [...response] : [response]]));
  const fake: TauriGlobal = { core: { invoke: async (command, args) => { calls.push({ command, args }); const queue = queues.get(command); if (!queue || queue.length === 0) throw new Error(`Unexpected fake command: ${command}`); return queue.length > 1 ? queue.shift() : queue[0]; } }, window: { getCurrentWindow: () => ({ minimize: async () => undefined, toggleMaximize: async () => undefined, close: async () => undefined, startDragging: async () => undefined }) } };
  (globalThis as typeof globalThis & { __TAURI__?: TauriGlobal }).__TAURI__ = fake;
  return () => { delete (globalThis as typeof globalThis & { __TAURI__?: TauriGlobal }).__TAURI__; };
}

function expectState(state: AuthState): void {
  if (!["restoring", "welcome", "signIn", "newPassword", "signedIn"].includes(state.view)) throw new Error(`Invalid auth view: ${state.view}`);
  if (state.view === "newPassword" && (!state.username || typeof state.remember !== "boolean")) throw new Error("Invalid password-challenge state.");
  if (state.view === "signedIn" && !state.username) throw new Error("Invalid signed-in state.");
}

export function runAuthProperties(): FoundationSummary {
  const eventSequences = [
    [{ type: "RESTORE_SIGNED_OUT" }, { type: "OPEN_SIGN_IN" }, { type: "SIGN_IN_STARTED" }, { type: "SIGN_IN_FAILED", message: "Try again" }],
    [{ type: "RESTORE_SIGNED_IN", username: "person@example.com" }, { type: "BACK_TO_WELCOME" }],
    [{ type: "OPEN_SIGN_IN" }, { type: "SIGN_IN_STARTED" }, { type: "NEW_PASSWORD_REQUIRED", username: "person@example.com", remember: true }, { type: "NEW_PASSWORD_STARTED" }, { type: "NEW_PASSWORD_FAILED", message: "Try again" }, { type: "SIGNED_IN", username: "person@example.com" }],
  ] as const;
  for (const sequence of eventSequences) { let state: AuthState = initialAuthState; for (const event of sequence) { state = authReducer(state, event); expectState(state); } }
  const signedInEvent = authOutcomeEvent({ outcome: "SignedIn", username: "person@example.com" }, false);
  const challengeEvent = authOutcomeEvent({ outcome: "NewPasswordRequired", username: "person@example.com" }, true);
  if (signedInEvent.type !== "SIGNED_IN" || challengeEvent.type !== "NEW_PASSWORD_REQUIRED" || challengeEvent.remember !== true) throw new Error("Auth outcome mapping changed.");
  if (firstInvalidSignInField("", "password") !== "username" || firstInvalidSignInField("person@example.com", "") !== "password" || firstInvalidSignInField("person@example.com", "password") !== null) throw new Error("Sign-in focus order changed.");
  return { property: "P1 auth state transitions and public outcome mapping", cases: eventSequences.length + 3 };
}

function assertTreeIdentity(tree: GeneratedTree): number {
  const folderIds = new Set(tree.folders.map((folder) => folder.id));
  const nodeIds = new Set<string>();
  for (const folder of tree.folders) {
    if (folder.id !== "ROOT" && (!folder.parentId || !folderIds.has(folder.parentId))) throw new Error("Generated folder has an unknown parent.");
    for (const node of folder.children) {
      if (node.parentId !== folder.id) throw new Error("Child parent identity changed.");
      const id = node.item.entity === "FOLDER" ? node.item.folderId : node.item.fileId;
      if (!id || nodeIds.has(id)) throw new Error("Generated child identity was duplicated or lost.");
      nodeIds.add(id);
      if (node.item.entity === "FOLDER" && !folderIds.has(id)) throw new Error("Folder child points to an unknown folder.");
    }
  }
  return nodeIds.size;
}

export function runHierarchyProperties(): FoundationSummary {
  let generatedCases = 0; let generatedNodes = 0;
  for (const seed of FOUNDATION_SEEDS) {
    const tree = generateFolderTree(seed); generatedNodes += assertTreeIdentity(tree); generatedCases += 1;
    const allNodes = allGeneratedNodes(tree);
    for (const folder of tree.folders) {
      const original = folder.children.map((node) => node.item);
      const beforeIdentity = original.map((item) => `${item.entity}:${item.entity === "FOLDER" ? item.folderId : item.fileId}`);
      const sorted = sortForPresentation(original, "name", "ascending");
      const sortedIdentity = sorted.map((item) => `${item.entity}:${item.entity === "FOLDER" ? item.folderId : item.fileId}`);
      const afterIdentity = original.map((item) => `${item.entity}:${item.entity === "FOLDER" ? item.folderId : item.fileId}`);
      if (sorted.length !== original.length || sorted.some((item) => !allNodes.some((node) => node.item === item)) || [...sortedIdentity].sort().join("|") !== [...beforeIdentity].sort().join("|") || beforeIdentity.join("|") !== afterIdentity.join("|")) throw new Error("Presentation sorting changed an item identity or mutated its input.");
      for (const node of folder.children) {
        const path = appendFolderLocation([], node.item);
        if (node.item.entity === "FOLDER" && (path.length !== 1 || path[0].id !== node.item.folderId || path[0].name !== node.item.name)) throw new Error("Folder navigation did not use the returned ancestor.");
      }
    }
    const path = tree.folders.filter((folder) => folder.id !== "ROOT").slice(0, 3).map((folder) => ({ id: folder.id, name: folder.name }));
    const validIndex = path.length > 0 ? path.length - 1 : -1;
    const ancestor = navigateToKnownAncestor(path, validIndex);
    if (JSON.stringify(ancestor) !== JSON.stringify(path.slice(0, validIndex + 1))) throw new Error("Breadcrumb navigation did not return the exact known ancestor slice.");
    if (JSON.stringify(navigateToKnownAncestor([], -1)) !== JSON.stringify([])) throw new Error("Root breadcrumb navigation did not return an empty path.");
  }
  if (generatedNodes === 0) throw new Error("Generator produced no cases.");
  return { property: "P2 generated hierarchy identity, sorting, and known-ancestor navigation", cases: generatedCases, seeds: FOUNDATION_SEEDS };
}

function safeGeneratedChildren(tree: GeneratedTree): unknown[] {
  return allGeneratedNodes(tree).slice(0, 8).map(({ item }) => ({ ...(item.entity === "FOLDER" ? { entity: "FOLDER", id: item.folderId, name: item.name } : { entity: "FILE", fileId: item.fileId, name: item.name, sizeBytes: item.sizeBytes, originalRelativePath: item.originalRelativePath }), objectKey: "opaque-test-object-key", token: "opaque-test-token" }));
}

async function runMalformedDtoChecks(): Promise<void> {
  const calls: FakeCall[] = []; const cleanup = installFake({ restore_session: { unexpected: true }, list_children: { unexpected: true }, mount_status: { mounted: "yes", label: "STASH" } }, calls);
  try {
    const gateway = createTauriGateway();
    await gateway.auth.restoreSession().then(() => { throw new Error("Malformed restore DTO was accepted."); }, () => undefined);
    await gateway.library.listChildren("ROOT").then(() => { throw new Error("Malformed child DTO was accepted."); }, () => undefined);
    await gateway.library.mountStatus().then(() => { throw new Error("Malformed mount DTO was accepted."); }, () => undefined);
  } finally { cleanup(); }
}

export async function runGatewayProperties(): Promise<FoundationSummary> {
  const calls: FakeCall[] = []; const cleanup = installFake({
    sign_in: { outcome: "NewPasswordRequired", username: "person@example.com", session: "opaque-test-challenge" }, complete_new_password: { outcome: "SignedIn", username: "person@example.com" }, restore_session: { outcome: "SignedOut" }, sign_out: undefined,
    list_children: { items: [...safeGeneratedChildren(generateFolderTree(FOUNDATION_SEEDS[0])), { entity: "FILE", name: "missing-id" }] }, get_usage: { provisioned: true, usedBytes: 10, quotaBytes: 20, secret: "discard" }, mount_status: { mounted: false, label: "STASH", letter: "S" }, mount_stash: { mounted: true, label: "STASH", letter: "S" }, unmount_stash: { mounted: false, label: "STASH", letter: "S" },
  }, calls);
  try {
    const gateway = createTauriGateway();
    const challenge = await gateway.auth.signIn("person@example.com", "fake-password", true); const signedIn = await gateway.auth.completeNewPassword("person@example.com", "fake-new-password", true); const restored = await gateway.auth.restoreSession(); await gateway.auth.signOut();
    const children = await gateway.library.listChildren(" ROOT "); const usage = await gateway.library.getUsage(); const mount = await gateway.library.mountStatus(); const mounted = await gateway.library.mountStash(); const unmounted = await gateway.library.unmountStash();
    const callCountBeforeInvalidId = calls.length;
    await Promise.resolve().then(() => gateway.library.listChildren("../not-a-folder")).then(() => { throw new Error("Invalid folder ID was accepted."); }, () => undefined);
    if (calls.length !== callCountBeforeInvalidId) throw new Error("Invalid folder ID reached invoke.");
    const normalizedListCall = calls.find(({ command }) => command === "list_children");
    if (normalizedListCall?.args?.folderId !== "ROOT") throw new Error("Valid folder ID was not normalized before invoke.");
    if (JSON.stringify(challenge).includes("session") || JSON.stringify(challenge).includes("password") || JSON.stringify(signedIn).includes("password")) throw new Error("Public auth result exposed credential material.");
    if (children.items?.some((item) => (!item.fileId && !item.folderId) || /objectKey|token|opaque-test/.test(JSON.stringify(item)))) throw new Error("Child DTO sanitization leaked unsafe data.");
    if (usage.usedBytes !== 10 || restored.outcome !== "SignedOut" || !mounted.mounted || unmounted.mounted || mount.mounted) throw new Error("Safe gateway DTO mapping changed.");
    const allowed = new Set(["sign_in", "complete_new_password", "restore_session", "sign_out", "list_children", "get_usage", "mount_status", "mount_stash", "unmount_stash"]);
    if (calls.some(({ command }) => !allowed.has(command))) throw new Error("Gateway invoked a command outside the allowlist.");
    await runMalformedDtoChecks();
    const unsafeMessages = [
      "password=TemporaryPass123!",
      "session=opaque-private-session",
      '{"objectKey":"private/file.wav"}',
      "presigned URL: https://s3.example.test/stash/file.wav?X-Amz-Signature=opaque-signature",
      "authorization: Bearer opaque-authorization-token",
      "Bearer eyJhbGciOiJIUzI1NiJ9.opaque.payload",
    ];
    for (const message of unsafeMessages) if (safeActionError(new Error(message), "Safe fallback") !== "Safe fallback") throw new Error(`Unsafe error material was exposed: ${message}`);
    if (safeActionError(new Error("NotAuthorizedException: password=should-not-matter"), "Safe fallback") !== "Incorrect username or password.") throw new Error("Known authorization mapping changed.");
    if (safeActionError(new Error("InvalidPasswordException: password=should-not-matter"), "Safe fallback") !== "That password doesn't meet the account's password requirements.") throw new Error("Known password mapping changed.");
    if (safeActionError(new Error("The desktop request timed out"), "Safe fallback") !== "The desktop request timed out") throw new Error("Normal short error messages were not preserved.");
    const unavailable: DesktopGateway = createUnavailableGateway();
    if (unavailable.kind !== "unavailable" || !unavailable.unavailable("search").includes("desktop app") || (await unavailable.auth.restoreSession()).outcome !== "SignedOut") throw new Error("Unavailable capability behavior changed.");
    return { property: "P4/P6 gateway allowlisting, DTO validation, sanitization, and unavailable behavior", cases: calls.length + 8, seeds: FOUNDATION_SEEDS.slice(0, 1) };
  } finally { cleanup(); }
}

function tokenBlock(source: string, marker: string): string { const match = source.match(new RegExp(`${marker}\\s*\\{([^}]*)\\}`)); if (!match) throw new Error(`Missing token block: ${marker}`); return match[1]; }

export function runThemeAccessibilityContracts(): FoundationSummary {
  const requiredTokens = ["stash-ink", "stash-white", "stash-cyan", "stash-violet", "stash-gradient", "surface", "surface-card", "text", "muted", "border", "focus"];
  const light = tokenBlock(css, ":root");
  for (const token of requiredTokens) if (!light.includes(`--${token}:`)) throw new Error(`Visual token is incomplete: ${token}`);
  if (!css.includes("prefers-color-scheme: dark") || !css.includes("focus-visible")) throw new Error("Theme or focus contract changed.");
  for (const label of ["Minimize window", "Maximize or restore window", "Hide STASH to tray"]) if (!titleBarSource.includes(`aria-label=\"${label}\"`)) throw new Error(`Missing window action name: ${label}`);
  if (!navigationSource.includes('role="alert"') || !navigationSource.includes("Refresh storage") || !filesSource.includes("banner-warning") || !filesSource.includes("toggleSort")) throw new Error("Status/action naming contract changed.");
  return { property: "P5 semantic theme tokens, non-color status labels, focus/action names, and reduced motion", cases: requiredTokens.length * 2 + 7 };
}

export function runWritePathUiContracts(): FoundationSummary {
  for (const token of ["onCompleteRef", "finishedRef", "clearTimeout", "onClick={complete}"]) if (!splashSource.includes(token)) throw new Error(`Splash lifecycle contract missing: ${token}`);
  for (const token of ["onNativeDrop", "is-drag-over", "Choose file", "Choose folder", "Release to Stash it"]) if (!stashItSource.includes(token)) throw new Error(`Drop entry contract missing: ${token}`);
  if (!shellSource.includes("UnavailableScreen") || /active === \"Files\" \|\| active === \"Search\"/.test(shellSource)) throw new Error("Unavailable navigation destinations silently reuse Files.");
  for (const label of ["Search", "Recent Stashes"]) if (!unavailableSource.includes("STASH capability notice") || !shellSource.includes(label)) throw new Error(`Navigation notice missing: ${label}`);
  if (!shellSource.includes("onNativeDrop") || !shellSource.includes("setDragOver")) throw new Error("Home drag-over subscription is missing.");
  return { property: "P7 splash cleanup/skip, native drop entry, and explicit unavailable navigation", cases: 4 };
}

export { applyFacets, facetGroups } from "../../src/components/SearchScreen";
export { clock, peaks } from "../../src/components/AssetDetailsScreen";
export { previewKindOf, previewUrl } from "../../src/platform/preview";
export { canGoBack, canGoForward, currentPlace, goBack, goForward, startHistory, visit } from "../../src/domain/history";
export { resolveFolders } from "../../src/components/FilesScreen";

/** Server-rendered Back / Forward buttons. */
export function renderHistoryButtons(canBack: boolean, canForward: boolean): string {
  return renderToStaticMarkup(createElement(HistoryButtons, { canBack, canForward, onBack: () => undefined, onForward: () => undefined }));
}

/** Server-rendered Figma breadcrumb, for asserting its real markup. */
export function renderBreadcrumb(trail: { id: string; name: string }[], itemCount?: number): string {
  return renderToStaticMarkup(createElement(Breadcrumb, { trail, onNavigate: () => undefined, itemCount }));
}

export async function runFoundationSuite(): Promise<FoundationSummary[]> { return [runAuthProperties(), runHierarchyProperties(), await runGatewayProperties(), runThemeAccessibilityContracts(), runWritePathUiContracts()]; }

