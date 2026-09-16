import { describe, expect, it } from "vitest";
import * as cdk from "aws-cdk-lib";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as s3 from "aws-cdk-lib/aws-s3";
import { Template } from "aws-cdk-lib/assertions";
import { StashRetentionStack } from "../lib/retention-stack";

const ENV = { account: "111122223333", region: "ap-south-1" };
function synth(): Template {
  const app = new cdk.App();
  const host = new cdk.Stack(app, "Fixtures", { env: ENV });
  const table = dynamodb.Table.fromTableArn(host, "T", `arn:aws:dynamodb:${ENV.region}:${ENV.account}:table/StashTable`);
  const bucket = s3.Bucket.fromBucketArn(host, "B", "arn:aws:s3:::stash-test-bucket");
  return Template.fromStack(new StashRetentionStack(app, "TestStashRetention", { env: ENV, table, bucket }));
}

describe("StashRetentionStack", () => {
  it("has one daily schedule and one purge Lambda with an explicit log group", () => {
    const template = synth();
    template.resourceCountIs("AWS::Events::Rule", 1);
    template.resourceCountIs("AWS::Lambda::Function", 1);
    template.hasResourceProperties("AWS::Logs::LogGroup", { LogGroupName: "/aws/lambda/stash-purge-trash", RetentionInDays: 30 });
    const rule = Object.values(template.findResources("AWS::Events::Rule"))[0]!;
    expect(rule.Properties.ScheduleExpression).toBe("rate(1 day)");
  });

  it("gives the dedicated retention role only queue/table writes, S3 delete, and its log group", () => {
    const template = synth();
    template.resourceCountIs("AWS::IAM::Role", 1);
    const policies = Object.values(template.findResources("AWS::IAM::Policy"));
    const actions = policies.flatMap((p) => {
      const statement = p.Properties.PolicyDocument.Statement as Array<{ Action: string | string[] }>;
      return statement.flatMap((s) => Array.isArray(s.Action) ? s.Action : [s.Action]);
    });
    expect(actions).toEqual(expect.arrayContaining(["dynamodb:Query", "dynamodb:UpdateItem", "dynamodb:TransactWriteItems", "s3:DeleteObject", "logs:CreateLogStream", "logs:PutLogEvents"]));
    expect(actions).not.toContain("s3:PutObject");
    expect(actions).not.toContain("s3:GetObject");
  });
});
