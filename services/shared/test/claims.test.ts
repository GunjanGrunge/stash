import { describe, it, expect } from "vitest";
import type { APIGatewayProxyEventV2WithJWTAuthorizer } from "aws-lambda";
import { userIdFromEvent } from "../src/claims.js";

function eventWith(claims: Record<string, unknown> | undefined, body?: string) {
  return {
    version: "2.0",
    routeKey: "POST /files",
    rawPath: "/files",
    rawQueryString: "",
    headers: {},
    body,
    isBase64Encoded: false,
    requestContext: {
      accountId: "123456789012",
      apiId: "api",
      domainName: "example.com",
      domainPrefix: "api",
      http: {
        method: "POST",
        path: "/files",
        protocol: "HTTP/1.1",
        sourceIp: "127.0.0.1",
        userAgent: "vitest",
      },
      requestId: "req-1",
      routeKey: "POST /files",
      stage: "$default",
      time: "01/Jan/2026:00:00:00 +0000",
      timeEpoch: 1767225600000,
      authorizer: claims === undefined ? undefined : { jwt: { claims, scopes: [] } },
    },
  } as unknown as APIGatewayProxyEventV2WithJWTAuthorizer;
}

describe("userIdFromEvent", () => {
  it("returns the sub claim from the verified JWT authorizer", () => {
    const event = eventWith({ sub: "user-abc-123", email: "creator@example.com" });
    expect(userIdFromEvent(event)).toBe("user-abc-123");
  });

  it("throws when the sub claim is absent", () => {
    expect(() => userIdFromEvent(eventWith({ email: "creator@example.com" }))).toThrow();
  });

  it("throws when there is no authorizer at all", () => {
    expect(() => userIdFromEvent(eventWith(undefined))).toThrow();
  });

  it("throws when sub is an empty string", () => {
    expect(() => userIdFromEvent(eventWith({ sub: "" }))).toThrow();
  });

  it("IGNORES a user_id present in the request body (Rule 7)", () => {
    const attacker = "attacker-user-id-999";
    const event = eventWith(
      { sub: "user-abc-123" },
      JSON.stringify({ user_id: attacker, original_relative_path: "Kicks/a.wav" }),
    );
    const result = userIdFromEvent(event);
    expect(result).toBe("user-abc-123");
    expect(result).not.toContain(attacker);
    expect(result.includes("attacker")).toBe(false);
  });

  it("ignores user_id in query string and path parameters (Rule 7)", () => {
    const event = eventWith({ sub: "user-abc-123" }) as any;
    event.queryStringParameters = { user_id: "qs-attacker" };
    event.pathParameters = { user_id: "path-attacker" };
    const result = userIdFromEvent(event as APIGatewayProxyEventV2WithJWTAuthorizer);
    expect(result).toBe("user-abc-123");
    expect(result).not.toContain("attacker");
  });
});
