import * as cdk from "aws-cdk-lib";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as iam from "aws-cdk-lib/aws-iam";
import * as s3 from "aws-cdk-lib/aws-s3";
import { Construct } from "constructs";

export interface StashAppRoleStackProps extends cdk.StackProps {
  /** The STASH single table. Statements are scoped to it and its indexes. */
  readonly table: dynamodb.ITable;
  /** The STASH object bucket. Object access is scoped under `users/`. */
  readonly bucket: s3.IBucket;
  /**
   * The Cognito user pool ARN, once the Identity stack exists. When omitted the
   * Cognito statement is dropped entirely — never widened to a wildcard.
   */
  readonly userPoolArn?: string;
}

/** Everything under this prefix belongs to a creator; nothing else is readable. */
const OBJECT_PREFIX = "users/";

/** Log groups the STASH handlers own. */
const LOG_GROUP_PREFIX = "/aws/lambda/stash-*";

/** The single custom metric namespace STASH publishes into. */
const METRIC_NAMESPACE = "STASH";

/**
 * One execution role shared by every STASH handler.
 *
 * User-directed deviation from the approved spec §3.5 (one role per handler),
 * recorded as AFR-007 in AGENT.md. Revisit trigger: before real creator data
 * lands, or as soon as one handler needs a permission the others do not.
 *
 * Because per-handler scoping is gone, resource scoping is the only remaining
 * bound: every statement below names concrete ARNs. The one exception is
 * cloudwatch:PutMetricData, which has no resource-level permission and is
 * therefore constrained by namespace instead.
 */
export class StashAppRoleStack extends cdk.Stack {
  readonly role: iam.Role;

  constructor(scope: Construct, id: string, props: StashAppRoleStackProps) {
    super(scope, id, props);

    const { table, bucket, userPoolArn } = props;

    this.role = new iam.Role(this, "StashAppRole", {
      assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
      description:
        "Shared execution role for all STASH handlers (AFR-007 deviation).",
    });

    // 1. DynamoDB — keyed access patterns only. No Scan: STASH never scans.
    //    No DeleteTable/UpdateTable: handlers do not administer the table.
    this.role.addToPolicy(
      new iam.PolicyStatement({
        actions: [
          "dynamodb:GetItem",
          "dynamodb:PutItem",
          "dynamodb:UpdateItem",
          "dynamodb:DeleteItem",
          "dynamodb:Query",
          "dynamodb:BatchGetItem",
          "dynamodb:BatchWriteItem",
          "dynamodb:TransactWriteItems",
          "dynamodb:TransactGetItems",
          "dynamodb:ConditionCheckItem",
        ],
        resources: [table.tableArn, `${table.tableArn}/index/*`],
      }),
    );

    // 2. S3 objects — creator payloads only. No s3:DeleteObject: versioning is
    //    off (Rule 8), so a delete is unrecoverable; a future delete flow gets
    //    its own role.
    this.role.addToPolicy(
      new iam.PolicyStatement({
        actions: [
          "s3:GetObject",
          "s3:PutObject",
          "s3:AbortMultipartUpload",
          "s3:ListMultipartUploadParts",
        ],
        resources: [bucket.arnForObjects(`${OBJECT_PREFIX}*`)],
      }),
    );

    // 3. S3 bucket-level listing — the bucket itself, keyhole-limited to the
    //    users/ prefix by condition.
    this.role.addToPolicy(
      new iam.PolicyStatement({
        actions: ["s3:ListBucket", "s3:ListBucketMultipartUploads"],
        resources: [bucket.bucketArn],
        conditions: {
          StringLike: { "s3:prefix": [`${OBJECT_PREFIX}*`] },
        },
      }),
    );

    // 4. CloudWatch Logs — only the STASH handler log groups.
    const logGroupArn = this.formatArn({
      service: "logs",
      resource: "log-group",
      resourceName: LOG_GROUP_PREFIX,
      arnFormat: cdk.ArnFormat.COLON_RESOURCE_NAME,
    });
    this.role.addToPolicy(
      new iam.PolicyStatement({
        actions: [
          "logs:CreateLogGroup",
          "logs:CreateLogStream",
          "logs:PutLogEvents",
        ],
        resources: [logGroupArn, `${logGroupArn}:*`],
      }),
    );

    // 5. CloudWatch metrics — PutMetricData has no resource-level permission,
    //    so Resource "*" is unavoidable. It is bounded by namespace instead.
    this.role.addToPolicy(
      new iam.PolicyStatement({
        actions: ["cloudwatch:PutMetricData"],
        resources: ["*"],
        conditions: {
          StringEquals: { "cloudwatch:namespace": METRIC_NAMESPACE },
        },
      }),
    );

    // 6. Cognito — quota_bytes attribute maintenance. Omitted entirely while
    //    the Identity stack does not exist; never a wildcard grant.
    if (userPoolArn !== undefined) {
      this.role.addToPolicy(
        new iam.PolicyStatement({
          actions: [
            "cognito-idp:AdminGetUser",
            "cognito-idp:AdminUpdateUserAttributes",
          ],
          resources: [userPoolArn],
        }),
      );
    }
  }
}
