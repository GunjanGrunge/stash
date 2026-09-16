import { beforeAll, describe, expect, it } from "vitest";
import * as cdk from "aws-cdk-lib";
import * as cognito from "aws-cdk-lib/aws-cognito";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as iam from "aws-cdk-lib/aws-iam";
import * as s3 from "aws-cdk-lib/aws-s3";
import { Template } from "aws-cdk-lib/assertions";
import { StashApiStack } from "../lib/api-stack";

const ENV = { account: "111122223333", region: "ap-south-1" };
const TABLE_ARN = `arn:aws:dynamodb:${ENV.region}:${ENV.account}:table/StashTable`;
const BUCKET_NAME = "stash-test-bucket";
const ROLE_ARN = `arn:aws:iam::${ENV.account}:role/StashAppRole`;
const USER_POOL_ID = "ap-south-1_TESTPOOL";
const USER_POOL_CLIENT_ID = "testdesktopclientid";

/**
 * The complete approved route set (Addendum A2). Path parameter names are the
 * ones the handlers actually read — `{folderId}` for `listChildren`,
 * `{file_id}` for the upload handlers, `{id}` for the stash handlers — not the
 * names §3.4's prose uses.
 */
const EXPECTED_ROUTE_KEYS = [
  "DELETE /files/{id}",
  "GET /trash",
  "POST /files/{id}/restore",
  "GET /files/{id}",
  "POST /devices",
  "DELETE /devices/{id}",
  "POST /stashes",
  "POST /stashes/{id}/manifest-check",
  "POST /stashes/{id}/files",
  "POST /stashes/{id}/complete",
  "POST /stashes/{id}/cancel",
  "POST /uploads/{file_id}/parts",
  "POST /uploads/{file_id}/complete",
  "POST /uploads/{file_id}/abort",
  "GET /folders/{folderId}/children",
  "GET /stashes",
  "GET /me/usage",
] as const;

/** Bundling 11 esbuild assets is slow; synthesize exactly once. */
let template: Template;
let stack: StashApiStack;

beforeAll(() => {
  const app = new cdk.App();
  const host = new cdk.Stack(app, "Fixtures", { env: ENV });
  stack = new StashApiStack(app, "TestStashApiStack", {
    env: ENV,
    userPool: cognito.UserPool.fromUserPoolId(host, "UP", USER_POOL_ID),
    userPoolClient: cognito.UserPoolClient.fromUserPoolClientId(
      host,
      "UPC",
      USER_POOL_CLIENT_ID,
    ),
    table: dynamodb.Table.fromTableArn(host, "T", TABLE_ARN),
    bucket: s3.Bucket.fromBucketName(host, "B", BUCKET_NAME),
    role: iam.Role.fromRoleArn(host, "R", ROLE_ARN),
  });
  template = Template.fromStack(stack);
}, 300_000);

interface RouteProps {
  RouteKey: string;
  AuthorizationType?: string;
  AuthorizerId?: unknown;
  Target?: unknown;
}

function routes(): RouteProps[] {
  return Object.values(
    template.findResources("AWS::ApiGatewayV2::Route"),
  ).map((r) => r.Properties as RouteProps);
}

function functions(): Array<Record<string, unknown>> {
  return Object.values(
    template.findResources("AWS::Lambda::Function"),
  ).map((r) => r.Properties as Record<string, unknown>);
}

describe("StashApiStack route table", () => {
  it("is an HTTP API, not a REST API (spec §3.4)", () => {
    template.resourceCountIs("AWS::ApiGatewayV2::Api", 1);
    template.resourceCountIs("AWS::ApiGateway::RestApi", 0);
    template.hasResourceProperties("AWS::ApiGatewayV2::Api", {
      ProtocolType: "HTTP",
    });
  });

  it("exposes exactly the 17 approved routes — no missing route and no extra one", () => {
    const keys = routes().map((r) => r.RouteKey).sort();
    expect(keys).toEqual([...EXPECTED_ROUTE_KEYS].sort());
  });

  it("creates exactly 17 routes, so an accidental extra route cannot hide", () => {
    template.resourceCountIs("AWS::ApiGatewayV2::Route", 17);
  });

  for (const key of EXPECTED_ROUTE_KEYS) {
    it(`declares "${key}" with its own Lambda integration`, () => {
      const hit = routes().filter((r) => r.RouteKey === key);
      expect(hit).toHaveLength(1);
      expect(hit[0]!.Target).toBeDefined();
    });
  }

  it("gives every route its OWN integration — no route shares a handler", () => {
    const targets = routes().map((r) => JSON.stringify(r.Target));
    expect(new Set(targets).size).toBe(EXPECTED_ROUTE_KEYS.length);
    template.resourceCountIs("AWS::ApiGatewayV2::Integration", 17);
  });
});

