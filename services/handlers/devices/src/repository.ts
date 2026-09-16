import type { DeviceRecord, RegisterDeviceInput } from "./types.js";

export interface DeviceRepository {
  register(userId: string, input: RegisterDeviceInput, now: string): Promise<DeviceRecord>;
  find(userId: string, deviceId: string): Promise<DeviceRecord | undefined>;
  revoke(userId: string, deviceId: string, now: string): Promise<boolean>;
}
