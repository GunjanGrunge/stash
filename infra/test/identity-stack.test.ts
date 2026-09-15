import { describe, expect, it } from "vitest";
import * as cdk from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { StashIdentityStack } from "../lib/identity-stack";

const ENV = { account: "111122223333", region: "ap-south-1" };

interface CfnResource {
  Type: string;
  Properties: Record<string, unknown>;
  DeletionPolicy?: string;
  UpdateReplacePolicy?: string;
}

function synth(): Template {
  const app = new cdk.App();
  const stack = new StashIdentityStack(app, "TestStashIdentityStack", {
    env: ENV,
  });
  return Template.fromStack(stack);
}

/** The single resource of `type`, asserted to be unique so drift is visible. */
function only(template: Template, type: string): CfnResource {
  const hits = Object.values(template.findResources(type)) as CfnResource[];
  expect(hits).toHaveLength(1);
  return hits[0]!;
}

function pool(template: Template): CfnResource {
  return only(template, "AWS::Cognito::UserPool");
}

function client(template: Template): CfnResource {
  return only(template, "AWS::Cognito::UserPoolClient");
}

describe("StashIdentityStack user pool", () => {
  it("disables self sign-up at the CloudFormation level", () => {
    // AllowAdminCreateUserOnly is the property Cognito actually enforces;
    // asserting the CDK-level `selfSignUpEnabled` would only prove we passed a
    // flag, not that the synthesized pool refuses public registration.
    const props = pool(synth()).Properties as {
      AdminCreateUserConfig?: { AllowAdminCreateUserOnly?: boolean };
    };
    expect(props.AdminCreateUserConfig).toBeDefined();
    expect(props.AdminCreateUserConfig!.AllowAdminCreateUserOnly).toBe(true);
  });

  it("signs in by email", () => {
    const props = pool(synth()).Properties as {
      UsernameAttributes?: string[];
      AliasAttributes?: string[];
    };
    expect(props.UsernameAttributes).toEqual(["email"]);
  });

  it("declares the quota_bytes custom attribute as a mutable number", () => {
    // Cognito prefixes custom attributes with `custom:` itself; the template
    // carries the bare name, and the JWT claim is `custom:quota_bytes`.
    const props = pool(synth()).Properties as {
      Schema?: Array<Record<string, unknown>>;
    };
    expect(props.Schema).toBeDefined();
    const quota = props.Schema!.find((a) => a.Name === "quota_bytes");
    expect(quota).toBeDefined();
    expect(quota!.AttributeDataType).toBe("Number");
    // Mutable: the quota is raised or lowered per user after creation.
    expect(quota!.Mutable).toBe(true);
  });

  it("is retained on stack deletion", () => {
    // Deleting the pool orphans the beta users' identities: their `sub` is the
    // `user_id` that every DynamoDB partition and S3 key is built from, so a
    // replacement pool would make the retained library unreachable.
    const p = pool(synth());
    expect(p.DeletionPolicy).toBe("Retain");
    expect(p.UpdateReplacePolicy).toBe("Retain");
  });

  it("has MFA off and no hosted-UI domain", () => {
    const t = synth();
    expect((pool(t).Properties as { MfaConfiguration?: string }).MfaConfiguration).toBe(
      "OFF",
    );
    // A hosted UI would be a second, browser-based auth surface nobody owns.
    t.resourceCountIs("AWS::Cognito::UserPoolDomain", 0);
  });

  it("creates no groups", () => {
    synth().resourceCountIs("AWS::Cognito::UserPoolGroup", 0);
  });
});

describe("StashIdentityStack app client", () => {
  it("has no client secret", () => {
    // A desktop binary cannot hold a secret; a generated one would ship inside
    // the installer and be extractable by any user.
    const props = client(synth()).Properties as { GenerateSecret?: boolean };
    expect(props.GenerateSecret).toBe(false);
  });

  it("allows SRP and no password-carrying flow", () => {
    const props = client(synth()).Properties as {
      ExplicitAuthFlows?: string[];
    };
    expect(props.ExplicitAuthFlows).toBeDefined();
    expect(props.ExplicitAuthFlows).toContain("ALLOW_USER_SRP_AUTH");
    // SRP exists so the password never crosses the wire; enabling either
    // password flow alongside it would defeat that entirely.
    expect(props.ExplicitAuthFlows).not.toContain("ALLOW_USER_PASSWORD_AUTH");
    expect(props.ExplicitAuthFlows).not.toContain(
      "ALLOW_ADMIN_USER_PASSWORD_AUTH",
    );
    expect(props.ExplicitAuthFlows).not.toContain("ALLOW_CUSTOM_AUTH");
  });

  it("enables refresh token rotation", () => {
    const props = client(synth()).Properties as {
      RefreshTokenRotation?: {
        Feature?: string;
        RetryGracePeriodSeconds?: number;
      };
    };
    expect(props.RefreshTokenRotation).toBeDefined();
    expect(props.RefreshTokenRotation!.Feature).toBe("ENABLED");
    expect(props.RefreshTokenRotation!.RetryGracePeriodSeconds).toBeTypeOf(
      "number",
    );
  });

  it("enables no OAuth flow and registers no callback URL", () => {
    // No hosted UI means no redirect surface: CDK otherwise defaults a
    // callback URL of https://example.com into the client.
    const props = client(synth()).Properties as {
      AllowedOAuthFlowsUserPoolClient?: boolean;
      AllowedOAuthFlows?: string[];
      CallbackURLs?: string[];
    };
    expect(props.AllowedOAuthFlowsUserPoolClient).toBe(false);
    expect(props.AllowedOAuthFlows).toBeUndefined();
    expect(props.CallbackURLs).toBeUndefined();
  });

  it("is attached to the stack's own pool", () => {
    const t = synth();
    const poolLogicalId = Object.keys(
      t.findResources("AWS::Cognito::UserPool"),
    )[0]!;
    const props = client(t).Properties as { UserPoolId?: { Ref?: string } };
    expect(props.UserPoolId).toEqual({ Ref: poolLogicalId });
  });
});

describe("StashIdentityStack exports", () => {
  it("exposes the pool and client for the API stack to consume", () => {
    const app = new cdk.App();
    const stack = new StashIdentityStack(app, "TestStashIdentityStack", {
      env: ENV,
    });
    // The API stack's JWT authorizer needs the pool ARN/id and the client id;
    // without these the stack is unusable by its only consumer.
    expect(stack.userPool.userPoolArn).toBeTruthy();
    expect(stack.userPoolClient.userPoolClientId).toBeTruthy();
    expect(stack.defaultQuotaBytes).toBe(1024 ** 4);
  });

  it("does not hardcode an account", () => {
    const app = new cdk.App();
    const stack = new StashIdentityStack(app, "TestStashIdentityStack", {
      env: { region: "ap-south-1" },
    });
    expect(cdk.Token.isUnresolved(stack.account)).toBe(true);
    expect(stack.region).toBe("ap-south-1");
  });
});
