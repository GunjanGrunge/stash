import { describe, expect, it } from "vitest";
import * as cdk from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { StashDataStack } from "../lib/data-stack";

function synth(): Template {
  const app = new cdk.App();
  const stack = new StashDataStack(app, "TestStashDataStack");
  return Template.fromStack(stack);
}

describe("StashDataStack DynamoDB table", () => {
  it("uses pk/sk STRING keys with on-demand billing and PITR", () => {
    synth().hasResourceProperties("AWS::DynamoDB::Table", {
      BillingMode: "PAY_PER_REQUEST",
      KeySchema: [
        { AttributeName: "pk", KeyType: "HASH" },
        { AttributeName: "sk", KeyType: "RANGE" },
      ],
      PointInTimeRecoverySpecification: {
        PointInTimeRecoveryEnabled: true,
      },
    });
  });

  it("is retained on stack deletion", () => {
    synth().hasResource("AWS::DynamoDB::Table", {
      DeletionPolicy: "Retain",
      UpdateReplacePolicy: "Retain",
    });
  });

  it("declares exactly three GSIs named gsi1, gsi2 and gsi3", () => {
    const template = synth();
    const tables = template.findResources("AWS::DynamoDB::Table");
    const keys = Object.keys(tables);
    expect(keys).toHaveLength(1);
    const gsis = tables[keys[0]!]!.Properties.GlobalSecondaryIndexes as Array<{
      IndexName: string;
      KeySchema: Array<{ AttributeName: string; KeyType: string }>;
    }>;
    expect(gsis).toHaveLength(3);
    expect(gsis.map((g) => g.IndexName)).toEqual(["gsi1", "gsi2", "gsi3"]);
    for (const n of [1, 2, 3]) {
      const gsi = gsis.find((g) => g.IndexName === `gsi${n}`)!;
      expect(gsi.KeySchema).toEqual([
        { AttributeName: `gsi${n}pk`, KeyType: "HASH" },
        { AttributeName: `gsi${n}sk`, KeyType: "RANGE" },
      ]);
    }
    const attrs = tables[keys[0]!]!.Properties
      .AttributeDefinitions as Array<{ AttributeName: string; AttributeType: string }>;
    for (const name of [
      "pk",
      "sk",
      "gsi1pk",
      "gsi1sk",
      "gsi2pk",
      "gsi2sk",
      "gsi3pk",
      "gsi3sk",
    ]) {
      expect(attrs).toContainEqual({ AttributeName: name, AttributeType: "S" });
    }
  });
});

describe("StashDataStack S3 bucket", () => {
  it("uses S3-managed (AES256) encryption", () => {
    synth().hasResourceProperties("AWS::S3::Bucket", {
      BucketEncryption: {
        ServerSideEncryptionConfiguration: [
          { ServerSideEncryptionByDefault: { SSEAlgorithm: "AES256" } },
        ],
      },
    });
  });

  it("has NO versioning configuration (Rule 8: versioning is off)", () => {
    const template = synth();
    const buckets = template.findResources("AWS::S3::Bucket");
    const keys = Object.keys(buckets);
    expect(keys).toHaveLength(1);
    expect(buckets[keys[0]!]!.Properties).not.toHaveProperty(
      "VersioningConfiguration",
    );
    template.hasResourceProperties("AWS::S3::Bucket", {
      VersioningConfiguration: Match.absent(),
    });
  });

  it("blocks all public access", () => {
    synth().hasResourceProperties("AWS::S3::Bucket", {
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
    });
  });

  it("aborts incomplete multipart uploads after 7 days", () => {
    synth().hasResourceProperties("AWS::S3::Bucket", {
      LifecycleConfiguration: {
        Rules: Match.arrayWith([
          Match.objectLike({
            AbortIncompleteMultipartUpload: { DaysAfterInitiation: 7 },
            Status: "Enabled",
          }),
        ]),
      },
    });
  });

  it("is retained on stack deletion", () => {
    synth().hasResource("AWS::S3::Bucket", {
      DeletionPolicy: "Retain",
      UpdateReplacePolicy: "Retain",
    });
  });

  it("denies non-TLS access via a bucket policy", () => {
    synth().hasResourceProperties("AWS::S3::BucketPolicy", {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Effect: "Deny",
            Action: "s3:*",
            Condition: { Bool: { "aws:SecureTransport": "false" } },
          }),
        ]),
      },
    });
  });
});
