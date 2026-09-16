import { describe, expect, it, vi } from "vitest";
import { MemoryDeviceRepository } from "../src/memory-repository.js";
import { registerDevice } from "../src/register-device.js";
import { revokeDevice } from "../src/revoke-device.js";

const event = (body: unknown, sub = "a") => ({ body: JSON.stringify(body), requestContext: { authorizer: { jwt: { claims: { sub } } } } });
const remove = (id: string, sub = "a") => ({ pathParameters: { id }, requestContext: { authorizer: { jwt: { claims: { sub } } } }, headers: { "x-correlation-id": "corr" } });
const input = { installationId: "install-1", name: "Studio Mac", platform: "macos" };

describe("device registration and revocation", () => {
  it("uses a server id and re-registers the same installation idempotently", async () => {
    const repo = new MemoryDeviceRepository(); const handler = registerDevice({ repo, now: () => new Date("2026-01-01T00:00:00Z") });
    const first = JSON.parse((await handler(event(input))).body);
    const again = JSON.parse((await handler(event({ ...input, name: "Renamed" }))).body);
    expect(first.id).toEqual(again.id); expect(first.id).not.toEqual(input.installationId); expect(again.name).toBe("Renamed");
  });
  it("soft-revokes, retains audit state, and accepts a repeat revoke", async () => {
    const repo = new MemoryDeviceRepository(); const registered = JSON.parse((await registerDevice({ repo })(event(input))).body);
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    expect((await revokeDevice({ repo, now: () => new Date("2026-01-02T00:00:00Z") })(remove(registered.id))).statusCode).toBe(204);
    expect((await repo.find("a", registered.id))?.revokedAt).toBe("2026-01-02T00:00:00.000Z");
    expect((await revokeDevice({ repo })(remove(registered.id))).statusCode).toBe(204);
    expect(log).toHaveBeenCalledWith(expect.stringContaining("device_revoked")); log.mockRestore();
  });
  it("returns 404 for a foreign or unknown device and validates registration", async () => {
    const repo = new MemoryDeviceRepository(); const registered = JSON.parse((await registerDevice({ repo })(event(input, "b"))).body);
    expect((await revokeDevice({ repo })(remove(registered.id, "a"))).statusCode).toBe(404);
    expect((await revokeDevice({ repo })(remove("missing"))).statusCode).toBe(404);
    expect((await registerDevice({ repo })(event({ name: "x", platform: "macos" }))).statusCode).toBe(400);
  });
});
