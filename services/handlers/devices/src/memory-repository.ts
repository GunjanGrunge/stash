import { randomUUID } from "node:crypto";
import type { DeviceRepository } from "./repository.js";
import type { DeviceRecord, RegisterDeviceInput } from "./types.js";

export class MemoryDeviceRepository implements DeviceRepository {
  private readonly devices = new Map<string, DeviceRecord>();
  private readonly installations = new Map<string, string>();

  async register(userId: string, input: RegisterDeviceInput, now: string): Promise<DeviceRecord> {
    const identity = `${userId}\u0000${input.installationId}`;
    const existingId = this.installations.get(identity);
    if (existingId !== undefined) {
      const existing = this.devices.get(`${userId}\u0000${existingId}`)!;
      const updated = { ...existing, name: input.name, platform: input.platform };
      delete updated.revokedAt;
      this.devices.set(`${userId}\u0000${existingId}`, updated);
      return updated;
    }
    const record: DeviceRecord = {
      pk: `USER#${userId}`, sk: `DEVICE#${randomUUID()}`, entity: "DEVICE",
      deviceId: randomUUID(), installationId: input.installationId,
      name: input.name, platform: input.platform, registeredAt: now,
    };
    // The storage id is one server-generated value, not an installation id.
    record.sk = `DEVICE#${record.deviceId}`;
    this.devices.set(`${userId}\u0000${record.deviceId}`, record);
    this.installations.set(identity, record.deviceId);
    return record;
  }

  async find(userId: string, deviceId: string): Promise<DeviceRecord | undefined> {
    return this.devices.get(`${userId}\u0000${deviceId}`);
  }

  async revoke(userId: string, deviceId: string, now: string): Promise<boolean> {
    const record = await this.find(userId, deviceId);
    if (record === undefined) return false;
    if (record.revokedAt === undefined) this.devices.set(`${userId}\u0000${deviceId}`, { ...record, revokedAt: now });
    return true;
  }
}
