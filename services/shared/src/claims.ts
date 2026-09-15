import type { APIGatewayProxyEventV2WithJWTAuthorizer } from "aws-lambda";
import { HttpError } from "./errors.js";

/**
 * Rule 7: `user_id` comes ONLY from verified JWT claims.
 *
 * The value is read exclusively from
 * `event.requestContext.authorizer.jwt.claims.sub`, which API Gateway
 * populates only after the JWT authorizer has verified the token. A
 * `user_id` in the request body, query string or path parameters is never
 * consulted — those are attacker-controlled.
 */
export function userIdFromEvent(
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
): string {
  const claims = event?.requestContext?.authorizer?.jwt?.claims as
    | Record<string, unknown>
    | undefined;
  const sub = claims?.["sub"];

  if (typeof sub !== "string" || sub.length === 0) {
    throw new HttpError(401, "unauthorized", "Missing verified subject claim");
  }
  return sub;
}
