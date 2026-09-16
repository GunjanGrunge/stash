import { randomUUID } from "node:crypto";
import { logger, notFound, userIdFromEvent } from "../../../shared/src/index.js";
import { deviceIdFromEvent, errorResult } from "./http.js";
import type { DeviceRepository } from "./repository.js";
import type { HandlerResult } from "./http.js";

export function revokeDevice(deps: { repo: DeviceRepository; now?: () => Date }) {
  return async (event: any): Promise<HandlerResult> => {
    try {
      const userId = userIdFromEvent(event);
      const deviceId = deviceIdFromEvent(event);
      const revoked = await deps.repo.revoke(userId, deviceId, (deps.now?.() ?? new Date()).toISOString());
      if (!revoked) throw notFound("device");
      const correlationId = event?.headers?.["x-correlation-id"] ?? event?.headers?.["X-Correlation-Id"] ?? randomUUID();
      logger(typeof correlationId === "string" ? correlationId : randomUUID()).info("device_revoked", { device_id: deviceId, user_id: userId });
      return { statusCode: 204, body: "" };
    } catch (err) { return errorResult(err); }
  };
}
