import { userIdFromEvent } from "../../../shared/src/index.js";
import { deviceView, errorResult, registerInput } from "./http.js";
import type { DeviceRepository } from "./repository.js";
import type { HandlerResult } from "./http.js";

export function registerDevice(deps: { repo: DeviceRepository; now?: () => Date }) {
  return async (event: any): Promise<HandlerResult> => {
    try {
      const record = await deps.repo.register(userIdFromEvent(event), registerInput(event), (deps.now?.() ?? new Date()).toISOString());
      return { statusCode: 200, body: JSON.stringify(deviceView(record)) };
    } catch (err) { return errorResult(err); }
  };
}
