import { describe, expect, it } from "vitest";
import * as cdk from "aws-cdk-lib";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as s3 from "aws-cdk-lib/aws-s3";
import { Template } from "aws-cdk-lib/assertions";
import { StashAppRoleStack } from "../lib/app-role-stack";
import { buildApp } from "../bin/stash";

const ENV = { account: "111122223333", region: "ap-south-1" };
const TABLE_ARN = `arn:aws:dynamodb:${ENV.region}:${ENV.account}:table/StashTable`;
const BUCKET_ARN = "arn:aws:s3:::stash-test-bucket";
const USER_POOL_ARN = `arn:aws:cognito-idp:${ENV.region}:${ENV.account}:userpool/ap-south-1_TESTPOOL`;

interface Statement {
  Effect: string;
  Action: string | string[];
  Resource?: unknown;
  Condition?: Record<string, Record<string, unknown>>;
}

function synth(opts: { userPoolArn?: string } = {}): Template {
  const app = new cdk.App();
  const host = new cdk.Stack(app, "Fixtures", { env: ENV });
  const table = dynamodb.Table.fromTableArn(host, "T", TABLE_ARN);
  const bucket = s3.Bucket.fromBucketArn(host, "B", BUCKET_ARN);
  const stack = new StashAppRoleStack(app, "TestStashAppRoleStack", {
    env: ENV,
    table,
    bucket,
    userPoolArn: opts.userPoolArn,
  });
  return Template.fromStack(stack);
}

/** Every statement attached to the role, across inline and managed policies. */
function statements(template: Template): Statement[] {
  const out: Statement[] = [];
  for (const type of ["AWS::IAM::Policy", "AWS::IAM::ManagedPolicy"]) {
    for (const res of Object.values(template.findResources(type))) {
      const doc = (res.Properties.PolicyDocument ??
        res.Properties.PolicyDocument) as { Statement: Statement[] };
      out.push(...doc.Statement);
    }
  }
  for (const res of Object.values(template.findResources("AWS::IAM::Role"))) {
    for (const p of (res.Properties.Policies ?? []) as Array<{
      PolicyDocument: { Statement: Statement[] };
    }>) {
      out.push(...p.PolicyDocument.Statement);
    }
  }
  expect(out.length).toBeGreaterThan(0);
  return out;
}

function actionsOf(s: Statement): string[] {
  return Array.isArray(s.Action) ? s.Action : [s.Action];
}

function resourcesOf(s: Statement): unknown[] {
  if (s.Resource === undefined) return [];
  return Array.isArray(s.Resource) ? s.Resource : [s.Resource];
}

/**
 * Render a CloudFormation-resolvable ARN value as text, so an ARN built from
 * intrinsics (AWS::Partition and friends) can be asserted on structurally.
 */
function arnText(value: unknown): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if ("Fn::Join" in obj) {
      const [sep, parts] = obj["Fn::Join"] as [string, unknown[]];
      return parts.map(arnText).join(sep);
    }
    if ("Ref" in obj) return `<${String(obj["Ref"])}>`;
  }
  return JSON.stringify(value);
}

function withAction(all: Statement[], action: string): Statement[] {
  return all.filter((s) => actionsOf(s).includes(action));
}

describe("StashAppRole trust policy", () => {
  it("is assumable by exactly lambda.amazonaws.com", () => {
    const roles = synth().findResources("AWS::IAM::Role");
    const keys = Object.keys(roles);
    expect(keys).toHaveLength(1);
    const doc = roles[keys[0]!]!.Properties.AssumeRolePolicyDocument as {
      Statement: Array<{
        Effect: string;
        Action: string | string[];
        Principal: Record<string, unknown>;
      }>;
    };
    expect(doc.Statement).toHaveLength(1);
    const st = doc.Statement[0]!;
    expect(st.Effect).toBe("Allow");
    expect(actionsOf(st as unknown as Statement)).toEqual(["sts:AssumeRole"]);
    expect(st.Principal).toEqual({ Service: "lambda.amazonaws.com" });
  });
});