describe("StashApiStack authorization", () => {
  it("attaches the JWT authorizer to EVERY route — none is unauthenticated", () => {
    const all = routes();
    expect(all.length).toBe(EXPECTED_ROUTE_KEYS.length);
    for (const route of all) {
      expect(
        route.AuthorizationType,
        `route ${route.RouteKey} is not JWT-authorized`,
      ).toBe("JWT");
      expect(
        route.AuthorizerId,
        `route ${route.RouteKey} has no authorizer`,
      ).toBeDefined();
    }
  });

  it("has no route with AuthorizationType NONE or absent", () => {
    const open = routes().filter(
      (r) => r.AuthorizationType === undefined || r.AuthorizationType === "NONE",
    );
    expect(open.map((r) => r.RouteKey)).toEqual([]);
  });

  it("points every route at the SAME single authorizer", () => {
    template.resourceCountIs("AWS::ApiGatewayV2::Authorizer", 1);
    const ids = new Set(routes().map((r) => JSON.stringify(r.AuthorizerId)));
    expect(ids.size).toBe(1);
  });

  it("binds the authorizer to the supplied user pool as issuer and the app client as audience", () => {
    template.hasResourceProperties("AWS::ApiGatewayV2::Authorizer", {
      AuthorizerType: "JWT",
      IdentitySource: ["$request.header.Authorization"],
      JwtConfiguration: {
        Audience: [USER_POOL_CLIENT_ID],
        Issuer: `https://cognito-idp.${ENV.region}.amazonaws.com/${USER_POOL_ID}`,
      },
    });
  });
});

describe("StashApiStack handlers", () => {
  it("creates exactly one Lambda per route", () => {
    template.resourceCountIs("AWS::Lambda::Function", 17);
  });

  it("names every function under the stash- prefix the role's log grant covers", () => {
    for (const fn of functions()) {
      const name = fn.FunctionName;
      expect(typeof name, JSON.stringify(fn)).toBe("string");
      expect(
        (name as string).startsWith("stash-"),
        `${String(name)} falls outside /aws/lambda/stash-* and could not write logs`,
      ).toBe(true);
    }
  });

  it("gives every function a distinct name", () => {
    const names = functions().map((fn) => fn.FunctionName as string);
    expect(new Set(names).size).toBe(names.length);
  });

  it("runs every function on Node 20", () => {
    for (const fn of functions()) {
      expect(fn.Runtime).toBe("nodejs20.x");
    }
  });

  it("assumes the SHARED role for every function and creates NO role of its own", () => {
    template.resourceCountIs("AWS::IAM::Role", 0);
    template.resourceCountIs("AWS::IAM::Policy", 0);
    for (const fn of functions()) {
      expect(fn.Role, `${String(fn.FunctionName)} does not use the shared role`).toBe(
        ROLE_ARN,
      );
    }
  });

  it("passes the table and bucket names by environment variable to every function", () => {
    for (const fn of functions()) {
      const env = fn.Environment as { Variables: Record<string, unknown> };
      expect(env.Variables.STASH_TABLE_NAME).toBe("StashTable");
      expect(env.Variables.STASH_BUCKET_NAME).toBe(BUCKET_NAME);
    }
  });

  it("gives registerFiles more headroom than a read handler, because it writes sequential chunks", () => {
    const byName = new Map(
      functions().map((fn) => [fn.FunctionName as string, fn]),
    );
    const register = byName.get("stash-register-files");
    const usage = byName.get("stash-get-usage");
    expect(register).toBeDefined();
    expect(usage).toBeDefined();
    expect(Number(register!.Timeout)).toBeGreaterThan(Number(usage!.Timeout));
    expect(Number(register!.MemorySize)).toBeGreaterThan(
      Number(usage!.MemorySize),
    );
  });
});

describe("StashApiStack outputs", () => {
  it("exposes the API URL as a readonly member and a CfnOutput", () => {
    expect(typeof stack.apiUrl).toBe("string");
    const outputs = template.findOutputs("*");
    const values = Object.values(outputs).map((o) => JSON.stringify(o.Value));
    expect(values.length).toBeGreaterThan(0);
    expect(values.some((v) => v.includes("ApiEndpoint") || v.includes("execute-api"))).toBe(
      true,
    );
  });
});
