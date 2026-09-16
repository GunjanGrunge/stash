import { HttpError, badRequest } from "../../../shared/src/index.js";
import type { DeviceRecord, DeviceView, RegisterDeviceInput } from "./types.js";

export interface HandlerResult { statusCode: number; body: string; }
export function errorResult(err: unknown): HandlerResult {
  if (err instanceof HttpError) return { statusCode: err.status, body: JSON.stringify({ code: err.code, message: err.message }) };
  return { statusCode: 500, body: JSON.stringify({ code: "internal_error", message: "Unexpected error" }) };
}
function requiredString(body: Record<string, unknown>, field: keyof RegisterDeviceInput, max: number): string {
  const value = body[field];
  if (typeof value !== "string" || value.trim().length === 0 || value.length > max) throw badRequest(`${field} must be a non-empty string of at most ${max} characters`);
  return value;
}
export function registerInput(event: any): RegisterDeviceInput {
  let body: unknown;
  try { body = typeof event?.body === "string" ? JSON.parse(event.body) : event?.body; } catch { throw badRequest("request body must be valid JSON"); }
  if (body === null || typeof body !== "object" || Array.isArray(body)) throw badRequest("request body must be a JSON object");
  const data = body as Record<string, unknown>;
  return { installationId: requiredString(data, "installationId", 256), name: requiredString(data, "name", 128), platform: requiredString(data, "platform", 64) };
}
export function deviceIdFromEvent(event: any): string {
  const id = event?.pathParameters?.id;
  if (typeof id !== "string" || id.length === 0) throw badRequest("device id is required in the path");
  return id;
}
export function deviceView(device: DeviceRecord): DeviceView { return { id: device.deviceId, name: device.name, platform: device.platform, registeredAt: device.registeredAt, revokedAt: device.revokedAt ?? null }; }
