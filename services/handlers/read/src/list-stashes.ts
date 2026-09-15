import { badRequest, notFound, userIdFromEvent } from "../../../shared/src/index.js";
import type { ReadRepository } from "./repository.js";
import type { HandlerResult, StashRecord, StashState } from "./types.js";
import { toErrorResponse } from "./http.js";

export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 100;

/** One Stash as the client sees it. Key attributes are deliberately absent. */
interface StashView {
  stashId: string;
  state: StashState;
  fileCount: number;
  committedCount: number;
  reservedBytes: number;
  committedBytes: number;
  startedAt: string;
  updatedAt: string;
}

function toView(record: StashRecord): StashView {
  return {
    stashId: record.stashId,
    state: record.state,
    fileCount: record.fileCount,
    committedCount: record.committedCount,
    reservedBytes: record.reservedBytes,
    committedBytes: record.committedBytes,
    startedAt: record.startedAt,
    updatedAt: record.updatedAt,
  };
}

/**
 * Most-recent-first, by `startedAt` descending.
 *
 * The sort key is `STASH#<stash_id>` and a stash_id is an OPAQUE id, not a
 * time-ordered one, so a DynamoDB `ScanIndexForward: false` query would
 * order by id and only look like recency. Recency is therefore derived from
 * the attribute that actually carries it.
 *
 * The tie-break on stash_id is load-bearing, not cosmetic: two Stashes can
 * share a `startedAt`, and an unstable order across two page requests would
 * drop or repeat a creator's Stash at the page boundary.
 */
function byRecencyDesc(a: StashRecord, b: StashRecord): number {
  if (a.startedAt !== b.startedAt) return a.startedAt < b.startedAt ? 1 : -1;
  if (a.stashId === b.stashId) return 0;
  return a.stashId < b.stashId ? 1 : -1;
}

/**
 * The cursor is the opaque `stash_id` of the last Stash already delivered,
 * base64url-encoded so nothing invites a client to parse it.
 *
 * It deliberately carries NO DynamoDB key material. An `ExclusiveStartKey`
 * would embed `pk = USER#<user_id>` — another creator's partition key handed
 * to whoever holds the cursor. Here the partition is always rebuilt from the
 * caller's verified claim, so a stolen cursor can only ever be resolved
 * inside the thief's own partition, where it does not exist.
 */
function encodeCursor(stashId: string): string {
  return Buffer.from(stashId, "utf8").toString("base64url");
}

function cursorFromEvent(event: any): string | null {
  const raw = (event?.queryStringParameters ?? {})["cursor"];
  if (raw === undefined || raw === null || raw === "") return null;
  if (typeof raw !== "string") throw badRequest("cursor is not valid");
  return Buffer.from(raw, "base64url").toString("utf8");
}

function limitFromEvent(event: any): number {
  const raw = (event?.queryStringParameters ?? {})["limit"];
  if (raw === undefined || raw === null) return DEFAULT_PAGE_SIZE;
  // A malformed limit is rejected rather than defaulted: silently substituting
  // a page size is how a client ends up believing it has seen everything.
  if (typeof raw !== "string" || !/^[0-9]+$/.test(raw)) {
    throw badRequest("limit must be a whole number");
  }
  const limit = Number(raw);
  if (limit < 1 || limit > MAX_PAGE_SIZE) {
    throw badRequest(`limit must be between 1 and ${MAX_PAGE_SIZE}`);
  }
  return limit;
}

/**
 * GET /stashes — Recent Stashes (PRD §19).
 *
 * Rule 7: the creator is taken from the verified claim, so the partition is
 * never attacker-chosen and another creator's Stashes are unreachable.
 *
 * The repository follows every underlying page before this handler slices a
 * client page out of the result, so a Stash can never be silently dropped
 * between the table and the response.
 */
export function listStashes(deps: { repo: ReadRepository }) {
  return async (event: any): Promise<HandlerResult> => {
    try {
      const userId = userIdFromEvent(event);
      const limit = limitFromEvent(event);
      const after = cursorFromEvent(event);

      const all = await deps.repo.listStashes(userId);
      const sorted = [...all].sort(byRecencyDesc);

      let start = 0;
      if (after !== null) {
        const index = sorted.findIndex((s) => s.stashId === after);
        // A cursor naming a Stash this creator does not have is
        // INDISTINGUISHABLE from one that never existed: 404, never 403 and
        // never a silent empty page. An empty 200 would confirm to a probing
        // client that the borrowed cursor was at least well-formed.
        if (index === -1) throw notFound("Stash");
        start = index + 1;
      }

      const page = sorted.slice(start, start + limit);
      const last = page[page.length - 1];
      const hasMore = start + page.length < sorted.length;

      return {
        statusCode: 200,
        body: JSON.stringify({
          stashes: page.map(toView),
          nextCursor:
            hasMore && last !== undefined ? encodeCursor(last.stashId) : null,
        }),
      };
    } catch (err) {
      return toErrorResponse(err);
    }
  };
}
