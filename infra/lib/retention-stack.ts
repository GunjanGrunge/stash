import * as path from "node:path";
import * as fs from "node:fs";
import * as cdk from "aws-cdk-lib";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as events from "aws-cdk-lib/aws-events";
import * as eventTargets from "aws-cdk-lib/aws-events-targets";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as logs from "aws-cdk-lib/aws-logs";
import * as nodejs from "aws-cdk-lib/aws-lambda-nodejs";
import * as s3 from "aws-cdk-lib/aws-s3";
import { Construct } from "constructs";

export interface StashRetentionStackProps extends cdk.StackProps {
  readonly table: dynamodb.ITable;
  readonly bucket: s3.IBucket;
}

const FUNCTION_NAME = "stash-purge-trash";
const LOG_GROUP_NAME = `/aws/lambda/${FUNCTION_NAME}`;

function repositoryRoot(): string {
  let dir = process.cwd();
  for (;;) {
    if (fs.existsSync(path.join(dir, "services", "entrypoints", "src"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) throw new Error("could not locate services/entrypoints/src");
    dir = parent;
  }
}

/**
 * The retention worker intentionally has its own role (AFR-007): permanent
 * object deletion is broader than the shared control-plane role may receive.
 */
export class StashRetentionStack extends cdk.Stack {
  readonly purgeFunction: nodejs.NodejsFunction;
  readonly role: iam.Role;

  constructor(scope: Construct, id: string, props: StashRetentionStackProps) {
    super(scope, id, props);
    const { table, bucket } = props;

    const logGroup = new logs.LogGroup(this, "PurgeLogGroup", {
      logGroupName: LOG_GROUP_NAME,
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });
    this.role = new iam.Role(this, "RetentionRole", {
      assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
      description: "Permanently purges STASH Trash objects after 30 days.",
    });
    this.role.addToPolicy(new iam.PolicyStatement({
      actions: ["dynamodb:Query", "dynamodb:UpdateItem", "dynamodb:TransactWriteItems"],
      resources: [table.tableArn, `${table.tableArn}/index/gsi5`],
    }));
    this.role.addToPolicy(new iam.PolicyStatement({
      actions: ["s3:DeleteObject"],
      resources: [bucket.arnForObjects("users/*")],
    }));
    const logArn = this.formatArn({
      service: "logs",
      resource: "log-group",
      resourceName: LOG_GROUP_NAME,
      arnFormat: cdk.ArnFormat.COLON_RESOURCE_NAME,
    });
    this.role.addToPolicy(new iam.PolicyStatement({
      actions: ["logs:CreateLogStream", "logs:PutLogEvents"],
      resources: [logArn, `${logArn}:*`],
    }));

    this.purgeFunction = new nodejs.NodejsFunction(this, "PurgeTrash", {
      functionName: FUNCTION_NAME,
      entry: path.join(repositoryRoot(), "services", "entrypoints", "src", "purge-trash.ts"),
      handler: "handler",
      runtime: lambda.Runtime.NODEJS_20_X,
      architecture: lambda.Architecture.ARM_64,
      timeout: cdk.Duration.minutes(5),
      memorySize: 512,
      role: this.role,
      logGroup,
      environment: { STASH_TABLE_NAME: table.tableName, STASH_BUCKET_NAME: bucket.bucketName },
      bundling: {
        format: nodejs.OutputFormat.ESM,
        target: "node20",
        sourceMap: true,
        externalModules: ["@aws-sdk/*", "@smithy/*"],
        banner: "import{createRequire}from'module';const require=createRequire(import.meta.url);",
      },
    });
    new events.Rule(this, "DailyPurgeSchedule", {
      description: "Runs the STASH 30-day Trash purge worker once each day.",
      schedule: events.Schedule.rate(cdk.Duration.days(1)),
      targets: [new eventTargets.LambdaFunction(this.purgeFunction)],
    });
  }
}
