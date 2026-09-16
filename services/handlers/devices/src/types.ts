export interface DeviceRecord {
  pk: string;
  sk: string;
  entity: "DEVICE";
  deviceId: string;
  installationId: string;
  name: string;
  platform: string;
  registeredAt: string;
  revokedAt?: string;
}

export interface DeviceView {
  id: string;
  name: string;
  platform: string;
  registeredAt: string;
  revokedAt: string | null;
}

export interface RegisterDeviceInput {
  installationId: string;
  name: string;
  platform: string;
}
