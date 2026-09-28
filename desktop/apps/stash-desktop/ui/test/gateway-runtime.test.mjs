import assert from "node:assert/strict";
import test from "node:test";

const runtime = await import(new URL("../.test-dist/gateway-runtime.js", import.meta.url).href);

test("built gateway keeps challenge sessions private and allowlists child DTOs", async () => {
  const result = await runtime.runGatewayBoundaryScenario();
  assert.deepEqual(result.challenge, { outcome: "NewPasswordRequired", username: "person@example.com" });
  assert.deepEqual(result.repeatedChallenge, { outcome: "NewPasswordRequired", username: "person@example.com" });
  assert.equal("privateSession" in result.repeatedChallenge, false);
  assert.equal("session" in result.repeatedChallenge, false);
  assert.deepEqual(result.completed, { outcome: "SignedIn", username: "person@example.com" });
  assert.deepEqual(result.focus, ["username", "password", null]);
  assert.deepEqual(result.calls[0], { command: "sign_in", args: { username: "person@example.com", password: "TemporaryPass123!", remember: true } });
  assert.deepEqual(result.calls[1], { command: "complete_new_password", args: { username: "person@example.com", newPassword: "BrandNewPassword456!", session: "opaque-private-challenge", remember: true } });
  assert.deepEqual(result.calls[2], { command: "complete_new_password", args: { username: "person@example.com", newPassword: "BrandNewPassword456!", session: "opaque-next-challenge", remember: true } });
  assert.deepEqual(result.children.items, [
    { entity: "FOLDER", name: "Samples", folderId: "folder-1" },
    { entity: "FILE", name: "kick.wav", sizeBytes: 42, state: "committed", originalRelativePath: "Samples/kick.wav", fileId: "file-1" },
  ]);
  assert.equal(JSON.stringify(result.children).includes("opaque-private-challenge"), false);
  assert.equal(JSON.stringify(result.children).match(/objectKey|presignedUrl|checksum|indexKey|token|metadata|arbitraryMetadata/g), null);
});