describe("StashAppRole resource scoping", () => {
  it("has no statement on Resource '*' except cloudwatch:PutMetricData, which is namespace-constrained", () => {
    for (const s of statements(synth())) {
      const wildcarded = resourcesOf(s).some((r) => r === "*");
      if (!wildcarded) continue;
      expect(actionsOf(s)).toEqual(["cloudwatch:PutMetricData"]);
      expect(s.Condition).toBeDefined();
      expect(s.Condition!.StringEquals).toBeDefined();
      expect(s.Condition!.StringEquals!["cloudwatch:namespace"]).toBe("STASH");
    }
    // and the metric statement must actually exist
    const metric = withAction(statements(synth()), "cloudwatch:PutMetricData");
    expect(metric).toHaveLength(1);
    expect(resourcesOf(metric[0]!)).toEqual(["*"]);
  });

  it("never grants dynamodb:Scan or s3:DeleteObject", () => {
    const all = statements(synth({ userPoolArn: USER_POOL_ARN })).flatMap(
      actionsOf,
    );
    expect(all).not.toContain("dynamodb:Scan");
    expect(all).not.toContain("s3:DeleteObject");
    expect(all).not.toContain("dynamodb:DeleteTable");
    expect(all).not.toContain("dynamodb:UpdateTable");
  });

  it("covers the table ARN and its index ARNs for DynamoDB data actions", () => {
    const st = withAction(statements(synth()), "dynamodb:Query");
    expect(st).toHaveLength(1);
    const res = resourcesOf(st[0]!);
    expect(res).toContain(TABLE_ARN);
    expect(res).toContain(`${TABLE_ARN}/index/*`);
    for (const a of [
      "dynamodb:GetItem",
      "dynamodb:PutItem",
      "dynamodb:UpdateItem",
      "dynamodb:DeleteItem",
      "dynamodb:BatchGetItem",
      "dynamodb:BatchWriteItem",
      "dynamodb:TransactWriteItems",
      "dynamodb:TransactGetItems",
      "dynamodb:ConditionCheckItem",
    ]) {
      expect(actionsOf(st[0]!)).toContain(a);
    }
  });

  it("scopes S3 object actions under the users/ prefix only", () => {
    const st = withAction(statements(synth()), "s3:PutObject");
    expect(st).toHaveLength(1);
    const res = resourcesOf(st[0]!) as string[];
    expect(res).toHaveLength(1);
    expect(res[0]!.endsWith("/users/*")).toBe(true);
    for (const a of [
      "s3:GetObject",
      "s3:AbortMultipartUpload",
      "s3:ListMultipartUploadParts",
    ]) {
      expect(actionsOf(st[0]!)).toContain(a);
    }
  });

  it("scopes S3 bucket-level listing to the bucket with a users/ prefix condition", () => {
    const st = withAction(statements(synth()), "s3:ListBucket");
    expect(st).toHaveLength(1);
    expect(resourcesOf(st[0]!)).toEqual([BUCKET_ARN]);
    expect(actionsOf(st[0]!)).toContain("s3:ListBucketMultipartUploads");
    expect(st[0]!.Condition!.StringLike!["s3:prefix"]).toEqual(["users/*"]);
  });

  it("scopes CloudWatch Logs to the /aws/lambda/stash-* log groups", () => {
    const st = withAction(statements(synth()), "logs:PutLogEvents");
    expect(st).toHaveLength(1);
    const res = resourcesOf(st[0]!).map(arnText);
    expect(res.length).toBeGreaterThan(0);
    for (const r of res) {
      expect(r).not.toBe("*");
      expect(r).toContain(":log-group:/aws/lambda/stash-*");
    }
    expect(actionsOf(st[0]!)).toContain("logs:CreateLogGroup");
    expect(actionsOf(st[0]!)).toContain("logs:CreateLogStream");
  });
});

describe("StashAppRole Cognito statement", () => {
  it("is absent when no userPoolArn prop is supplied", () => {
    const actions = statements(synth()).flatMap(actionsOf);
    expect(actions.some((a) => a.startsWith("cognito-idp:"))).toBe(false);
  });

  it("is present and scoped to the supplied user pool ARN", () => {
    const st = withAction(
      statements(synth({ userPoolArn: USER_POOL_ARN })),
      "cognito-idp:AdminGetUser",
    );
    expect(st).toHaveLength(1);
    expect(resourcesOf(st[0]!)).toEqual([USER_POOL_ARN]);
    expect(actionsOf(st[0]!)).toContain(
      "cognito-idp:AdminUpdateUserAttributes",
    );
  });
});

describe("app-level tagging", () => {
  const EXPECTED: Record<string, string> = {
    Project: "STASH",
    Env: "beta",
    Component: "control-plane",
    ManagedBy: "CDK",
    CostCenter: "stash-beta",
  };

  function tagsOf(res: { Properties: Record<string, unknown> }): Record<string, string> {
    const raw = res.Properties.Tags as Array<{ Key: string; Value: string }>;
    expect(Array.isArray(raw)).toBe(true);
    return Object.fromEntries(raw.map((t) => [t.Key, t.Value]));
  }

  it("applies the cost-allocation tags to resources in BOTH stacks", () => {
    const app = buildApp();
    const assembly = app.synth();
    const names = assembly.stacks.map((st) => st.stackName);
    expect(names).toContain("StashDataStack");
    expect(names).toContain("StashAppRoleStack");

    const data = assembly.getStackByName("StashDataStack").template as {
      Resources: Record<string, { Type: string; Properties: Record<string, unknown> }>;
    };
    const role = assembly.getStackByName("StashAppRoleStack").template as {
      Resources: Record<string, { Type: string; Properties: Record<string, unknown> }>;
    };

    const pick = (
      t: typeof data,
      type: string,
    ): { Properties: Record<string, unknown> } => {
      const hits = Object.values(t.Resources).filter((r) => r.Type === type);
      expect(hits).toHaveLength(1);
      return hits[0]!;
    };

    for (const res of [
      pick(data, "AWS::DynamoDB::Table"),
      pick(data, "AWS::S3::Bucket"),
      pick(role, "AWS::IAM::Role"),
    ]) {
      expect(tagsOf(res)).toMatchObject(EXPECTED);
    }
  });
});
