import { createTauriGateway } from "../src/platform/tauri/gateway";
import { firstInvalidSignInField } from "../src/state/authMachine";

type Call = { command: string; args?: Record<string, unknown> };

export async function runGatewayBoundaryScenario() {
  const calls: Call[] = [];
  const responses: Record<string, unknown> = {
    sign_in: { outcome: "NewPasswordRequired", username: "person@example.com", session: "opaque-private-challenge" },
    complete_new_password: [
      { outcome: "NewPasswordRequired", username: "person@example.com", session: "opaque-next-challenge" },
      { outcome: "SignedIn", username: "person@example.com" },
    ],
    list_children: {
      items: [
        { entity: "FOLDER", id: "folder-1", name: "Samples", arbitraryMetadata: "drop-me" },
        { entity: "FILE", fileId: "file-1", name: "kick.wav", sizeBytes: 42, state: "committed", originalRelativePath: "Samples/kick.wav", objectKey: "users/u1/file-1", presignedUrl: "https://secret.example", checksum: "hash", indexKey: "secret-index", token: "secret-token", metadata: { owner: "secret" } },
        { entity: "FILE", name: "malformed-no-id", objectKey: "should-not-escape" },
      ],
    },
  };
  (globalThis as typeof globalThis & { __TAURI__?: unknown }).__TAURI__ = {
    core: { invoke: async (command: string, args?: Record<string, unknown>) => {
      calls.push({ command, args });
      const response = responses[command];
      return Array.isArray(response) ? response.shift() : response;
    } },
    window: { getCurrentWindow: () => ({ minimize: async () => undefined, toggleMaximize: async () => undefined, close: async () => undefined, startDragging: async () => undefined }) },
  };
  const gateway = createTauriGateway();
  const challenge = await gateway.auth.signIn("person@example.com", "TemporaryPass123!", true);
  const repeatedChallenge = await gateway.auth.completeNewPassword("person@example.com", "BrandNewPassword456!", true);
  const completed = await gateway.auth.completeNewPassword("person@example.com", "BrandNewPassword456!", true);
  const children = await gateway.library.listChildren("ROOT");
  return { challenge, repeatedChallenge, completed, children, calls, focus: [firstInvalidSignInField("", "password"), firstInvalidSignInField("person@example.com", ""), firstInvalidSignInField("person@example.com", "password")] };
}
