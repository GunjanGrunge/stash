import type { APIGatewayProxyEventV2WithJWTAuthorizer } from "aws-lambda";

const HEADER = "idempotency-key";

/**
 * Reads the caller-supplied `Idempotency-Key` header, if present.
 *
 * HTTP header names are case-insensitive, and API Gateway v2 lower-cases
 * them, but we compare case-insensitively so the helper is safe against
 * directly constructed events in tests. Returns undefined when absent or
 * blank; handlers decide whether the key is required.
 */
export function idempotencyKeyFromEvent(
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
): string | undefined {
  const headers = event?.headers as Record<string, string | undefined> | undefined;
  if (!headers) return undefined;

  for (const [name, value] of Object.entries(headers)) {
    if (name.toLowerCase() !== HEADER) continue;
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  return undefined;
}
