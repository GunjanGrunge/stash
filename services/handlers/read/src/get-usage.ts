import { userIdFromEvent } from "../../../shared/src/index.js";
import type { ReadRepository } from "./repository.js";
import type { HandlerResult } from "./types.js";
import { toErrorResponse } from "./http.js";

/**
 * The storage indicator payload.
 *
 * Raw byte counts only — the client renders "624 GB of 1 TB". A handler that
 * returned a formatted string would bake a locale and a unit convention into
 * the control plane.
 *
 * `quotaBytes` is `null`, not `0`, when no quota has been provisioned yet:
 * `0` would legitimately mean "this creator may Stash nothing", and the two
 * states must stay distinguishable. `provisioned` makes the distinction
 * explicit so a client never has to infer it from a null.
 */
interface UsageView {
  usedBytes: number;
  quotaBytes: number | null;
  provisioned: boolean;
}

/**
 * GET /me/usage — the calling creator's storage counters.
 *
 * Rule 7: the creator is taken from the verified claim, so the pk is never
 * attacker-chosen and another creator's counters are unaddressable.
 */
export function getUsage(deps: { repo: ReadRepository }) {
  return async (event: any): Promise<HandlerResult> => {
    try {
      const userId = userIdFromEvent(event);
      const usage = await deps.repo.getUsage(userId);

      // A creator with no PROFILE item has a verified identity but has not
      // been provisioned yet — they simply have not Stashed anything. That
      // is a 200 with a zeroed, explicitly unprovisioned reading, not a 404:
      // a 404 would deny the existence of the caller to the caller, and a
      // fabricated default quota would misreport what they may Stash.
      const view: UsageView =
        usage === undefined
          ? { usedBytes: 0, quotaBytes: null, provisioned: false }
          : {
              usedBytes: usage.usedBytes,
              quotaBytes: usage.quotaBytes,
              provisioned: true,
            };

      return { statusCode: 200, body: JSON.stringify(view) };
    } catch (err) {
      return toErrorResponse(err);
    }
  };
}
